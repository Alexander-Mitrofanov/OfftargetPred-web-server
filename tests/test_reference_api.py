"""Public helper boundaries and reference-index capability readiness."""
import hashlib
import json
import sys
from pathlib import Path

import pytest

from offtargetpred.api import create_app
from offtargetpred.config import Settings
from offtargetpred.reference import build_fasta_index
from offtargetpred.tool_limits import ToolAdmission, ToolBusy
from test_api import ASGIClient, ORIGIN


@pytest.fixture
def indexed_client(tmp_path):
    fasta = tmp_path / "reference.fa"
    fasta.write_text(">1\nTTTTTGACTACGATCGTAGCTACGTAGGTTTTT\n")
    metadata = {"assembly": "GRCh38", "verified": True, "filename": fasta.name,
                "sha256": hashlib.sha256(fasta.read_bytes()).hexdigest(),
                "contigs": 1, "total_bases": 33}
    reference = tmp_path / "reference.json"
    reference.write_text(json.dumps(metadata))
    build_fasta_index(fasta, metadata)
    return ASGIClient(create_app(Settings(data_dir=tmp_path / "jobs", min_free_bytes=0,
        cas_offinder=sys.executable, genome_dir=tmp_path, reference_metadata=reference))), fasta


def test_index_readiness_resolve_and_bounded_request(indexed_client):
    client, fasta = indexed_client
    assert client.get("/api/v1/capabilities").json()["features"]["guide_resolver"]
    value = {"spacer": "GACTACGATCGTAGCTACGT", "chromosome": "chr1", "start": 5, "end": 25}
    response = client.post("/api/v1/resolve-guide", json=value, headers={"Origin": ORIGIN})
    assert response.status_code == 200, response.text
    assert response.json()["matches"][0]["target23"] == value["spacer"] + "AGG"
    assert response.json()["matches"][0]["start"] == 5
    assert client.post("/api/v1/resolve-guide", json=value, headers={"Origin": "https://invalid.example"}).status_code == 403
    assert client.post("/api/v1/resolve-guide", json={**value, "start": True}).status_code == 422
    assert client.post("/api/v1/resolve-guide", content=b" " * 9000, headers={"Content-Type": "application/json"}).status_code == 413
    Path(str(fasta) + ".fai").write_text("corrupted\n")
    assert not client.get("/api/v1/capabilities").json()["features"]["guide_resolver"]
    assert client.post("/api/v1/resolve-guide", json=value).status_code == 503


def test_helper_bounds_release_on_error_without_retaining_addresses(monkeypatch):
    clock = [100.0]
    monkeypatch.setattr("offtargetpred.tool_limits.time.monotonic", lambda: clock[0])
    limits = ToolAdmission("salt", concurrent=1, per_minute=2, clients=2)
    with pytest.raises(ValueError):
        with limits.admit("private-address"):
            with pytest.raises(ToolBusy):
                with limits.admit("other"):
                    pass
            raise ValueError()
    assert limits.active == 0
    with limits.admit("private-address"):
        pass
    with pytest.raises(ToolBusy):
        with limits.admit("private-address"):
            pass
    assert "private-address" not in repr(limits.history)
    clock[0] += 61
    with limits.admit("private-address"):
        pass


def test_discovery_endpoint_bounds_and_optional_gene_lookup(indexed_client):
    client, _ = indexed_client
    capabilities = client.get("/api/v1/capabilities").json()
    assert capabilities["features"]["guide_discovery"]
    assert not capabilities["features"]["gene_lookup"]
    value = {"chromosome": "chr1", "start": 0, "end": 33, "assembly": "GRCh38"}
    response = client.post("/api/v1/discover-guides", json=value, headers={"Origin": ORIGIN})
    assert response.status_code == 200, response.text
    assert response.json()["scope"]["complete"]
    assert any(guide["target23"] == "GACTACGATCGTAGCTACGTAGG" for guide in response.json()["guides"])
    for patch in ({"start": True}, {"end": 20_001}, {"assembly": "GRCh37"}, {"extra": "field"}):
        assert client.post("/api/v1/discover-guides", json={**value, **patch}).status_code == 422
    assert client.post("/api/v1/discover-guides", json=value, headers={"Origin": "https://invalid.example"}).status_code == 403
    assert client.post("/api/v1/discover-genes", json={"query": "TP53"}).status_code == 503


def test_reference_context_endpoint_preserves_skips_and_enforces_bounds(indexed_client):
    client, _ = indexed_client
    record = {"id": "selected", "off_target": "GACTACGATCGTAGCTACGTAGG", "chromosome": "chr1", "start": 5, "end": 28, "strand": "+", "assembly": "GRCh38", "coordinate_system": "0-based half-open"}
    value = {"records": [record, {"id": "no-coordinates", "off_target": record["off_target"]}], "flank_bases": 5}
    response = client.post("/api/v1/reference-context", json=value, headers={"Origin": ORIGIN})
    assert response.status_code == 200, response.text
    assert response.json()["summary"] == {"selected": 2, "ready": 1, "skipped": 1}
    assert response.json()["records"][0]["context"]["target_start_offset"] == 5
    assert client.post("/api/v1/reference-context", json={**value, "flank_bases": True}).status_code == 422
    assert client.post("/api/v1/reference-context", json={**value, "records": [record] * 21}).status_code == 422
    assert client.post("/api/v1/reference-context", json={**value, "records": [{**record, "token": "private"}]}).status_code == 422
    assert client.post("/api/v1/reference-context", json=value, headers={"Origin": "https://invalid.example"}).status_code == 403
    assert client.post("/api/v1/reference-context", content=b" " * 17000, headers={"Content-Type": "application/json"}).status_code == 413


def test_import_metadata_normalized_at_submission_boundary(tmp_path):
    app = create_app(Settings(data_dir=tmp_path, min_free_bytes=0))
    client = ASGIClient(app)
    header = "target,off_target,assembly,chromosome,start,end,strand,coordinate_system,user_selected_locus,scores,source_tool\n"
    pair = "GACTACGATCGTAGCTACGTAGG,GACTACGATCGTAGCTACGTAGG,GRCh38,chr1,5,28,+,0-based half-open,true,1.0,Example\n"
    response = client.post("/api/v1/jobs", json={"mode": "pairs", "format": "csv", "input": header + pair})
    assert response.status_code == 202, response.text
    stored = json.loads((app.state.store.directory(response.json()["id"]) / "input.json").read_text())["pairs"][0]
    assert (stored["chromosome"], stored["start"], stored["end"]) == ("1", 5, 28)
    assert stored["source_chromosome"] == "chr1"
    assert stored["coordinate_verification"] == "user-supplied, not reference-verified"
    assert "user_selected_locus" not in stored and "scores" not in stored
    assert stored["source_tool"] == "Example"
    response = client.post("/api/v1/jobs", json={"mode": "pairs", "format": "csv", "input": header + pair.replace(",5,28,", ",6,28,")})
    assert response.status_code == 422
