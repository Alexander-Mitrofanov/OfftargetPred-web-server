"""Resolve a DNA spacer against a bounded GRCh38 interval on both strands."""
from __future__ import annotations

from pathlib import Path
import re

from .reference import load_reference
from .sequence import ValidationError

MAX_RESOLVER_INTERVAL = 10_000
COORDINATE_SYSTEM = "0-based half-open, forward-reference coordinates"
_COMPLEMENT = str.maketrans("ACGT", "TGCA")


def resolve_guide(reference_path: str | Path, reference_metadata: dict, spacer: str,
                  chromosome: str, start0: int, end0: int) -> dict:
    """Return every exact 20-nt spacer with an actual unambiguous NGG PAM.

    The complete protospacer must lie inside [start0, end0). Up to three bases
    outside that interval are read to establish its adjacent PAM. Match start/end
    describe the whole 23-nt site including PAM in forward-reference coordinates.
    No match is selected, and no target sequence is synthesized or RNA-converted.
    """
    if not isinstance(spacer, str) or not re.fullmatch(r"[ACGTacgt]{20}", spacer.strip()):
        raise ValidationError("Enter exactly 20 DNA bases (A, C, G, T); RNA U and ambiguous bases are unsupported.")
    spacer = spacer.strip().upper()
    if (type(start0) is not int or type(end0) is not int or start0 < 0
            or not 20 <= end0 - start0 <= MAX_RESOLVER_INTERVAL):
        raise ValidationError("Choose a 0-based half-open interval containing 20 to 10,000 bases.")
    reference = load_reference(reference_path, reference_metadata)
    try:
        contig = reference.resolve_contig(chromosome)
        if end0 > reference.contigs[contig]:
            raise ValueError("Interval extends beyond the reference chromosome.")
    except ValueError as exc:
        raise ValidationError(str(exc)) from exc
    read_start, read_end = max(0, start0 - 3), min(reference.contigs[contig], end0 + 3)
    sequence = reference.fetch(contig, read_start, read_end, max_bases=MAX_RESOLVER_INTERVAL + 6)
    reverse_spacer = spacer.translate(_COMPLEMENT)[::-1]
    matches = []
    for position in range(start0, end0 - 19):
        offset = position - read_start
        bases = sequence[offset:offset + 20]
        for strand in ("+", "-"):
            if strand == "+":
                if bases != spacer:
                    continue
                target = sequence[offset:offset + 23]
                site_start, site_end = position, position + 23
            else:
                if bases != reverse_spacer or offset < 3:
                    continue
                target = sequence[offset - 3:offset + 20].translate(_COMPLEMENT)[::-1]
                site_start, site_end = position - 3, position + 20
            if not re.fullmatch(r"[ACGT]{21}GG", target):
                continue
            matches.append({
                "chromosome": contig, "start": site_start, "end": site_end,
                "spacer_start": position, "spacer_end": position + 20,
                "strand": strand, "target23": target, "pam": target[-3:],
                "assembly": "GRCh38", "coordinate_system": COORDINATE_SYSTEM,
                "reference_sha256": reference.sha256,
            })
    matches.sort(key=lambda match: (match["start"], match["end"], match["strand"]))
    return {
        "spacer": spacer, "matches": matches, "assembly": "GRCh38",
        "reference_sha256": reference.sha256,
        "scope": {
            "chromosome": contig, "requested_chromosome": chromosome,
            "start": start0, "end": end0, "read_start": read_start, "read_end": read_end,
            "coordinate_system": COORDINATE_SYSTEM, "strands": ["+", "-"],
            "match_rule": "Exact complete 20-nt spacer within the interval; adjacent reference NGG PAM.",
            "reference_scope": reference_metadata.get("scope", "Installed GRCh38 reference contigs"),
            "complete": True,
        },
        "selection_required": True,
        "limitations": ["Only the selected interval was searched; matches elsewhere are not excluded.",
                        "Reference sequence does not account for individual variants."],
    }
