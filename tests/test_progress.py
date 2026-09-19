"""Measured stages stay bounded, private, and subordinate to durable job state."""
import json
import stat
import sys
from types import SimpleNamespace

import pytest

from offtargetpred.config import Settings
from offtargetpred.jobs import ClientLimit, JobStore, write_json
from offtargetpred.progress import JobProgress, MAX_PROGRESS_BYTES, public_progress


def state(**overrides):
    return {"status": "running", "created": 100, "started": 110,
            "finished": None, "cancel_requested": False, **overrides}


def test_real_phase_duration_and_private_atomic_file(tmp_path):
    clock = [4.0]
    progress = JobProgress(tmp_path, clock=lambda: clock[0])
    with progress.phase("scoring"):
        assert json.loads(progress.path.read_text())["stage"] == "scoring"
        clock[0] += 2.125
    progress.publish("complete")
    assert json.loads(progress.path.read_text())["phase_seconds"] == {"scoring": 2.125}
    assert stat.S_IMODE(progress.path.stat().st_mode) == 0o600
    assert progress.path.stat().st_size <= MAX_PROGRESS_BYTES
    assert not progress.path.with_suffix(".json.tmp").exists()


def test_phase_failure_preserves_measured_time(tmp_path):
    clock = [0.0]
    progress = JobProgress(tmp_path, clock=lambda: clock[0])
    with pytest.raises(RuntimeError), progress.phase("search"):
        clock[0] = 3
        raise RuntimeError("private error")
    result = public_progress(progress.path, state(status="failed", finished=114), now=900)
    assert result["stage"] == "failed"
    assert result["phase_seconds"] == {"search": 3}
    assert result["elapsed_seconds"] == 4
    assert "private" not in json.dumps(result)


@pytest.mark.parametrize("status, cancel, expected", [
    ("queued", False, "queued"), ("running", False, "scoring"),
    ("running", True, "cancelling"), ("cancelled", True, "cancelled"),
    ("failed", False, "failed"), ("completed", False, "complete"),
])
def test_durable_job_state_wins(tmp_path, status, cancel, expected):
    path = tmp_path / "progress.json"
    write_json(path, {"schema_version": 1, "stage": "scoring", "phase_seconds": {"search": 5}})
    result = public_progress(path, state(status=status, cancel_requested=cancel), now=120)
    assert result["stage"] == expected
    assert result["queue_seconds"] == 10
    assert result["elapsed_seconds"] == 10


def test_untrusted_file_is_allowlisted_and_bounded(tmp_path):
    path = tmp_path / "progress.json"
    path.write_text(json.dumps({"schema_version": 1, "stage": "scoring", "token": "secret",
                               "message": "a private sequence", "elapsed_seconds": 999,
                               "phase_seconds": {"search": 1.5, "secret": 1, "writing": True,
                                                 "annotation": -1, "scoring": float("nan"),
                                                 "preparing": 100_000}}))
    result = public_progress(path, state(), now=120)
    assert result["phase_seconds"] == {"search": 1.5}
    assert "secret" not in json.dumps(result)
    assert "private sequence" not in json.dumps(result)
    assert result["elapsed_seconds"] == 10
    path.write_text(" " * (MAX_PROGRESS_BYTES + 1))
    assert public_progress(path, state(), now=120)["stage"] == "preparing"


@pytest.mark.parametrize("contents", [None, "{broken", "null", "[]", '{"schema_version":1,"stage":[],"phase_seconds":[] }'])
def test_missing_or_malformed_progress_does_not_hide_job(tmp_path, contents):
    path = tmp_path / "progress.json"
    if contents is not None:
        path.write_text(contents)
    assert public_progress(path, state(), now=120)["stage"] == "preparing"


def test_unstarted_job_queue_duration_stops_at_cancellation(tmp_path):
    assert public_progress(tmp_path / "missing", state(status="queued", started=None), now=120)["queue_seconds"] == 20
    cancelled = public_progress(tmp_path / "missing", state(status="cancelled", started=None, finished=115), now=120)
    assert cancelled["queue_seconds"] == 15
    assert cancelled["elapsed_seconds"] == 0


def test_jobstore_public_exposes_only_sanitized_progress(tmp_path):
    store = JobStore(Settings(data_dir=tmp_path, min_free_bytes=0))
    job = store.submit({"mode": "pairs", "models": [1], "pairs": []}, "192.0.2.10")
    result = store.public(store.authorize(job["id"], job["token"]))
    assert result["progress"]["stage"] == "queued"
    assert job["token"] not in json.dumps(result)
    assert "192.0.2.10" not in json.dumps(result)


def test_shared_nat_limit_and_fifo_are_explicit(tmp_path):
    store = JobStore(Settings(data_dir=tmp_path, min_free_bytes=0))
    payload = {"mode": "pairs", "models": [1], "pairs": []}
    first = store.submit(payload, "192.0.2.10")
    with pytest.raises(ClientLimit):
        store.submit(payload, "192.0.2.10")  # Another lab user shares this public IP.
    second = store.submit(payload, "192.0.2.11")
    assert store.claim() == first["id"]
    assert store.claim() is None  # No GPU overlap between jobs.
    store.finish(first["id"], "completed", count=0)
    assert store.claim() == second["id"]
    third = store.submit(payload, "192.0.2.10")
    assert third["id"] != first["id"]


def test_pairs_without_coordinates_never_open_annotation_database(tmp_path, monkeypatch):
    from offtargetpred import annotations
    from offtargetpred.worker import execute_job

    class FakeEngine:
        device = "cpu"
        def __init__(self, *args, **kwargs):
            pass
        def score(self, pairs, models):
            return [{**row, "scores": {"k1": 0.5}} for row in pairs]
        def metadata(self):
            return {"fixture": True}

    def forbidden(*args, **kwargs):
        raise AssertionError("A coordinate-free job must not open a 1.3 GB annotation DB")

    monkeypatch.setitem(sys.modules, "offtargetpred.inference", SimpleNamespace(InferenceEngine=FakeEngine))
    monkeypatch.setattr(annotations, "AnnotationIndex", forbidden)
    monkeypatch.setattr(Settings, "reference", lambda self: {"assembly": "GRCh38", "verified": True})
    settings = Settings(data_dir=tmp_path, min_free_bytes=0, annotation_db=tmp_path / "annotations.sqlite")
    store = JobStore(settings)
    job = store.submit({"mode": "pairs", "models": [1], "pairs": [
        {"id": "fixture", "target": "A" * 20 + "AGG", "off_target": "A" * 20 + "AGG"}
    ]}, "fixture")
    store.claim()
    execute_job(settings, store, job["id"])
    document = json.loads((store.directory(job["id"]) / "results.json").read_text())
    assert document["rows"][0]["annotations"]["status"] == "no_coordinates"
    assert document["metadata"]["annotations"]["available"] is False
    assert set(document["metadata"]["timings"]["phase_seconds"]) == {"preparing", "scoring", "annotation"}
    assert "writing" in json.loads((store.directory(job["id"]) / "progress.json").read_text())["phase_seconds"]
