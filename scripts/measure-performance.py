#!/usr/bin/env python3
"""Bounded real-GPU timings in an isolated VM staging directory, never production.

Usage: configure the same OFFTARGET_MODEL_DIR, reference and annotation variables
as staging, then run with the production Python runtime and --output-dir beneath
/srv/crispert/staging. No real user input or service queue is read or changed.
"""
import argparse
from dataclasses import replace
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import platform
import signal
import statistics
import subprocess
import sys
import time

from offtargetpred.config import Settings
from offtargetpred.jobs import ClientLimit, JobStore, write_json


def gpu_sample():
    try:
        line = subprocess.check_output([
            "nvidia-smi", "--query-gpu=name,utilization.gpu,memory.used",
            "--format=csv,noheader,nounits", "--id=0",
        ], text=True, timeout=3).strip().split(", ")
        return {"name": line[0], "utilization_percent": int(line[1]), "memory_mib": int(line[2])}
    except (OSError, ValueError, IndexError, subprocess.SubprocessError):
        return None


def fairness_probe(directory):
    store = JobStore(Settings(data_dir=directory, min_free_bytes=0))
    payload = {"mode": "pairs", "models": [1], "pairs": []}
    first = store.submit(payload, "192.0.2.1")
    rejected = False
    try:
        store.submit(payload, "192.0.2.1")
    except ClientLimit:
        rejected = True
    second = store.submit(payload, "192.0.2.2")
    fifo_first = store.claim() == first["id"]
    only_one = store.claim() is None
    store.finish(first["id"], "completed", count=0)
    fifo_second = store.claim() == second["id"]
    store.finish(second["id"], "completed", count=0)
    third = store.submit(payload, "192.0.2.1")
    for job in (first, second, third):
        store.cancel(job["id"], delete=True)
    return {"same_public_ip_second_pending_rejected": rejected,
            "different_public_ip_admitted": True, "fifo_order": fifo_first and fifo_second,
            "only_one_running_job": only_one, "same_ip_admitted_after_completion": True,
            "interpretation": "IP-based admission bounds anonymous abuse but can block another lab user behind the same NAT. It is not per-person fairness."}


def run_case(store, label, payload, repetition):
    job = store.submit(payload, "192.0.2.100")
    assert store.claim() == job["id"]
    environment = {**os.environ, "OFFTARGET_DATA_DIR": str(store.root), "OFFTARGET_DEVICE": "cuda"}
    started = time.monotonic()
    process = subprocess.Popen([sys.executable, "-m", "offtargetpred.worker", "--run-job", job["id"]],
                               env=environment, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                               stderr=subprocess.DEVNULL, start_new_session=True)
    samples, stages = [], []
    try:
        while process.poll() is None:
            if time.monotonic() - started > 180:
                raise TimeoutError("Bounded measurement exceeded 180 seconds")
            sample = gpu_sample()
            if sample:
                samples.append(sample)
            stage = store.public(store.get(job["id"]))["progress"]["stage"]
            if not stages or stages[-1] != stage:
                stages.append(stage)
            time.sleep(0.25)
        elapsed = time.monotonic() - started
        if process.returncode:
            raise RuntimeError("A staged measurement job failed; no partial measurement is reported")
        document = json.loads((store.directory(job["id"]) / "results.json").read_text())
        store.finish(job["id"], "completed", count=len(document["rows"]))
        progress = store.public(store.get(job["id"]))["progress"]
        return {"case": label, "repetition": repetition, "mode": payload["mode"],
                "models": payload["models"], "candidates": len(document["rows"]),
                "child_wall_seconds": round(elapsed, 3), "progress": progress,
                "observed_stages": stages, "device": document["metadata"]["device"],
                "annotation_available": document["metadata"]["annotations"]["available"],
                "gpu_sample_count": len(samples),
                "gpu_peak_utilization_percent": max((s["utilization_percent"] for s in samples), default=None),
                "gpu_peak_memory_mib": max((s["memory_mib"] for s in samples), default=None),
                "gpu_median_utilization_percent": statistics.median(s["utilization_percent"] for s in samples) if samples else None}
    finally:
        if process.poll() is None:
            os.killpg(process.pid, signal.SIGTERM)
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait(timeout=5)
        if store.get(job["id"])["status"] == "running":
            store.finish(job["id"], "failed", "Isolated measurement stopped.")
        store.cancel(job["id"], delete=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--repetitions", type=int, choices=(1, 2, 3), default=2)
    args = parser.parse_args()
    output = args.output_dir.resolve()
    staging = Path("/srv/crispert/staging").resolve()
    if not output.is_relative_to(staging) or output == staging or output.exists():
        parser.error("Choose a new directory beneath /srv/crispert/staging")
    output.mkdir(mode=0o700)
    settings = replace(Settings(), data_dir=output / "jobs", device="cuda", min_free_bytes=0)
    if not settings.reference() or not settings.annotation_db:
        parser.error("Configure the verified staging reference and annotation DB before measuring")
    gpu = gpu_sample()
    if not gpu:
        parser.error("A readable real GPU is required")
    store = JobStore(settings)
    target = "TGAGACTCTTGCAGTCACACAGG"  # The public, frozen GRCh38 example.
    pair = {"id": "public-example", "target": target, "off_target": target}
    cases = [
        ("one-pair-k1", {"mode": "pairs", "models": [1], "pairs": [pair]}),
        ("one-pair-all-models", {"mode": "pairs", "models": [1, 2, 3], "pairs": [pair]}),
        ("32-pairs-all-models", {"mode": "pairs", "models": [1, 2, 3],
                                "pairs": [{**pair, "id": f"public-example-{i + 1}"} for i in range(32)]}),
        ("one-guide-one-mismatch-all-models", {"mode": "genome", "models": [1, 2, 3],
            "guides": [{"id": "public-example", "target": target}], "max_mismatches": 1}),
    ]
    results = []
    for label, payload in cases:
        for repetition in range(1, args.repetitions + 1):
            result = run_case(store, label, payload, repetition)
            results.append(result)
            print(json.dumps({"case": label, "repetition": repetition,
                              "wall_seconds": result["child_wall_seconds"]}), flush=True)
    backend = Path(__file__).resolve().parents[1] / "backend" / "offtargetpred"
    report = {
        "schema_version": 1, "measured_at": datetime.now(timezone.utc).isoformat(),
        "platform": {"python": platform.python_version(), "cpu_count": os.cpu_count(), "gpu": gpu["name"]},
        "method": "Sequential fresh child process per job; pre-existing OS filesystem caches; no model reuse across jobs. Public example sequence only. 32-pair workload repeats one sequence with distinct IDs. No production queue or jobs accessed.",
        "limits": f"{args.repetitions} small repeat(s) per case characterize this VM only, not a capacity/stress test or a latency guarantee. Queue times here are immediate manual claims; real queue waits depend on other users. GPU samples describe the whole device and may miss short peaks; unrelated VM processes can affect timings.",
        "source_sha256": {name: hashlib.sha256((backend / name).read_bytes()).hexdigest()
                          for name in ("worker.py", "jobs.py", "progress.py", "search.py", "inference.py", "annotations.py")},
        "reference_sha256": settings.reference()["sha256"],
        "fairness": fairness_probe(output / "fairness"), "measurements": results,
    }
    write_json(output / "performance.json", report)
    print(str(output / "performance.json"), flush=True)


if __name__ == "__main__":
    main()
