"""Local Ensembl annotation of complete 23-nt candidate intervals, including PAM.

Coordinates are always forward-reference, 0-based and half-open. Overlap is
strand-independent; feature strand is retained. Annotation never affects scores.
"""
from __future__ import annotations

from collections import Counter, OrderedDict
from copy import deepcopy
import gzip
import hashlib
import json
from pathlib import Path
import re
import sqlite3
from typing import Iterable

SOURCE_URL = "https://ftp.ensembl.org/pub/release-115/gtf/homo_sapiens/Homo_sapiens.GRCh38.115.gtf.gz"
SOURCE_SHA256 = "2f8e31578c3aa2f35646927c4a3b3b0dcf0321e57c0ebd3ecc81afcbc836d1a8"
RELEASE = "115"
SCHEMA_VERSION = 1
MAX_ROWS = 50_000
CATEGORIES = ("CDS", "exon", "UTR", "intron")
_SOURCE_FEATURES = {"gene", "transcript", "exon", "CDS", "five_prime_utr", "three_prime_utr", "UTR"}
_ATTRIBUTES = re.compile(r'(\w+)\s+"([^"\n]*)"\s*(?:;|$)')


class AnnotationUnavailable(ValueError):
    """The local annotation cannot establish compatible feature coverage."""


def file_sha256(path: str | Path) -> str:
    with Path(path).open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def read_reference_contigs(fasta: str | Path, expected_sha256: str) -> dict[str, int]:
    """One streaming pass verifies the exact FASTA and records all contig lengths."""
    digest, contigs, name = hashlib.sha256(), {}, None
    with Path(fasta).open("rb") as stream:
        for line in stream:
            digest.update(line)
            if line.startswith(b">"):
                name = line[1:].split()[0].decode("ascii")
                if name in contigs:
                    raise ValueError("Duplicate reference contig")
                contigs[name] = 0
            elif name is not None:
                contigs[name] += len(line.strip())
            else:
                raise ValueError("Invalid FASTA")
    if digest.hexdigest() != expected_sha256:
        raise ValueError("Reference FASTA failed SHA-256 verification")
    return contigs


