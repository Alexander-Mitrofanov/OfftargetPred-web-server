#!/usr/bin/env python3
"""Real HTTP(S) acceptance test using synthetic sequences only.

No capabilities, payloads or response bodies are printed. Example:
  python tests/smoke_api.py --api-origin http://127.0.0.1:8010 \
      --origin https://alexander-mitrofanov.github.io
"""
import argparse
import csv
import io
import json
import math
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen


class SmokeFailure(RuntimeError):
    pass


class Client:
    def __init__(self, base, origin):
        self.base = base.rstrip("/") + "/api/v1"
        self.origin = origin
        self.jobs = []
        self.checks = []

    def request(self, method, path, payload=None, token=None, headers=None, expected=200):
        values = {"Origin": self.origin, "Accept": "application/json"}
        if token:
            values["Authorization"] = "Bearer " + token
        data = None
        if payload is not None:
            data = json.dumps(payload, separators=(",", ":")).encode()
            values["Content-Type"] = "application/json"
        values.update(headers or {})
        request = Request(self.base + path, data=data, headers=values, method=method)
        try:
            with urlopen(request, timeout=30) as response:
                status, result_headers, body = response.status, response.headers, response.read()
        except HTTPError as error:
            status, result_headers, body = error.code, error.headers, error.read()
        except (URLError, TimeoutError) as error:
            raise SmokeFailure("Connection failed during " + method + " " + path.split("?")[0]) from None
        if status != expected:
            raise SmokeFailure(f"Unexpected HTTP {status} during {method} {path.split('?')[0]} (expected {expected}).")
        return result_headers, body

    def json(self, method, path, **kwargs):
        headers, body = self.request(method, path, **kwargs)
        try:
            return headers, json.loads(body)
        except (ValueError, UnicodeError):
            raise SmokeFailure("Expected valid JSON from API.") from None

    def check(self, name, condition):
        if not condition:
            raise SmokeFailure("Check failed: " + name)
        self.checks.append(name)

    def submit(self, count=3):
        rows = ["id,target,off_target"]
        targets = ("AAAAAAAAAAAAAAAAAAAAAGG", "CCCCCCCCCCCCCCCCCCCCTGG", "GGGGGGGGGGGGGGGGGGGGTGG")
        for index in range(count):
            target = targets[index % len(targets)]
            candidate = ("T" if target[0] != "T" else "A") + target[1:]
            rows.append(f"synthetic-{index + 1},{target},{candidate}")
        _, job = self.json("POST", "/jobs", payload={"mode": "pairs", "input": "\n".join(rows) + "\n", "format": "csv", "models": [1, 2, 3], "name": "Synthetic acceptance test"}, expected=202)
        if not isinstance(job.get("id"), str) or not isinstance(job.get("token"), str):
            raise SmokeFailure("Submission did not return a job capability.")
        self.jobs.append(job)
        return job

    def wait(self, job, timeout, terminal=("completed",)):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            _, value = self.json("GET", f"/jobs/{job['id']}", token=job["token"])
            state = value.get("status")
            if state in terminal:
                return value
            if state in ("completed", "failed", "cancelled"):
                raise SmokeFailure("Unexpected terminal job state: " + str(state))
            time.sleep(1)
        raise SmokeFailure("Timed out waiting for a job.")

    def remove(self, job):
        self.request("DELETE", f"/jobs/{job['id']}", token=job["token"], expected=202)
        self.request("GET", f"/jobs/{job['id']}", token=job["token"], expected=404)
        self.jobs = [item for item in self.jobs if item["id"] != job["id"]]

    def cleanup(self):
        for job in list(self.jobs):
            try:
                self.remove(job)
            except Exception:
                pass


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--api-origin", required=True, help="HTTPS public origin or local HTTP API origin, without /api/v1")
    parser.add_argument("--origin", default="https://alexander-mitrofanov.github.io")
    parser.add_argument("--timeout", type=int, default=180)
    args = parser.parse_args()
    url = urlsplit(args.api_origin)
    if url.scheme not in ("http", "https") or not url.netloc or url.path not in ("", "/") or url.query or url.fragment or url.username:
        parser.error("--api-origin must be an HTTP(S) origin without path, credentials, query or fragment")
    client = Client(args.api_origin, args.origin)
    try:
        headers, health = client.json("GET", "/health")
        client.check("API health", health.get("status") == "ok")
        client.check("worker readiness", health.get("worker", {}).get("available") is True)
        client.check("CORS allowed origin", headers.get("Access-Control-Allow-Origin") == args.origin)
        client.check("no-store responses", headers.get("Cache-Control") and "no-store" in headers.get("Cache-Control"))
        _, capabilities = client.json("GET", "/capabilities")
        client.check("all three models advertised", {item["id"] for item in capabilities["models"]} == {1, 2, 3})
        headers, _ = client.request("OPTIONS", "/jobs", headers={"Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type"})
        client.check("CORS preflight", headers.get("Access-Control-Allow-Origin") == args.origin)
        headers, _ = client.request("GET", "/health", headers={"Origin": "https://untrusted.invalid"})
        client.check("untrusted origin cannot read through CORS", headers.get("Access-Control-Allow-Origin") is None)
        client.request("POST", "/jobs", payload={"mode": "pairs", "input": "x"}, headers={"Origin": "https://untrusted.invalid"}, expected=403)
        client.checks.append("untrusted browser submission rejected")

        job = client.submit()
        path = f"/jobs/{job['id']}"
        client.request("GET", path, expected=404)
        client.request("GET", path, token="incorrect-capability", expected=404)
        client.checks.append("capability authorization")
        status = client.wait(job, args.timeout)
        client.check("three real scored rows", status.get("result_count") == 3)
        _, result = client.json("GET", path + "/results?limit=2&sort=k1&order=desc", token=job["token"])
        client.check("pagination", result["total"] == 3 and len(result["rows"]) == 2)
        client.check("all model scores finite", all(set(row["scores"]) == {"k1", "k2", "k3"} and all(isinstance(score, (int, float)) and math.isfinite(score) and 0 <= score <= 1 for score in row["scores"].values()) for row in result["rows"]))
        client.check("global score sort", result["rows"][0]["scores"]["k1"] >= result["rows"][1]["scores"]["k1"])
        client.check("scientific provenance", bool(result.get("metadata", {}).get("models")) and result["metadata"].get("calibrated") is False)
        _, filtered = client.json("GET", path + "/results?q=synthetic-2", token=job["token"])
        client.check("global search", filtered["total"] == 1)
        headers, data = client.request("GET", path + "/download", token=job["token"])
        rows = list(csv.DictReader(io.StringIO(data.decode())))
        client.check("CSV download", len(rows) == 3 and all(f"score_k{k}" in rows[0] for k in (1, 2, 3)))
        client.check("download attachment", "attachment" in headers.get("Content-Disposition", ""))
        _, exported = client.json("GET", path + "/download?format=json", token=job["token"])
        client.check("JSON export preserves provenance", len(exported["rows"]) == 3 and exported["metadata"]["calibrated"] is False)
        client.remove(job)
        client.checks.append("completed result deletion")

        cancelled = client.submit(count=min(1000, capabilities["limits"]["pairs"]))
        client.json("POST", f"/jobs/{cancelled['id']}/cancel", token=cancelled["token"])
        client.wait(cancelled, 30, terminal=("cancelled",))
        client.remove(cancelled)
        client.checks.append("queued or running cancellation")

        deleted = client.submit()
        client.remove(deleted)
        client.checks.append("pending deletion revokes access")
        print(json.dumps({"status": "passed", "checks": client.checks, "release_id": health.get("release_id"), "configured_device": health.get("configured_device")}, indent=2))
        return 0
    except SmokeFailure as error:
        print("Smoke failed: " + str(error), file=sys.stderr)
        return 1
    finally:
        client.cleanup()


if __name__ == "__main__":
    raise SystemExit(main())
