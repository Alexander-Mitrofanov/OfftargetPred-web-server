"""Coarse, measured job stages; no sequences, capabilities or guessed percentages."""
from __future__ import annotations

from contextlib import contextmanager
import json
import math
from pathlib import Path
import time


MESSAGES = {
    "queued": "Waiting for the worker.",
    "preparing": "Preparing the isolated prediction process.",
    "search": "Searching the reference genome within the selected limits.",
    "scoring": "Loading the selected models and scoring candidate sequences.",
    "annotation": "Adding local genomic annotations when coordinates are available.",
    "writing": "Saving the complete result and provenance.",
    "complete": "The complete result is ready.",
    "failed": "This job did not complete.",
    "cancelled": "This job was cancelled.",
    "cancelling": "Stopping the current job.",
}
PHASES = ("preparing", "search", "scoring", "annotation", "writing")
MAX_PROGRESS_BYTES = 4096


class JobProgress:
    def __init__(self, directory: Path, *, clock=time.monotonic):
        self.path = directory / "progress.json"
        self.clock = clock
        self.started = clock()
        self.phase_seconds: dict[str, float] = {}

    def elapsed(self) -> float:
        return round(max(0, self.clock() - self.started), 3)

    def publish(self, stage: str):
        from .jobs import write_json
        if stage not in (*PHASES, "complete"):
            raise ValueError("Unknown job stage")
        write_json(self.path, {"schema_version": 1, "stage": stage,
                              "phase_seconds": self.phase_seconds,
                              "elapsed_seconds": self.elapsed()})

    @contextmanager
    def phase(self, stage: str):
        if stage not in PHASES:
            raise ValueError("Unknown measured phase")
        self.publish(stage)
        started = self.clock()
        try:
            yield
        finally:
            self.phase_seconds[stage] = round(max(0, self.clock() - started), 3)
            self.publish(stage)


def _duration(value):
    return (round(value, 3) if isinstance(value, (int, float)) and not isinstance(value, bool)
            and math.isfinite(value) and 0 <= value <= 86_400 else None)


def public_progress(path: Path, row: dict, *, now: float | None = None) -> dict:
    """Read a small private file, returning only static labels and finite timings.

    JobStore calls this only after the API has authorized the job capability.
    Database status wins over a stale stage left by a killed child process.
    """
    now = time.time() if now is None else now
    status = row["status"]
    stage = "preparing" if status == "running" else status
    phase_seconds = {}
    try:
        with path.open("rb") as stream:
            raw = stream.read(MAX_PROGRESS_BYTES + 1)
        if len(raw) <= MAX_PROGRESS_BYTES:
            value = json.loads(raw)
            if isinstance(value, dict) and value.get("schema_version") == 1:
                candidate = value.get("stage")
                if status == "running" and candidate in (*PHASES, "complete"):
                    stage = candidate
                durations = value.get("phase_seconds")
                if isinstance(durations, dict):
                    phase_seconds = {key: duration for key in PHASES
                                     if (duration := _duration(durations.get(key))) is not None}
    except (OSError, ValueError, TypeError):
        pass  # A missing or damaged progress file must not hide the job itself.
    if status == "completed":
        stage = "complete"
    if row.get("cancel_requested") and status == "running":
        stage = "cancelling"
    if stage not in MESSAGES:
        stage = "preparing"
    stopped = row.get("finished") or now
    started = row.get("started")
    return {
        "stage": stage, "message": MESSAGES[stage],
        "queue_seconds": round(max(0, (started or stopped) - row["created"]), 3),
        "elapsed_seconds": round(max(0, stopped - started), 3) if started else 0,
        "phase_seconds": phase_seconds,
    }