def build_annotation_index(archive: str | Path, destination: str | Path, *, reference: dict,
                           contig_lengths: dict[str, int], expected_sha256: str = SOURCE_SHA256) -> dict:
    """Build a read-only SQLite R-tree and manifest. Caller verifies FASTA lengths.

    The default archive digest is pinned to the complete Ensembl 115 GTF.
    Tests may explicitly supply the digest of a small synthetic GTF fixture.
    """
    archive, destination = Path(archive), Path(destination)
    manifest_path = destination.with_suffix(".json")
    temporary = destination.with_name(destination.name + ".partial")
    if any(path.exists() for path in (destination, manifest_path, temporary)):
        raise FileExistsError("Annotation destination already exists; refusing to overwrite")
    if reference.get("assembly") != "GRCh38" or reference.get("verified") is not True:
        raise ValueError("A verified GRCh38 reference is required")
    if not re.fullmatch(r"[0-9a-f]{64}", reference.get("sha256", "")):
        raise ValueError("Reference SHA-256 is required")
    if not contig_lengths or any(not isinstance(n, int) or not 0 < n < 2**31 for n in contig_lengths.values()):
        raise ValueError("Valid reference contig lengths are required")
    if reference.get("contigs", len(contig_lengths)) != len(contig_lengths):
        raise ValueError("Reference contig count does not match")
    archive_sha = file_sha256(archive)
    if archive_sha != expected_sha256:
        raise ValueError("Annotation archive SHA-256 mismatch")
    destination.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(temporary)
    try:
        connection.executescript("""
            PRAGMA journal_mode=OFF;
            PRAGMA synchronous=OFF;
            PRAGMA temp_store=FILE;
            CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
            CREATE TABLE contigs (id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL, length INTEGER NOT NULL);
            CREATE TABLE features (id INTEGER PRIMARY KEY, contig_id INTEGER NOT NULL,
                start INTEGER NOT NULL, end INTEGER NOT NULL, strand TEXT NOT NULL,
                feature TEXT NOT NULL, gene_id TEXT NOT NULL, gene_name TEXT NOT NULL,
                transcript_id TEXT);
            CREATE VIRTUAL TABLE intervals USING rtree_i32(id, start, end, contig_min, contig_max);
        """)
        contigs = {name: i for i, name in enumerate(sorted(contig_lengths), 1)}
        connection.executemany("INSERT INTO contigs VALUES (?, ?, ?)",
                               ((i, name, contig_lengths[name]) for name, i in contigs.items()))
        source_digest, headers, counts = hashlib.sha256(), [], Counter()
        pending, feature_id, ignored = [], 0, 0

        def flush():
            connection.executemany("INSERT INTO features VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", pending)
            # R-tree end is inclusive; user-facing feature end remains half-open.
            connection.executemany("INSERT INTO intervals VALUES (?, ?, ?, ?, ?)",
                                   ((r[0], r[2], r[3] - 1, r[1], r[1]) for r in pending))
            pending.clear()

        with gzip.open(archive, "rb") as source:
            for line_number, raw_line in enumerate(source, 1):
                source_digest.update(raw_line)
                line = raw_line.decode("utf-8").rstrip("\r\n")
                if line.startswith("#"):
                    if line.startswith("#!"):
                        headers.append(line)
                    continue
                columns = line.split("\t")
                if len(columns) != 9:
                    raise ValueError(f"Malformed GTF at line {line_number}")
                chromosome, _, feature, start, end, _, strand, _, attributes = columns
                if feature not in _SOURCE_FEATURES:
                    continue
                if chromosome not in contigs:
                    ignored += 1
                    continue
                start, end = int(start) - 1, int(end)
                if not 0 <= start < end <= contig_lengths[chromosome] or strand not in {"+", "-"}:
                    raise ValueError(f"Invalid GTF interval at line {line_number}")
                attr = dict(_ATTRIBUTES.findall(attributes))
                if not attr.get("gene_id") or (feature != "gene" and not attr.get("transcript_id")):
                    raise ValueError(f"Missing GTF identifiers at line {line_number}")
                feature_id += 1
                normalized = "UTR" if feature in {"five_prime_utr", "three_prime_utr"} else feature
                pending.append((feature_id, contigs[chromosome], start, end, strand, normalized,
                                attr["gene_id"], attr.get("gene_name", attr["gene_id"]), attr.get("transcript_id")))
                counts[normalized] += 1
                if len(pending) >= 10_000:
                    flush()
        flush()
        if not counts["gene"] or not counts["transcript"] or not counts["exon"]:
            raise ValueError("Annotation contains no complete gene/transcript/exon features")
        # Introns are gaps between merged exons of the SAME transcript, on either
        # strand. A site's categories can differ across overlapping isoforms.
        cursor = connection.execute("""SELECT contig_id, start, end, strand, gene_id, gene_name, transcript_id
            FROM features WHERE feature='exon' ORDER BY transcript_id, contig_id, start, end""")
        previous_key, previous_end = None, None
        for contig_id, start, end, strand, gene_id, gene_name, transcript_id in cursor:
            key = (transcript_id, contig_id, strand, gene_id)
            if key == previous_key and start > previous_end:
                feature_id += 1
                pending.append((feature_id, contig_id, previous_end, start, strand, "intron", gene_id, gene_name, transcript_id))
                counts["intron"] += 1
                if len(pending) >= 10_000:
                    flush()
            previous_end = max(previous_end, end) if key == previous_key else end
            previous_key = key
        flush()
        provenance = {
            "schema_version": SCHEMA_VERSION, "source": "Ensembl", "release": RELEASE,
            "assembly": "GRCh38", "source_url": SOURCE_URL,
            "source_filename": archive.name, "source_archive_sha256": archive_sha,
            "source_gtf_sha256": source_digest.hexdigest(), "gtf_headers": headers,
            "reference": reference, "contig_count": len(contigs),
            "contig_lengths_sha256": hashlib.sha256(json.dumps(contig_lengths, sort_keys=True).encode()).hexdigest(),
            "feature_counts": dict(counts), "ignored_nonreference_features": ignored,
            "complete": True, "coordinate_system": "0-based half-open, forward-reference coordinates",
            "interval": "23 nt including the 20-nt protospacer and 3-nt PAM; any-base overlap; both feature strands",
            "intron_definition": "Gaps between merged exons within each transcript",
            "limitations": ["Feature overlap is genomic context, not evidence of functional harm.",
                            "Transcript categories can overlap; no canonical transcript is selected.",
                            "Intergenic means no annotated gene or transcript feature in this release."],
        }
        connection.execute("INSERT INTO metadata VALUES ('provenance', ?)", (json.dumps(provenance, sort_keys=True),))
        connection.commit()
        if connection.execute("PRAGMA quick_check").fetchone()[0] != "ok":
            raise ValueError("Annotation SQLite integrity check failed")
        connection.close()
        provenance["index_sha256"] = file_sha256(temporary)
        temporary.replace(destination)
        manifest_path.write_text(json.dumps(provenance, indent=2, sort_keys=True) + "\n")
        return provenance
    except BaseException:
        connection.close()
        temporary.unlink(missing_ok=True)
        raise


def _coordinates(row: dict):
    chromosome = row.get("chromosome")
    start, end = row.get("start", row.get("position")), row.get("end")
    if not chromosome or start is None:
        return None
    if isinstance(start, bool) or not isinstance(start, int):
        return False
    if end is None:
        end = start + 23
    if isinstance(end, bool) or not isinstance(end, int) or start < 0 or end - start != 23:
        return False
    return str(chromosome), start, end


def _unavailable(row: dict, reason: str) -> dict:
    no_coordinates = _coordinates(row) is None
    return {"status": "no_coordinates" if no_coordinates else "unavailable", "features": [], "categories": [],
            "reason": "No genomic coordinates were supplied." if no_coordinates else reason}


