from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
import json
import os
import time
import uuid

import pytest

from offtargetpred.config import Settings
from offtargetpred.jobs import ClientLimit, JobStore, NotFound, QueueFull, StorageFull, write_json


@pytest.fixture
def store(tmp_path):
    return JobStore(Settings(data_dir=tmp_path, min_free_bytes=0))


def payload():
    return {"mode": "pairs", "models": [1], "pairs": [{"id": "example", "target": "A" * 20 + "AGG", "off_target": "A" * 20 + "AGG"}]}


def test_capability_is_private_and_survives_restart(store):
    submitted = store.submit(payload(), "192.0.2.1")
    assert store.authorize(submitted["id"], submitted["token"])["status"] == "queued"
    with pytest.raises(NotFound):
        store.authorize(submitted["id"], "wrong")
    again = JobStore(store.settings)
    assert again.authorize(submitted["id"], submitted["token"])["id"] == submitted["id"]
    assert submitted["token"].encode() not in store.database.read_bytes()
    assert "192.0.2.1" not in json.dumps(store.get(submitted["id"]))


def test_concurrent_admission_respects_global_capacity(tmp_path):
    store = JobStore(Settings(data_dir=tmp_path, min_free_bytes=0, max_queued=2))
    def submit(index):
        try:
            return store.submit(payload(), f"client{index}")
        except QueueFull:
            return None
    with ThreadPoolExecutor(max_workers=8) as executor:
        accepted = [item for item in executor.map(submit, range(8)) if item]
    assert len(accepted) == 2
    assert len(list(store.jobs_root.iterdir())) == 2


def test_client_limit_and_only_one_claim(store):
    first = store.submit(payload(), "client1")
    with pytest.raises(ClientLimit):
        store.submit(payload(), "client1")
    second = store.submit(payload(), "client2")
    assert store.claim() == first["id"]
    assert store.claim() is None
    store.finish(first["id"], "completed", count=1)
    assert store.claim() == second["id"]


def test_cancel_running_delete_cannot_race_worker(store):
    job = store.submit(payload(), "client")
    store.claim()
    assert store.cancel(job["id"], delete=True)
    assert store.directory(job["id"]).exists()
    with pytest.raises(NotFound):
        store.authorize(job["id"], job["token"])
    store.finish(job["id"], "completed", count=1)
    assert not store.directory(job["id"]).exists()
    with pytest.raises(NotFound):
        store.get(job["id"])


def test_recovery_expiry_and_rate_history(store):
    job = store.submit(payload(), "client")
    store.claim()
    store.recover()
    assert store.get(job["id"])["status"] == "failed"
    with store.connect() as db:
        db.execute("UPDATE jobs SET expires=?", (time.time() - 1,))
    with pytest.raises(NotFound):
        store.authorize(job["id"], job["token"])
    store.cleanup()
    assert not store.directory(job["id"]).exists()
    # Deleting a job must not bypass the rolling submission quota.
    limited = JobStore(replace(store.settings, max_submissions_hour=1))
    with pytest.raises(ClientLimit):
        limited.submit(payload(), "client")


def test_disk_reserve(store):
    store.settings = replace(store.settings, min_free_bytes=10**30)
    with pytest.raises(StorageFull):
        store.submit(payload(), "client")
    assert not list(store.jobs_root.iterdir())


def test_atomic_results_and_cancelled_output_removed(store):
    job = store.submit(payload(), "client")
    store.claim()
    path = store.directory(job["id"]) / "results.json"
    write_json(path, {"rows": []})
    store.cancel(job["id"])
    store.finish(job["id"], "completed", count=0)
    assert store.get(job["id"])["status"] == "cancelled"
    assert not path.exists()


def test_job_paths_are_not_user_paths(store):
    with pytest.raises(NotFound):
        store.directory("../../etc/passwd")


def test_deletion_is_sticky_across_delayed_cancel(store):
    job = store.submit(payload(), "client")
    store.claim()
    store.cancel(job["id"], delete=True)
    store.cancel(job["id"], delete=False)
    assert store.get(job["id"])["delete_requested"] == 1
    with pytest.raises(NotFound):
        store.authorize(job["id"], job["token"])
    store.finish(job["id"], "cancelled")
    assert not store.directory(job["id"]).exists()


def test_cleanup_reaps_old_orphans_but_keeps_active_submissions(store):
    old = store.directory(str(uuid.uuid4()))
    fresh = store.directory(str(uuid.uuid4()))
    old.mkdir()
    fresh.mkdir()
    write_json(old / "input.json", payload())
    os.utime(old, (time.time() - 90_000, time.time() - 90_000))
    store.cleanup()
    assert not old.exists()
    assert fresh.exists()
