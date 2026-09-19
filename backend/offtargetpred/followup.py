"""Reference-verified, bounded sequence context for explicit candidate selections.

This prepares reference sequence for downstream experimental planning. It does
not design primers, validate amplicon specificity or predict assay performance.
"""
from __future__ import annotations

import hashlib
from pathlib import Path
import re
from urllib.parse import quote

from .reference import load_reference
from .sequence import ValidationError

MAX_CONTEXT_RECORDS = 20
MAX_FLANK_BASES = 1000
COORDINATE_SYSTEM = "0-based half-open"
_ALLOWED = {"id", "row_index", "off_target", "chromosome", "start", "end", "strand", "assembly", "coordinate_system"}
_TEXT_LIMITS = {"id": 200, "off_target": 100, "chromosome": 200, "strand": 10, "assembly": 30, "coordinate_system": 100}
_COMPLEMENT = str.maketrans("ACGT", "TGCA")


def _validated_records(records: list[dict], flank_bases: int) -> list[dict]:
    if type(flank_bases) is not int or not 0 <= flank_bases <= MAX_FLANK_BASES:
        raise ValidationError("Choose an integer flank length from 0 to 1,000 bases per side.")
    if not isinstance(records, list) or not 1 <= len(records) <= MAX_CONTEXT_RECORDS:
        raise ValidationError("Select between 1 and 20 candidate rows for reference context.")
    result = []
    for record in records:
        if not isinstance(record, dict) or set(record) - _ALLOWED:
            raise ValidationError("Reference-context records contain unsupported fields.")
        if not isinstance(record.get("id"), str) or not record["id"]:
            raise ValidationError("Each selected record requires a nonempty string identifier.")
        for key, limit in _TEXT_LIMITS.items():
            value = record.get(key)
            if value is not None and (not isinstance(value, str) or len(value) > limit
                                      or any(ord(char) < 32 or ord(char) == 127 for char in value)):
                raise ValidationError(f"Reference-context {key} has an invalid type, length or control character.")
        for key in ("row_index", "start", "end"):
            value = record.get(key)
            if value is not None and (type(value) is not int or abs(value) > 2**53 - 1):
                raise ValidationError(f"Reference-context {key} must be a bounded integer.")
        if record.get("row_index") is not None and record["row_index"] < 0:
            raise ValidationError("Reference-context row_index must be nonnegative.")
        result.append(dict(record))
    return result


def reference_context(reference_path: str | Path, reference_metadata: dict,
                      records: list[dict], flank_bases: int = 250) -> dict:
    """Preserve every input selection, verifying the complete 23-mer before export.

    Structurally invalid/oversized requests fail as a whole before reference I/O.
    Coordinate-ineligible, unknown-contig and sequence-mismatching rows retain a
    per-record skip reason. Reference corruption/unavailability fails the whole
    request rather than being reported as an ordinary skipped candidate.
    """
    records = _validated_records(records, flank_bases)
    reference = load_reference(reference_path, reference_metadata)
    output, fasta = [], []
    for index, candidate in enumerate(records):
        entry = {"selection_index": index, "candidate": candidate, "status": "skipped"}
        output.append(entry)

        def skip(code: str, message: str) -> None:
            entry.update({"reason_code": code, "reason": message})

        if candidate.get("assembly") != "GRCh38":
            skip("unsupported_assembly", "An explicitly declared GRCh38 assembly is required.")
            continue
        if candidate.get("coordinate_system") not in (COORDINATE_SYSTEM, "0-based half-open, forward-reference coordinates"):
            skip("unsupported_coordinates", "Explicit 0-based half-open forward-reference coordinates are required.")
            continue
        if any(candidate.get(key) is None for key in ("chromosome", "start", "end", "strand")):
            skip("missing_coordinates", "This selected row does not contain a complete genomic locus and strand.")
            continue
        start, end, strand = candidate["start"], candidate["end"], candidate["strand"]
        if start < 0 or end != start + 23 or strand not in ("+", "-"):
            skip("invalid_locus", "The full candidate locus must span exactly 23 bases with a declared + or - strand.")
            continue
        sequence = candidate.get("off_target")
        if not isinstance(sequence, str) or not re.fullmatch(r"[ACGTacgt]{23}", sequence):
            skip("invalid_candidate_sequence", "The selected candidate must contain exactly 23 unambiguous DNA bases, including PAM.")
            continue
        try:
            chromosome = reference.resolve_contig(candidate["chromosome"])
        except ValueError as exc:
            skip("unknown_contig", str(exc))
            continue
        contig_length = reference.contigs[chromosome]
        if end > contig_length:
            skip("out_of_bounds", "The candidate locus extends beyond the installed reference contig.")
            continue
        reference_candidate = reference.fetch(chromosome, start, end, max_bases=23)
        guide_oriented = reference_candidate if strand == "+" else reference_candidate.translate(_COMPLEMENT)[::-1]
        if guide_oriented != sequence.upper():
            skip("reference_sequence_mismatch", "The candidate sequence does not exactly match this reference locus in its declared strand orientation.")
            continue
        context_start, context_end = max(0, start - flank_bases), min(contig_length, end + flank_bases)
        context_sequence = reference.fetch(chromosome, context_start, context_end, max_bases=2 * MAX_FLANK_BASES + 23)
        candidate.update({"chromosome": chromosome, "requested_chromosome": records[index]["chromosome"],
                          "off_target": sequence.upper(), "coordinate_system": COORDINATE_SYSTEM})
        context = {
            "start": context_start, "end": context_end, "sequence": context_sequence,
            "sequence_sha256": hashlib.sha256(context_sequence.encode("ascii")).hexdigest(),
            "sequence_orientation": "forward reference", "coordinate_system": COORDINATE_SYSTEM,
            "target_start_offset": start - context_start, "target_end_offset": end - context_start,
            "left_bases": start - context_start, "right_bases": context_end - end,
            "left_clipped": start - context_start < flank_bases,
            "right_clipped": context_end - end < flank_bases,
            "ambiguous_bases": sum(base not in "ACGT" for base in context_sequence),
        }
        fasta_id = f"candidate_{index + 1}"
        header = (f">{fasta_id} assembly=GRCh38 contig={quote(chromosome, safe='._-')} "
                  f"context_start0={context_start} context_end0={context_end} "
                  f"candidate_start0={start} candidate_end0={end} candidate_strand={strand} "
                  "orientation=forward_reference coordinates=0_based_half_open")
        fasta.append(header + "\n" + "\n".join(context_sequence[i:i + 60] for i in range(0, len(context_sequence), 60)) + "\n")
        entry.update({"status": "ready", "fasta_id": fasta_id, "context": context})
    fasta_text = "".join(fasta)
    return {
        "schema_version": "1.0", "complete": True, "flank_bases": flank_bases,
        "summary": {"selected": len(records), "ready": len(fasta), "skipped": len(records) - len(fasta)},
        "records": output, "fasta": fasta_text,
        "fasta_sha256": hashlib.sha256(fasta_text.encode("ascii")).hexdigest(),
        "reference": {"assembly": "GRCh38", "sha256": reference.sha256,
                      "filename": reference.path.name,
                      "scope": reference_metadata.get("scope", "Installed GRCh38 reference contigs")},
        "coordinate_system": COORDINATE_SYSTEM, "sequence_orientation": "forward reference",
        "limitations": ["Reference flanks are preparation material, not validated primers or amplicons.",
                        "Genetic variants, assay feasibility and genome-wide primer specificity are not assessed.",
                        "Flanks are in forward-reference orientation on both candidate strands; offsets are 0-based half-open."],
    }