class AnnotationIndex:
    def __init__(self, path: str | Path, reference_metadata: dict | None = None):
        self.path = Path(path)
        self.connection = None
        try:
            manifest = json.loads(self.path.with_suffix(".json").read_text())
            if not self.path.is_file() or file_sha256(self.path) != manifest.get("index_sha256"):
                raise AnnotationUnavailable("Annotation index failed SHA-256 verification")
            self.connection = sqlite3.connect(self.path.resolve().as_uri() + "?mode=ro", uri=True)
            provenance = json.loads(self.connection.execute("SELECT value FROM metadata WHERE key='provenance'").fetchone()[0])
            if any(manifest.get(k) != value for k, value in provenance.items()):
                raise AnnotationUnavailable("Annotation manifest does not match the index")
            self.provenance = {**provenance, "index_sha256": manifest["index_sha256"]}
            if provenance.get("schema_version") != SCHEMA_VERSION or provenance.get("assembly") != "GRCh38" or not provenance.get("complete"):
                raise AnnotationUnavailable("Unsupported or incomplete annotation index")
            if reference_metadata is not None and (
                reference_metadata.get("assembly") != provenance["reference"]["assembly"]
                or reference_metadata.get("sha256") != provenance["reference"]["sha256"]
                or reference_metadata.get("verified") is not True
            ):
                raise AnnotationUnavailable("Annotation and search reference are incompatible")
            self.contigs = {name: (identifier, length) for identifier, name, length in self.connection.execute("SELECT * FROM contigs")}
            self._cache = OrderedDict()
        except (OSError, ValueError, TypeError, KeyError, sqlite3.Error) as exc:
            self.close()
            if isinstance(exc, AnnotationUnavailable):
                raise
            raise AnnotationUnavailable("Local annotation index is unavailable or invalid") from exc

    def close(self):
        if self.connection is not None:
            self.connection.close()
            self.connection = None

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()

    def metadata(self) -> dict:
        return deepcopy(self.provenance)

    def annotate_row(self, row: dict) -> dict:
        coordinates = _coordinates(row)
        if coordinates is None:
            return _unavailable(row, "No genomic coordinates were supplied.")
        if coordinates is False:
            return _unavailable(row, "Expected a valid 23-nt interval including PAM.")
        if row.get("assembly") != "GRCh38":
            return _unavailable(row, "Coordinates require an explicit compatible GRCh38 reference assembly.")
        if row.get("coordinate_system") not in {"0-based half-open", self.provenance["coordinate_system"]}:
            return _unavailable(row, "Coordinates require an explicit supported coordinate system.")
        chromosome, start, end = coordinates
        if chromosome not in self.contigs:
            return _unavailable(row, "Contig is absent from the matched reference; annotation coverage is unknown.")
        contig_id, length = self.contigs[chromosome]
        if end > length:
            return _unavailable(row, "Coordinates exceed the matched reference contig.")
        if self.connection is None:
            return _unavailable(row, "Local annotation index is closed.")
        if coordinates in self._cache:
            self._cache.move_to_end(coordinates)
            return deepcopy(self._cache[coordinates])
        overlaps = self.connection.execute("""SELECT f.gene_id, f.gene_name, f.transcript_id,
            f.feature, f.start, f.end, f.strand FROM intervals r JOIN features f ON f.id=r.id
            WHERE r.contig_min<=? AND r.contig_max>=? AND r.start<? AND r.end>=?
            ORDER BY f.gene_id, f.transcript_id, f.feature, f.start, f.end, f.strand""",
            (contig_id, contig_id, end, start))
        keys = ("gene_id", "gene_name", "transcript_id", "feature", "start", "end", "strand")
        features = [{key: value for key, value in zip(keys, feature) if value is not None} for feature in overlaps]
        categories = [kind for kind in CATEGORIES if any(f["feature"] == kind for f in features)]
        if not features:
            categories = ["intergenic"]
        transcripts = {f["transcript_id"] for f in features if f.get("transcript_id")}
        result = {"status": "annotated", "features": features, "categories": categories,
                  "source": "Ensembl", "release": RELEASE, "assembly": "GRCh38",
                  "interval": {"start": start, "end": end, "length": 23, "includes_pam": True},
                  "transcript_count": len(transcripts), "ambiguous_transcripts": len(transcripts) > 1}
        self._cache[coordinates] = result
        if len(self._cache) > 4096:
            self._cache.popitem(last=False)
        return deepcopy(result)

    def annotate_rows(self, rows: Iterable[dict]) -> list[dict]:
        return annotate_rows(rows, self)


def annotate_rows(rows: Iterable[dict], index: AnnotationIndex | None = None,
                  reason: str = "Compatible local annotations are not installed.") -> list[dict]:
    """Preserve row order, identity and scores, adding annotation only; cap 50k."""
    output = []
    for row in rows:
        if len(output) >= MAX_ROWS:
            raise ValueError("Annotation is bounded to 50,000 result rows")
        annotation = index.annotate_row(row) if index is not None else _unavailable(row, reason)
        output.append({**row, "annotations": annotation})
    return output
