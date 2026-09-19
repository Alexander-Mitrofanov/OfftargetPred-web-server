"""Explicit runtime settings, shared by API and worker."""
from dataclasses import dataclass, field
from pathlib import Path
import json
import os


@dataclass(frozen=True)
class Settings:
    data_dir: Path = field(default_factory=lambda: Path(os.environ.get("OFFTARGET_DATA_DIR", "/srv/crispert/data")))
    model_dir: Path = field(default_factory=lambda: Path(os.environ.get("OFFTARGET_MODEL_DIR", "/srv/crispert/models")))
    device: str = field(default_factory=lambda: os.environ.get("OFFTARGET_DEVICE", "cpu"))
    allowed_origins: tuple[str, ...] = field(default_factory=lambda: tuple(x.strip() for x in os.environ.get("OFFTARGET_ALLOWED_ORIGINS", "https://alexander-mitrofanov.github.io").split(",") if x.strip()))
    cas_offinder: str = field(default_factory=lambda: os.environ.get("OFFTARGET_CAS_OFFINDER", ""))
    genome_dir: Path | None = field(default_factory=lambda: Path(os.environ["OFFTARGET_GENOME_DIR"]) if os.environ.get("OFFTARGET_GENOME_DIR") else None)
    reference_metadata: Path | None = field(default_factory=lambda: Path(os.environ["OFFTARGET_REFERENCE_METADATA"]) if os.environ.get("OFFTARGET_REFERENCE_METADATA") else None)
    max_request_bytes: int = 5 * 1024 * 1024
    max_pairs: int = 10_000
    max_guides: int = 10
    max_candidates: int = 50_000
    max_queued: int = 10
    max_submissions_hour: int = 30
    retention_hours: int = 24
    min_free_bytes: int = 20 * 1024 ** 3
    job_timeout_seconds: int = 900
    worker_stale_seconds: int = 60
    release_id: str = field(default_factory=lambda: os.environ.get("OFFTARGET_RELEASE_ID", "development"))

    def reference(self) -> dict | None:
        if not self.cas_offinder or not self.genome_dir or not self.reference_metadata:
            return None
        try:
            metadata = json.loads(self.reference_metadata.read_text())
            if metadata.get("assembly") != "GRCh38" or metadata.get("verified") is not True:
                return None
            filename = metadata.get("filename")
            if not filename or Path(filename).name != filename:
                return None
            if not (self.genome_dir / filename).is_file() or not os.access(self.cas_offinder, os.X_OK):
                return None
            return metadata
        except (OSError, ValueError, TypeError):
            return None
