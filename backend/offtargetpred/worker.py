"""Single supervisor, isolated per-job process, crash recovery and retention."""
import argparse
import fcntl
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time

from .config import Settings
from .jobs import JobStore, write_json


def execute_job(settings: Settings, store: JobStore, job_id: str):
    from .inference import InferenceEngine
    directory = store.directory(job_id)
    payload = json.loads((directory / "input.json").read_text())
    if payload["mode"] == "genome":
        from .search import CasOffinderSearch
        reference = settings.reference()
        if not reference:
            raise RuntimeError("Reference unavailable")
        search = CasOffinderSearch(settings.cas_offinder, settings.genome_dir, reference, timeout=settings.job_timeout_seconds - 60, max_candidates=settings.max_candidates)
        pairs = search.search(payload["guides"], mismatches=payload["max_mismatches"], work_dir=directory / "search")
    else:
        pairs = payload["pairs"]
    engine = InferenceEngine(settings.model_dir, device=settings.device, batch_size=256)
    model_keys = [f"k{k}" for k in payload["models"]]
    rows = engine.score(pairs, models=model_keys) if pairs else []
    metadata = {"mode": payload["mode"], "model_keys": model_keys, "release_id": settings.release_id, "device": engine.device, "score_label": "CRISPert score", "calibrated": False, "coordinate_system": "0-based half-open" if payload["mode"] == "genome" else None, "models": engine.metadata()}
    if payload["mode"] == "genome":
        metadata["reference"] = search.metadata()
        metadata["max_mismatches"] = payload["max_mismatches"]
    write_json(directory / "results.json", {"rows": rows, "metadata": metadata})


def stop_child(process):
    if process.poll() is None:
        try:
            os.killpg(process.pid, signal.SIGTERM)
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGKILL)
            process.wait(timeout=5)
        except ProcessLookupError:
            pass


def run(settings: Settings):
    store = JobStore(settings)
    lock = open(settings.data_dir / "worker.lock", "a")
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        raise SystemExit("A worker is already running.")
    stopping = False

    def request_stop(signum, frame):
        nonlocal stopping
        stopping = True

    signal.signal(signal.SIGTERM, request_stop)
    signal.signal(signal.SIGINT, request_stop)
    store.worker_offline()
    store.recover()
    # Readiness requires real model loading and a forward pass on the configured
    # device. This supervisor never retains models while a job child is running.
    from .inference import InferenceEngine
    probe = InferenceEngine(settings.model_dir, device=settings.device, batch_size=1)
    probe.score([{"target": "A" * 20 + "AGG", "off_target": "A" * 19 + "T" + "AGG"}], models=["k1", "k2", "k3"])
    del probe
    if settings.device.startswith("cuda"):
        import torch
        torch.cuda.empty_cache()
    last_cleanup = 0
    while not stopping:
        store.heartbeat()
        if time.monotonic() - last_cleanup > 30:
            store.cleanup()
            last_cleanup = time.monotonic()
        job_id = store.claim()
        if not job_id:
            time.sleep(1)
            continue
        process = subprocess.Popen([sys.executable, "-m", "offtargetpred.worker", "--run-job", job_id], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True, pass_fds=(lock.fileno(),))
        started = time.monotonic()
        timeout = False
        try:
            while process.poll() is None:
                store.heartbeat()
                if time.monotonic() - last_cleanup > 30:
                    store.cleanup()
                    last_cleanup = time.monotonic()
                row = store.get(job_id)
                timeout = time.monotonic() - started > settings.job_timeout_seconds
                if stopping or row["cancel_requested"] or timeout or row["expires"] < time.time():
                    stop_child(process)
                    break
                time.sleep(1)
            row = store.get(job_id)
            if row["cancel_requested"]:
                store.finish(job_id, "cancelled")
            elif stopping:
                store.finish(job_id, "failed", "The worker stopped. Please submit the job again.")
            elif timeout:
                store.finish(job_id, "failed", "Job exceeded the runtime limit. Reduce the input size or mismatch count.")
            elif process.returncode == 0:
                document = json.loads((store.directory(job_id) / "results.json").read_text())
                store.finish(job_id, "completed", count=len(document["rows"]))
            else:
                error = "Prediction failed. Check the input or contact the server operator with the job ID."
                safe_error = store.directory(job_id) / "error.json"
                if safe_error.is_file():
                    error = json.loads(safe_error.read_text())["message"]
                store.finish(job_id, "failed", error)
        except Exception:
            stop_child(process)
            store.finish(job_id, "failed", "The worker could not complete this job. Please retry.")
    store.worker_offline()
    lock.close()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--run-job")
    args = parser.parse_args()
    settings = Settings()
    if args.run_job:
        store = JobStore(settings)
        try:
            execute_job(settings, store, args.run_job)
        except Exception as error:
            # These exception classes are intentionally safe, static operational
            # messages. Never publish arbitrary exception text or tracebacks.
            from .inference import ModelError
            from .search import SearchError
            from .sequence import ValidationError
            if isinstance(error, (ModelError, SearchError, ValidationError)):
                write_json(store.directory(args.run_job) / "error.json", {"message": str(error)[:500]})
            raise SystemExit(1) from None
    else:
        run(settings)


if __name__ == "__main__":
    main()
