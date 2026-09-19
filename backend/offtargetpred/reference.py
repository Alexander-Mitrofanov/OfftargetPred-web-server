"""Verified local FASTA access, shared by bounded coordinate-based features.

The index builder checks FASTA layout and binds the standard .fai to the exact
verified FASTA. Each process verifies both file hashes once per file identity;
replacement or modification invalidates the cache. No network or genome scan is
performed during a subsequent interval fetch.
"""
from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
import hashlib
import json
import os
from pathlib import Path
import re
import stat
from threading import RLock

MAX_REFERENCE_READ = 1_000_000
INDEX_SCHEMA = 1
_DNA = b"ACGTRYSWKMBDHVNacgtryswkmbdhvn"
_LOCK = RLock()


class ReferenceUnavailable(ValueError):
    """The installed reference/index cannot establish safe sequence access."""


def file_sha256(path: str | Path) -> str:
    with Path(path).open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def _identity(path: Path) -> tuple[int, ...]:
    try:
        info = path.stat()
    except OSError as exc:
        raise ReferenceUnavailable("Reference or index is unavailable.") from exc
    if not stat.S_ISREG(info.st_mode):
        raise ReferenceUnavailable("Reference and index must be regular files.")
    return (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns)


def _metadata(reference: dict, path: Path) -> None:
    if not isinstance(reference, dict) or reference.get("verified") is not True or reference.get("assembly") != "GRCh38":
        raise ReferenceUnavailable("A verified GRCh38 reference is required.")
    if not isinstance(reference.get("sha256"), str) or not re.fullmatch(r"[0-9a-f]{64}", reference["sha256"]):
        raise ReferenceUnavailable("Verified reference SHA-256 is missing.")
    if reference.get("filename") != path.name:
        raise ReferenceUnavailable("Reference filename does not match its provenance.")


