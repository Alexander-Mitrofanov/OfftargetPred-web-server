import json

import asyncio
import httpx
import pytest

from offtargetpred.api import create_app
from offtargetpred.config import Settings
from offtargetpred.jobs import write_json

ORIGIN = "https://alexander-mitrofanov.github.io"


class ASGIClient:
    # A single event loop per call avoids thread-portal restrictions in sandboxes.
    def __init__(self, app):
        self.app = app

    def request(self, method, url, **kwargs):
        async def invoke():
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=self.app), base_url="http://testserver") as client:
                return await client.request(method, url, **kwargs)
        return asyncio.run(invoke())

    def get(self, url, **kwargs):
        return self.request("GET", url, **kwargs)

    def post(self, url, **kwargs):
        return self.request("POST", url, **kwargs)

    def delete(self, url, **kwargs):
        return self.request("DELETE", url, **kwargs)


@pytest.fixture
def client(tmp_path):
    app = create_app(Settings(data_dir=tmp_path, min_free_bytes=0, max_request_bytes=2048))
    return ASGIClient(app)


def submission():
    return {"mode": "pairs", "input": "id,target,off_target\nexample,AAAAAAAAAAAAAAAAAAAAAGG,AAAAAAAAAAAAAAAAAAAATGG\n", "format": "csv", "models": [1, 2, 3], "name": "Example"}


def submit(client):
    response = client.post("/api/v1/jobs", json=submission(), headers={"Origin": ORIGIN})
    assert response.status_code == 202, response.text
    job = response.json()
    return job, {"Authorization": f"Bearer {job['token']}"}


def test_job_auth_cors_and_private_headers(client):
    job, headers = submit(client)
    url = f"/api/v1/jobs/{job['id']}"
    assert client.get(url).status_code == 404
    assert client.get(url, headers={"Authorization": "Bearer wrong"}).status_code == 404
    result = client.get(url, headers={**headers, "Origin": ORIGIN})
    assert result.status_code == 200
    assert result.headers["Cache-Control"] == "no-store"
    assert result.headers["Access-Control-Allow-Origin"] == ORIGIN
    assert "token" not in result.json()
    assert "input" not in result.json()
    assert client.get(url + "/results", headers=headers).status_code == 409
    assert client.post("/api/v1/jobs", json=submission(), headers={"Origin": "https://evil.example"}).status_code == 403


def test_reject_invalid_input_and_chunked_oversize(client):
    value = submission()
    value["input"] = "target,off_target\nACGT,ACGT\n"
    assert client.post("/api/v1/jobs", json=value).status_code == 422
    value = submission()
    value["models"] = [1, 1]
    assert client.post("/api/v1/jobs", json=value).status_code == 422
    value = submission()
    value["max_mismatches"] = True
    assert client.post("/api/v1/jobs", json=value).status_code == 422
    value = submission()
    value["models"] = [True]
    assert client.post("/api/v1/jobs", json=value).status_code == 422
    async def chunks():
        yield b" " * 1500
        yield b" " * 1500
    response = client.post("/api/v1/jobs", content=chunks(), headers={"Content-Type": "application/json"})
    assert response.status_code == 413
    assert client.post("/api/v1/jobs", content="{}", headers={"Content-Type": "text/plain"}).status_code == 415


def test_genome_is_not_advertised_without_reference(client):
    capabilities = client.get("/api/v1/capabilities").json()
    assert capabilities["modes"] == ["pairs"]
    assert capabilities["genomes"] == []
    value = submission()
    value["mode"] = "genome"
    assert client.post("/api/v1/jobs", json=value).status_code == 503


def test_result_global_sort_filter_download_and_delete(client):
    job, headers = submit(client)
    store = client.app.state.store
    store.claim()
    rows = [
        {"id": "=1+1", "target": "A" * 23, "off_target": "C" * 23, "scores": {"k1": 0.1, "k2": 0.5, "k3": 0.2}},
        {"id": "second", "row_index": 2, "strand": "-", "target": "G" * 23, "off_target": "T" * 23, "scores": {"k1": 0.9, "k2": 0.2, "k3": 0.4}},
    ]
    write_json(store.directory(job["id"]) / "results.json", {"rows": rows, "metadata": {"calibrated": False}})
    store.finish(job["id"], "completed", count=2)
    url = f"/api/v1/jobs/{job['id']}"
    result = client.get(url + "/results?sort=k1&order=desc&limit=1", headers=headers).json()
    assert result["total"] == 2
    assert result["rows"][0]["id"] == "second"
    result = client.get(url + "/results?q=second", headers=headers).json()
    assert result["total"] == 1
    assert result["unfiltered_total"] == 2
    csv = client.get(url + "/download", headers=headers)
    assert csv.status_code == 200
    assert "'=1+1" in csv.text
    assert "score_k1" in csv.text
    import csv as csv_module
    import io
    records = list(csv_module.DictReader(io.StringIO(csv.text)))
    assert records[1]["strand"] == "-"
    assert records[1]["row_index"] == "2"
    document = client.get(url + "/download?format=json", headers=headers)
    assert document.status_code == 200
    assert document.json()["metadata"]["calibrated"] is False
    assert len(document.json()["rows"]) == 2
    assert "crispert-results.json" in document.headers["Content-Disposition"]
    assert client.delete(url, headers=headers).status_code == 202
    assert client.get(url, headers=headers).status_code == 404
    assert not store.directory(job["id"]).exists()


def test_cancel_queued_job(client):
    job, headers = submit(client)
    result = client.post(f"/api/v1/jobs/{job['id']}/cancel", headers=headers)
    assert result.status_code == 200
    assert result.json()["status"] == "cancelled"
    assert client.app.state.store.claim() is None
