"""Bounded Cas-OFFinder 2.4.1 candidate discovery against verified GRCh38."""

from __future__ import annotations

import hashlib
import os
from pathlib import Path
import re
import subprocess
import time

from .sequence import ValidationError, normalize_guides, sequence_annotations


class SearchError(RuntimeError):
    """A search could not complete; no partial results should be presented."""


def parse_cas_offinder_output(output: str | Path, guides: list[dict], mismatches: int,
                             max_candidates: int = 50_000) -> list[dict]:
    """2.4.1 untagged columns: query, contig, start0, oriented DNA, strand, mm.

    Query PAMs are NNN for discovery, but each original full guide PAM is
    restored before model scoring. Coordinates remain 0-based half-open.
    """
    lookup = {}
    for guide in normalize_guides(guides):
        lookup.setdefault(guide["target"][:20] + "NNN", []).append(guide)
    rows, seen = [], set()
    with Path(output).open() as stream:
        for line_number, line in enumerate(stream, 1):
            fields = line.rstrip("\r\n").split("\t")
            if len(fields) != 6:
                raise SearchError(f"Unexpected Cas-OFFinder output at line {line_number}.")
            query, chromosome, position, site, strand, reported = fields
            # Cas-OFFinder 2.4.1 copies the entire FASTA description after >.
            # The conventional contig identifier is the first whitespace token
            # (for Ensembl, e.g. "1", not "1 dna:chromosome chromosome:...").
            # Normalize before duplicate detection and all output construction.
            chromosome = chromosome.split()[0] if chromosome.split() else ""
            site = site.upper()
            if query not in lookup or not chromosome or strand not in {"+", "-"}:
                raise SearchError("Cas-OFFinder returned an unknown query or invalid locus.")
            if not re.fullmatch("[ACGT]{21}GG", site):
                raise SearchError("Cas-OFFinder returned a non-NGG or ambiguous candidate.")
            try:
                start, reported = int(position), int(reported)
            except ValueError as exc:
                raise SearchError("Cas-OFFinder returned invalid coordinate or mismatch data.") from exc
            recomputed = sum(a != b for a, b in zip(query[:20], site[:20]))
            if start < 0 or reported != recomputed or recomputed > mismatches:
                raise SearchError("Cas-OFFinder mismatch verification failed.")
            for guide in lookup[query]:
                key = (guide["id"], chromosome, start, strand)
                if key in seen:
                    continue
                seen.add(key)
                rows.append({
                    "id": f"candidate-{len(rows) + 1}",
                    "guide_id": guide["id"], "target": guide["target"], "off_target": site,
                    "chromosome": chromosome, "position": start, "start": start, "end": start + 23,
                    "strand": strand, "coordinate_system": "0-based half-open", "assembly": "GRCh38",
                    **sequence_annotations(guide["target"], site),
                })
                if len(rows) > max_candidates:
                    raise SearchError(f"Search exceeded {max_candidates:,} candidates. Reduce the mismatch limit or number of guides; no partial result is reported.")
    rows.sort(key=lambda r: (r["guide_id"], r["mismatches"], r["chromosome"], r["start"], r["strand"]))
    return rows


class CasOffinderSearch:
    def __init__(self, binary: str | Path, genome_dir: str | Path, reference_metadata: dict,
                 timeout: int = 1800, max_candidates: int = 50_000, device: str = "G0"):
        self.binary = Path(binary).resolve()
        self.genome_dir = Path(genome_dir).resolve()
        self.reference_metadata = dict(reference_metadata)
        self.timeout = timeout
        self.max_candidates = max_candidates
        if not re.fullmatch("[GCA][0-9]*", device):
            raise SearchError("Invalid Cas-OFFinder device configuration.")
        self.device = device
        if not self.binary.is_file() or not os.access(self.binary, os.X_OK):
            raise SearchError("Cas-OFFinder is not installed.")
        if reference_metadata.get("assembly", reference_metadata.get("id")) != "GRCh38" or reference_metadata.get("verified") is not True:
            raise SearchError("A verified GRCh38 primary assembly is required.")
        filename = reference_metadata.get("filename", "")
        if not filename or Path(filename).name != filename:
            raise SearchError("Reference filename must name one installed FASTA.")
        reference = self.genome_dir / filename
        if not reference.is_file() or reference.stat().st_size == 0:
            raise SearchError("The reference FASTA is not installed.")
        digest = hashlib.sha256()
        with reference.open("rb") as stream:
            for chunk in iter(lambda: stream.read(8 * 1024 * 1024), b""):
                digest.update(chunk)
        if digest.hexdigest() != reference_metadata.get("sha256"):
            raise SearchError("Reference FASTA failed SHA-256 verification.")
        # Cas-OFFinder accepts either a directory or a single genome file.
        # Use the exact verified file, never an unverified adjacent reference.
        self.reference = reference

    def metadata(self) -> dict:
        return {**self.reference_metadata, "engine": "Cas-OFFinder 2.4.1", "pam": "NGG",
                "engine_source_commit": "9816b94c20c4cba2e79b039e1e2a6dee684b7b66",
                "engine_binary_sha256": hashlib.sha256(self.binary.read_bytes()).hexdigest(),
                "mismatch_range": [0, 6], "max_guides": 10, "max_candidates": self.max_candidates,
                "bulges": False, "coordinate_system": "0-based half-open"}

    def search(self, guides: list[dict], mismatches: int, work_dir: str | Path) -> list[dict]:
        guides = normalize_guides(guides)
        if isinstance(mismatches, bool) or not isinstance(mismatches, int) or not 0 <= mismatches <= 6:
            raise ValidationError("Choose a mismatch limit from 0 to 6.")
        work_dir = Path(work_dir).resolve()
        work_dir.mkdir(parents=True, exist_ok=True)
        input_path, output_path = work_dir / "cas-input.txt", work_dir / "cas-output.tsv"
        log_path = work_dir / "cas-offinder.log"
        if any(path.exists() for path in (input_path, output_path, log_path)):
            raise SearchError("Search work directory already contains a previous run.")
        queries = sorted({g["target"][:20] + "NNN" for g in guides})
        # 20 wildcard protospacer positions + NGG = 21 N followed by GG.
        input_path.write_text(str(self.reference) + "\n" + "N" * 21 + "GG\n" +
                              "".join(f"{query} {mismatches}\n" for query in queries))
        started = time.monotonic()
        with log_path.open("wb") as log:
            process = subprocess.Popen([str(self.binary), str(input_path), self.device, str(output_path)],
                                       stdout=log, stderr=subprocess.STDOUT)
            try:
                while process.poll() is None:
                    if time.monotonic() - started > self.timeout:
                        raise SearchError("Genome search exceeded its time limit. Reduce the mismatch limit or guide count.")
                    # Hard bound output disk use in addition to post-parse hit count.
                    if (output_path.exists() and output_path.stat().st_size > self.max_candidates * 512) or log_path.stat().st_size > 10_000_000:
                        raise SearchError("Search exceeded its output limit. Reduce the mismatch limit or guide count.")
                    time.sleep(0.2)
                if process.returncode != 0 or not output_path.exists():
                    raise SearchError("Genome search did not complete. The service operator can inspect its private log.")
            except BaseException:
                if process.poll() is None:
                    process.kill()
                    process.wait()
                raise
        return parse_cas_offinder_output(output_path, guides, mismatches, self.max_candidates)