@dataclass(frozen=True)
class FastaRecord:
    name: str
    length: int
    offset: int
    line_bases: int
    line_width: int

    def row(self) -> str:
        return f"{self.name}\t{self.length}\t{self.offset}\t{self.line_bases}\t{self.line_width}\n"

    def position(self, base: int) -> int:
        return self.offset + (base // self.line_bases) * self.line_width + base % self.line_bases


def _scan_fasta(path: Path) -> tuple[list[FastaRecord], str]:
    """Derive index geometry while hashing every byte; reject irregular wrapping."""
    records: list[FastaRecord] = []
    seen: set[str] = set()
    digest = hashlib.sha256()
    name, length, offset, line_bases, line_width = None, 0, 0, 0, 0
    previous_bases, previous_width = 0, 0

    def finish() -> None:
        if name is not None:
            if not length:
                raise ReferenceUnavailable("Empty reference contigs cannot be indexed.")
            records.append(FastaRecord(name, length, offset, line_bases, line_width))

    with path.open("rb") as stream:
        for raw in stream:
            digest.update(raw)
            if raw.startswith(b">"):
                finish()
                fields = raw[1:].split()
                if not fields:
                    raise ReferenceUnavailable("Reference has an empty contig name.")
                name = fields[0].decode("ascii")
                if name in seen or not re.fullmatch(r"[!-~]+", name):
                    raise ReferenceUnavailable("Reference contig names are invalid or duplicated.")
                seen.add(name)
                length, line_bases, line_width = 0, 0, 0
                offset = stream.tell()
                continue
            bases = raw.rstrip(b"\r\n")
            if name is None or not bases or bases.translate(None, _DNA):
                raise ReferenceUnavailable("Reference contains an invalid FASTA sequence line.")
            if len(raw) - len(bases) not in (0, 1, 2) or (len(raw) - len(bases) == 2 and not raw.endswith(b"\r\n")):
                raise ReferenceUnavailable("Reference contains invalid FASTA line endings.")
            if length:
                if previous_bases != line_bases or previous_width != line_width or len(bases) > line_bases:
                    raise ReferenceUnavailable("Reference FASTA line wrapping is inconsistent.")
                if len(bases) == line_bases and len(raw) not in (line_width, line_bases):
                    raise ReferenceUnavailable("Reference FASTA line endings are inconsistent.")
            else:
                line_bases, line_width = len(bases), len(raw)
            previous_bases, previous_width = len(bases), len(raw)
            length += len(bases)
    finish()
    if not records:
        raise ReferenceUnavailable("Reference FASTA contains no contigs.")
    return records, digest.hexdigest()


def build_fasta_index(reference_path: str | Path, reference_metadata: dict,
                      index_path: str | Path | None = None) -> dict:
    """Create .fai and .fai.json; never replace existing files or alter FASTA.

    An explicit index_path supports staging an index beside a read-only deployed
    FASTA. Deploy both outputs beside the FASTA before enabling the feature.
    """
    path = Path(reference_path)
    _metadata(reference_metadata, path)
    index = Path(index_path) if index_path is not None else Path(str(path) + ".fai")
    manifest_path = Path(str(index) + ".json")
    if index.exists() or manifest_path.exists():
        raise FileExistsError("FASTA index destination exists; refusing to overwrite.")
    before = _identity(path)
    records, digest = _scan_fasta(path)
    if digest != reference_metadata["sha256"] or before != _identity(path):
        raise ReferenceUnavailable("Reference FASTA failed SHA-256 verification or changed while indexing.")
    bases = sum(record.length for record in records)
    for key, value in (("contigs", len(records)), ("total_bases", bases)):
        if key in reference_metadata and reference_metadata[key] != value:
            raise ReferenceUnavailable("Reference contig lengths do not match its provenance.")
    content = "".join(record.row() for record in records).encode("ascii")
    manifest = {
        "schema_version": INDEX_SCHEMA, "assembly": "GRCh38", "verified": True,
        "reference_sha256": digest, "reference_filename": path.name,
        "reference_size": before[2], "index_sha256": hashlib.sha256(content).hexdigest(),
        "contigs": len(records), "total_bases": bases,
        "coordinate_system": "0-based half-open, forward-reference coordinates",
    }
    index.parent.mkdir(parents=True, exist_ok=True)
    # Readers require both outputs and their hashes, so interruption fails closed.
    with index.open("xb") as output:
        output.write(content)
        output.flush()
        os.fsync(output.fileno())
    with manifest_path.open("x") as output:
        json.dump(manifest, output, indent=2, sort_keys=True)
        output.write("\n")
        output.flush()
        os.fsync(output.fileno())
    return manifest


class IndexedFasta:
    """Read-only, thread-safe bounded access to a provenance-checked FASTA."""

    def __init__(self, path: Path, records: tuple[FastaRecord, ...], sha256: str,
                 identities: tuple[tuple[int, ...], ...]):
        self.path = path
        self.sha256 = sha256
        self.assembly = "GRCh38"
        self._records = {record.name: record for record in records}
        self._identities = identities

    @property
    def contigs(self) -> dict[str, int]:
        return {name: record.length for name, record in self._records.items()}

    def resolve_contig(self, chromosome: str) -> str:
        """Only explicit stable chromosome aliases; no generic prefix stripping."""
        if not isinstance(chromosome, str) or not chromosome or chromosome != chromosome.strip():
            raise ValueError("Enter an exact reference contig name or a supported chromosome alias.")
        if chromosome in self._records:
            return chromosome
        aliases = [(str(n), f"chr{n}") for n in range(1, 23)] + [("X", "chrX"), ("Y", "chrY"), ("MT", "chrM")]
        for group in aliases:
            if chromosome in group:
                matches = [name for name in group if name in self._records]
                if len(matches) == 1:
                    return matches[0]
        raise ValueError("Chromosome is absent from the installed GRCh38 reference; use its exact contig name.")

    def fetch(self, chromosome: str, start0: int, end0: int, *, max_bases: int = MAX_REFERENCE_READ) -> str:
        name = self.resolve_contig(chromosome)
        record = self._records[name]
        if (type(start0) is not int or type(end0) is not int or not 0 <= start0 < end0 <= record.length
                or end0 - start0 > min(max_bases, MAX_REFERENCE_READ)):
            raise ValueError("Reference interval is out of bounds or exceeds the permitted length.")
        paths = (self.path, Path(str(self.path) + ".fai"), Path(str(self.path) + ".fai.json"))
        if tuple(_identity(path) for path in paths) != self._identities:
            raise ReferenceUnavailable("Reference or index changed; reload the verified reference.")
        first, last = record.position(start0), record.position(end0 - 1)
        try:
            with self.path.open("rb") as stream:
                if _stat_identity(os.fstat(stream.fileno())) != self._identities[0]:
                    raise ReferenceUnavailable("Reference changed while opening the interval.")
                stream.seek(first)
                raw = stream.read(last - first + 1)
                if _stat_identity(os.fstat(stream.fileno())) != self._identities[0]:
                    raise ReferenceUnavailable("Reference changed while reading the interval.")
        except OSError as exc:
            raise ReferenceUnavailable("Reference is unavailable while reading the interval.") from exc
        sequence = raw.replace(b"\n", b"").replace(b"\r", b"")
        if len(raw) != last - first + 1 or len(sequence) != end0 - start0 or sequence.translate(None, _DNA):
            raise ReferenceUnavailable("FASTA interval is truncated or inconsistent with its index.")
        return sequence.decode("ascii").upper()


def _stat_identity(info: os.stat_result) -> tuple[int, ...]:
    return (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns)


@lru_cache(maxsize=4)
def _load_cached(path_text: str, expected_sha256: str, identities: tuple[tuple[int, ...], ...]) -> IndexedFasta:
    path = Path(path_text)
    index, manifest_path = Path(str(path) + ".fai"), Path(str(path) + ".fai.json")
    if identities[1][2] > 16_000_000 or identities[2][2] > 64_000:
        raise ReferenceUnavailable("FASTA index metadata exceeds the safety bound.")
    manifest = json.loads(manifest_path.read_text())
    if (not isinstance(manifest, dict) or manifest.get("schema_version") != INDEX_SCHEMA
            or manifest.get("assembly") != "GRCh38" or manifest.get("verified") is not True
            or manifest.get("reference_sha256") != expected_sha256
            or manifest.get("reference_filename") != path.name or manifest.get("reference_size") != identities[0][2]):
        raise ReferenceUnavailable("FASTA index provenance is incompatible with the verified GRCh38 reference.")
    if file_sha256(index) != manifest.get("index_sha256") or file_sha256(path) != expected_sha256:
        raise ReferenceUnavailable("Reference FASTA or index failed SHA-256 verification.")
    records, seen, previous_last = [], set(), -1
    for line in index.read_text(encoding="ascii").splitlines():
        fields = line.split("\t")
        if len(fields) != 5 or not re.fullmatch(r"[!-~]+", fields[0]):
            raise ReferenceUnavailable("FASTA index contains an invalid record.")
        name = fields[0]
        length, offset, line_bases, line_width = (int(value) for value in fields[1:])
        if (name in seen or min(length, offset, line_bases, line_width) <= 0
                or line_bases > length or not 0 <= line_width - line_bases <= 2
                or (line_width == line_bases and length > line_bases) or offset <= previous_last):
            raise ReferenceUnavailable("FASTA index contains unsafe or duplicate coordinates.")
        record = FastaRecord(name, length, offset, line_bases, line_width)
        if record.position(length - 1) >= identities[0][2]:
            raise ReferenceUnavailable("FASTA index extends beyond the reference file.")
        previous_last = record.position(length - 1)
        seen.add(name)
        records.append(record)
    if not records or len(records) != manifest.get("contigs") or sum(r.length for r in records) != manifest.get("total_bases"):
        raise ReferenceUnavailable("FASTA index contig coverage does not match its provenance.")
    # Check the physical boundaries as well as hashes. This rejects unsafe index
    # geometry even if someone accidentally regenerated only its sidecar hash.
    with path.open("rb") as stream:
        next_header = 0
        for record in records:
            stream.seek(next_header)
            header = stream.readline(1_000_000)
            if (not header.startswith(b">") or header[1:].split()[0].decode("ascii") != record.name
                    or stream.tell() != record.offset):
                raise ReferenceUnavailable("FASTA index offsets do not match reference headers.")
            first_line = stream.readline(record.line_width + 1)
            if len(first_line) != record.line_width or len(first_line.rstrip(b"\r\n")) != record.line_bases:
                raise ReferenceUnavailable("FASTA index line geometry does not match the reference.")
            last_line_offset = record.offset + ((record.length - 1) // record.line_bases) * record.line_width
            stream.seek(last_line_offset)
            final_line = stream.readline(record.line_width + 1)
            if len(final_line.rstrip(b"\r\n")) != (record.length - 1) % record.line_bases + 1:
                raise ReferenceUnavailable("FASTA index contig length does not match the reference.")
            next_header = stream.tell()
        if next_header != identities[0][2]:
            raise ReferenceUnavailable("FASTA index does not cover the complete reference.")
    if tuple(_identity(p) for p in (path, index, manifest_path)) != identities:
        raise ReferenceUnavailable("Reference or index changed during verification.")
    return IndexedFasta(path, tuple(records), expected_sha256, identities)


def load_reference(reference_path: str | Path, reference_metadata: dict) -> IndexedFasta:
    """Validate once per process and file identity; share safely between threads."""
    path = Path(reference_path).absolute()
    try:
        _metadata(reference_metadata, path)
        paths = (path, Path(str(path) + ".fai"), Path(str(path) + ".fai.json"))
        identities = tuple(_identity(item) for item in paths)
        with _LOCK:
            reference = _load_cached(str(path), reference_metadata["sha256"], identities)
        for key, value in (("contigs", len(reference.contigs)), ("total_bases", sum(reference.contigs.values()))):
            if key in reference_metadata and reference_metadata[key] != value:
                raise ReferenceUnavailable("Reference contig lengths do not match its provenance.")
        return reference
    except ReferenceUnavailable:
        raise
    except (OSError, ValueError, TypeError, IndexError) as exc:
        raise ReferenceUnavailable("Compatible verified FASTA and index are unavailable.") from exc
