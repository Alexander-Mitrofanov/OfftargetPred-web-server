"""Strict sequence and tabular input contracts, independent of ML dependencies."""

from __future__ import annotations

import csv
import io
import re
from collections import Counter


class ValidationError(ValueError):
    """An input error safe to show to the submitting researcher."""


GUIDE_COLUMNS = ("target", "sgRNA", "Guide_sequence", "AlignedTarget", "guide_sequence")
SITE_COLUMNS = ("off_target", "offtarget", "Target_sequence", "AlignedText", "candidate_sequence")
ID_COLUMNS = ("id", "ID", "sgRNA_id", "guide_id")


def normalize_sequence(value: str, field: str = "sequence", row: int | None = None) -> str:
    label = f"Row {row}: {field}" if row is not None else field
    if not isinstance(value, str):
        raise ValidationError(f"{label} must be a DNA sequence.")
    sequence = value.strip().upper()
    if len(sequence) != 23:
        raise ValidationError(f"{label} must contain exactly 23 bases (20 nt + 3 nt PAM); got {len(sequence)}.")
    if not re.fullmatch("[ACGTN]{23}", sequence):
        raise ValidationError(f"{label} allows only A, C, G, T and N; gaps and RNA U are unsupported.")
    return sequence


def _table(text: str, format: str) -> list[dict]:
    if format not in {"csv", "tsv", "text"}:
        raise ValidationError("Choose CSV, TSV or plain text input.")
    text = text.lstrip("\ufeff").strip()
    if not text:
        raise ValidationError("Input is empty. Add at least one sequence pair.")
    separator = "," if format == "csv" else "\t"
    if format == "text":
        separator = "\t" if "\t" in text.splitlines()[0] else ","
    try:
        reader = csv.DictReader(io.StringIO(text), delimiter=separator, strict=True)
        headers = reader.fieldnames or []
        if len(headers) != len(set(headers)):
            raise ValidationError("The input has duplicate column headers.")
        rows = list(reader)
    except csv.Error as exc:
        raise ValidationError("Malformed table. Check delimiters and quoted values.") from exc
    if not rows:
        raise ValidationError("The table contains no data rows.")
    for number, row in enumerate(rows, 2):
        if None in row or any(value is None for value in row.values()):
            raise ValidationError(f"Row {number}: column count differs from the header.")
    return rows


def _column(row: dict, choices: tuple[str, ...], kind: str) -> str:
    matches = [name for name in choices if name in row]
    if not matches:
        raise ValidationError(f"Missing {kind} column. Use '{choices[0]}'.")
    if len(matches) > 1:
        raise ValidationError(f"Ambiguous {kind} columns: {', '.join(matches)}. Keep one.")
    return matches[0]


def sequence_annotations(target: str, off_target: str) -> dict:
    """PAM and protospacer mismatches are separate; N is never a known match."""
    unknown = [i + 1 for i, (a, b) in enumerate(zip(target, off_target)) if "N" in (a, b)]
    mismatches = [i + 1 for i, (a, b) in enumerate(zip(target, off_target)) if a != b and "N" not in (a, b)]
    warnings = []
    if unknown:
        warnings.append("Contains N: affected tokens are unknown and the score is less interpretable.")
    if target[-2:] != "GG":
        warnings.append("Guide-associated PAM is not NGG; this is outside the guide PAMs in the supplied training set.")
    return {
        "mismatch_positions": mismatches,
        "mismatches": sum(p <= 20 for p in mismatches),
        "pam_mismatches": sum(p > 20 for p in mismatches),
        "unknown_positions": unknown,
        "exact_match": not unknown and target == off_target,
        "protospacer_match": not any(p <= 20 for p in unknown + mismatches),
        "warnings": warnings,
    }


def normalize_pairs(rows: list[dict], max_rows: int | None = None) -> list[dict]:
    if not rows:
        raise ValidationError("Add at least one sequence pair.")
    if max_rows is not None and len(rows) > max_rows:
        raise ValidationError(f"At most {max_rows:,} pairs are allowed per job.")
    normalized = []
    for number, row in enumerate(rows, 1):
        if not isinstance(row, dict):
            raise ValidationError(f"Row {number}: each pair must be an object.")
        guide = _column(row, GUIDE_COLUMNS, "guide")
        site = _column(row, SITE_COLUMNS, "candidate")
        target = normalize_sequence(row[guide], "guide", number)
        off_target = normalize_sequence(row[site], "candidate", number)
        identifier = str(next((row[c] for c in ID_COLUMNS if row.get(c)), f"pair-{number}"))
        if len(identifier) > 200 or any(ord(c) < 32 for c in identifier):
            raise ValidationError(f"Row {number}: identifier must be at most 200 printable characters.")
        # Preserve submitted metadata; stable row_index disambiguates repeated ids.
        result = {k: v for k, v in row.items() if k not in GUIDE_COLUMNS + SITE_COLUMNS}
        result.update(id=identifier, row_index=number, target=target, off_target=off_target)
        result.update(sequence_annotations(target, off_target))
        normalized.append(result)
    return normalized


def parse_pairs(text: str, format: str = "csv") -> list[dict]:
    return normalize_pairs(_table(text, format))


def parse_guides(text: str, format: str = "text") -> list[dict]:
    """Accept full 23 nt guide-associated target sequences only, with a real NGG PAM."""
    if format in {"csv", "tsv"}:
        rows = _table(text, format)
        guides = [{"id": str(next((r[c] for c in ID_COLUMNS if r.get(c)), f"guide-{i}")),
                   "target": r[_column(r, GUIDE_COLUMNS, "guide")]} for i, r in enumerate(rows, 1)]
    elif format in {"fasta", "text"}:
        lines = [line.strip() for line in text.lstrip("\ufeff").splitlines() if line.strip()]
        if not lines:
            raise ValidationError("Add at least one guide-associated 23 nt sequence.")
        if format == "fasta" or lines[0].startswith(">"):
            guides = []
            for line in lines:
                if line.startswith(">"):
                    guides.append({"id": line[1:].strip(), "target": ""})
                elif guides:
                    guides[-1]["target"] += line
                else:
                    raise ValidationError("FASTA must begin with an >identifier header.")
        else:
            guides = [{"id": f"guide-{i}", "target": line} for i, line in enumerate(lines, 1)]
    else:
        raise ValidationError("Choose FASTA, plain text, CSV or TSV input.")
    return normalize_guides(guides)


def normalize_guides(guides: list[dict]) -> list[dict]:
    if not 1 <= len(guides) <= 10:
        raise ValidationError("Genome search accepts between 1 and 10 guides per job.")
    result = []
    for i, guide in enumerate(guides, 1):
        sequence = normalize_sequence(guide.get("target"), "guide", i)
        if "N" in sequence or sequence[-2:] != "GG":
            raise ValidationError(f"Guide {i}: genome search requires 23 unambiguous A/C/G/T bases ending in an NGG PAM.")
        identifier = str(guide.get("id") or f"guide-{i}")
        if len(identifier) > 200 or any(ord(c) < 32 for c in identifier):
            raise ValidationError(f"Guide {i}: identifier must be at most 200 printable characters.")
        result.append({"id": identifier, "target": sequence})
    if any(count > 1 for count in Counter(g["id"] for g in result).values()):
        raise ValidationError("Guide identifiers must be unique within a genome search.")
    return result
