"""Validate user-declared loci without promoting metadata into scientific output."""

from __future__ import annotations

import re

from .sequence import ValidationError


COORDINATE_FIELDS = ("assembly", "chromosome", "start", "end", "strand", "coordinate_system")
COORDINATE_SYSTEMS = {"0-based half-open", "0-based half-open, forward-reference coordinates"}
USER_COORDINATES = "user-supplied, not reference-verified"
CANONICAL_ALIASES = {f"chr{name}": str(name) for name in (*range(1, 23), "X", "Y")}
CANONICAL_ALIASES["chrM"] = "MT"
# parse_pairs has already regenerated row_index and sequence-derived annotations.
# Everything below belongs to the server or to a separate, explicit evidence workflow.
RESERVED_FIELDS = frozenset({
    "scores", "score", "baselines", "cfd", "cfd_score", "annotations", "evidence",
    "user_selected_locus", "intended_locus", "on_target", "is_on_target",
    "coordinate_verification", "reference_verified", "reference_sha256",
    "reference", "models", "model", "metadata", "release", "provenance",
    "gene_names", "gene_ids", "annotation_categories", "annotation_source",
    "annotation_release", "cfd_unavailable_reason", "calibrated_probability",
})


def _integer(value: object, field: str, number: int) -> int:
    if isinstance(value, bool) or not (
        isinstance(value, int) or isinstance(value, str) and re.fullmatch(r"[0-9]+", value.strip())
    ):
        raise ValidationError(f"Row {number}: {field} must be a non-negative integer in 0-based coordinates.")
    result = int(value)
    if not 0 <= result <= 2_147_483_647:
        raise ValidationError(f"Row {number}: {field} is outside the supported GRCh38 coordinate range.")
    return result


def normalize_input_metadata(rows: list[dict]) -> list[dict]:
    """Call after parse_pairs/normalize_pairs, never on server genome-search rows.

    Only declared, complete GRCh38 loci are accepted. Their interval covers all
    23 bases including the PAM in forward-reference coordinates on either strand.
    This routine checks syntax, not FASTA agreement or biological identity.
    """
    normalized = []
    for number, row in enumerate(rows, 1):
        result = {key: value for key, value in row.items() if key.casefold() not in RESERVED_FIELDS}
        provided = {key for key in COORDINATE_FIELDS if result.get(key) not in (None, "")}
        if provided or result.get("position") not in (None, ""):
            missing = [key for key in COORDINATE_FIELDS if key not in provided]
            if missing:
                raise ValidationError(
                    f"Row {number}: incomplete locus metadata; provide {', '.join(missing)} "
                    "or remove all coordinate fields to score sequences only. Use start/end, not position."
                )
            if result["assembly"] != "GRCh38":
                raise ValidationError(f"Row {number}: coordinate metadata currently supports assembly GRCh38 only.")
            if not isinstance(result["coordinate_system"], str) or result["coordinate_system"] not in COORDINATE_SYSTEMS:
                raise ValidationError(f"Row {number}: declare coordinate_system as '0-based half-open'; convert 1-based coordinates first.")
            chromosome = result["chromosome"]
            if not isinstance(chromosome, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,99}", chromosome):
                raise ValidationError(f"Row {number}: chromosome must be a plain contig name without spaces, slashes or a coordinate range.")
            if result["strand"] not in ("+", "-"):
                raise ValidationError(f"Row {number}: strand must be '+' or '-'; it cannot be inferred from sequence.")
            start, end = (_integer(result[key], key, number) for key in ("start", "end"))
            if end - start != 23:
                raise ValidationError(f"Row {number}: the interval must cover exactly 23 bases, including the PAM, with end-start=23.")
            if result.get("position") not in (None, "") and _integer(result["position"], "position", number) != start:
                raise ValidationError(f"Row {number}: position conflicts with start; remove position and use the declared start/end interval.")
            result.pop("position", None)
            if chromosome in CANONICAL_ALIASES:
                result["source_chromosome"] = chromosome
                result["chromosome"] = CANONICAL_ALIASES[chromosome]
            result.update(start=start, end=end, coordinate_system="0-based half-open", coordinate_verification=USER_COORDINATES)
        else:
            # Empty optional CSV columns are absence, never an implied locus.
            for key in (*COORDINATE_FIELDS, "position"):
                result.pop(key, None)
        normalized.append(result)
    return normalized
