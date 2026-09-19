"""Bounded local GRCh38 guide discovery; no ranking or on-target prediction."""
from __future__ import annotations

from pathlib import Path
import re
import sqlite3
import time

from .annotations import AnnotationIndex, AnnotationUnavailable
from .reference import load_reference
from .resolver import COORDINATE_SYSTEM
from .sequence import ValidationError

MAX_DISCOVERY_INTERVAL = 20_000
MAX_DISCOVERY_GUIDES = 200
MAX_GENE_MATCHES = 25
GENE_QUERY_TIMEOUT = 8.0
_COMPLEMENT = str.maketrans("ACGT", "TGCA")


def discover_guides(reference_path: str | Path, reference_metadata: dict,
                    chromosome: str, start0: int, end0: int) -> dict:
    """Enumerate every full 23-nt NGG site wholly within an interval.

    Both strands are tested independently and loci are never deduplicated by
    sequence. Ambiguous DNA windows are skipped. More than 200 eligible sites
    rejects the whole request, preventing a coordinate-ordered partial shortlist.
    """
    if (type(start0) is not int or type(end0) is not int or start0 < 0
            or not 23 <= end0 - start0 <= MAX_DISCOVERY_INTERVAL):
        raise ValidationError("Choose a 0-based half-open interval containing 23 to 20,000 bases.")
    reference = load_reference(reference_path, reference_metadata)
    try:
        contig = reference.resolve_contig(chromosome)
        sequence = reference.fetch(contig, start0, end0, max_bases=MAX_DISCOVERY_INTERVAL)
    except ValueError as exc:
        # ReferenceUnavailable is deliberately allowed to propagate as a service
        # error; invalid coordinates are user input errors.
        from .reference import ReferenceUnavailable
        if isinstance(exc, ReferenceUnavailable):
            raise
        raise ValidationError(str(exc)) from exc
    guides, ambiguous_windows = [], 0
    for offset in range(len(sequence) - 22):
        window = sequence[offset:offset + 23]
        if not re.fullmatch(r"[ACGT]{23}", window):
            ambiguous_windows += 1
            continue
        for strand, target in (("+", window), ("-", window.translate(_COMPLEMENT)[::-1])):
            if target[-2:] != "GG":
                continue
            position = start0 + offset
            guides.append({
                "chromosome": contig, "start": position, "end": position + 23,
                "spacer_start": position if strand == "+" else position + 3,
                "spacer_end": position + 20 if strand == "+" else position + 23,
                "strand": strand, "target23": target, "pam": target[-3:],
                "assembly": "GRCh38", "coordinate_system": COORDINATE_SYSTEM,
                "reference_sha256": reference.sha256,
            })
            if len(guides) > MAX_DISCOVERY_GUIDES:
                raise ValidationError("This interval contains more than 200 eligible NGG sites. Narrow the interval and retry; no partial candidate list is returned.")
    return {
        "guides": guides, "assembly": "GRCh38", "reference_sha256": reference.sha256,
        "scope": {"chromosome": contig, "start": start0, "end": end0,
                  "coordinate_system": COORDINATE_SYSTEM, "both_strands": True,
                  "full_site_inside_interval": True, "complete": True,
                  "ambiguous_windows_skipped": ambiguous_windows},
        "selection_required": True,
        "limitations": [
            "Guides are listed by reference position and strand, without an efficiency or specificity ranking.",
            "Only full 23-nt sites wholly inside the selected interval are included; ambiguous reference windows are skipped.",
            "Select a guide and then run a separate genome search to assess its off-target candidates.",
            "Individual variants, on-target efficiency, transcript preference and experimental suitability are not assessed.",
        ],
    }


def lookup_genes(annotation_path: str | Path, reference_metadata: dict, query: str) -> dict:
    """Resolve an exact annotation identifier/name without choosing an isoform.

    The existing, checksum-verified annotation is read-only. Its schema lacks a
    gene-name index, so SQL execution has an eight-second wall-clock bound. No
    partial result is returned on timeout. Service admission must also bound
    concurrent calls (the API's existing ToolAdmission helper is appropriate).
    """
    if (not isinstance(query, str) or not query.strip() or len(query.strip()) > 100
            or any(ord(char) < 32 for char in query)):
        raise ValidationError("Enter an exact gene name or unversioned Ensembl gene/transcript identifier, up to 100 characters.")
    query = query.strip()
    if re.fullmatch(r"ENS[GT]\d+\.\d+", query):
        raise ValidationError("Enter the unversioned Ensembl identifier; this annotation stores stable identifiers without version suffixes.")
    with AnnotationIndex(annotation_path, reference_metadata) as index:
        deadline = time.monotonic() + GENE_QUERY_TIMEOUT
        connection = index.connection
        assert connection is not None
        connection.set_progress_handler(lambda: int(time.monotonic() > deadline), 10_000)
        try:
            rows = connection.execute("""SELECT c.name, f.start, f.end, f.strand,
                f.feature, f.gene_id, f.gene_name, f.transcript_id
                FROM features f JOIN contigs c ON c.id=f.contig_id
                WHERE (f.feature='gene' AND (f.gene_id=? OR f.gene_name=?))
                   OR (f.feature='transcript' AND f.transcript_id=?)
                ORDER BY c.name, f.start, f.end, f.strand, f.gene_id, f.transcript_id
                LIMIT ?""", (query, query, query, MAX_GENE_MATCHES + 1)).fetchall()
        except sqlite3.OperationalError as exc:
            raise AnnotationUnavailable("Gene lookup exceeded its local query limit or the annotation is unavailable. Use a reference interval instead.") from exc
        finally:
            connection.set_progress_handler(None, 0)
        if len(rows) > MAX_GENE_MATCHES:
            raise ValidationError("This name matches more than 25 annotation loci. Use an exact Ensembl identifier or a reference interval.")
        keys = ("chromosome", "start", "end", "strand", "feature", "gene_id", "gene_name", "transcript_id")
        matches = [{**{key: value for key, value in zip(keys, row) if value is not None},
                    "assembly": "GRCh38", "coordinate_system": COORDINATE_SYSTEM,
                    "reference_sha256": reference_metadata["sha256"],
                    "requires_narrowing": row[2] - row[1] > MAX_DISCOVERY_INTERVAL}
                   for row in rows]
        return {"query": query, "matches": matches,
                "status": "not_found" if not matches else "unique" if len(matches) == 1 else "ambiguous",
                "selection_required": True, "complete": True,
                "annotation": {key: index.provenance[key] for key in
                               ("source", "release", "assembly", "index_sha256", "source_archive_sha256")},
                "limitations": ["Exact case-sensitive names and unversioned Ensembl identifiers only; aliases and transcript names are not resolved.",
                                "Gene and transcript intervals include introns; no canonical transcript, exon subset or target region is chosen.",
                                "Select and, where necessary, narrow a locus before discovering guides."]}
