"""Local, per-site SpCas9 CFD baseline with pinned crisprScore parameters.

Inputs are aligned, guide-oriented DNA 23-mers (20 bases followed by actual
3-base PAM). Genomic minus-strand hits must already have been oriented by the
caller. A CFD score is neither a calibrated probability nor a guide-level score.
See docs/implementation/16-cfd.md for source, license and numerical audit.
"""

from __future__ import annotations

import hashlib
import math
from functools import lru_cache
from importlib.resources import files
from itertools import product
from types import MappingProxyType
from typing import Mapping


CFD_VERSION = "cfd-spcas9-doench2016-crisprscore-595d9a8-v1"
_SOURCE_COMMIT = "595d9a8ad1f4ba95ee2dca20786921f89be3004c"
_SOURCE_ROOT = f"https://github.com/crisprVerse/crisprScore/blob/{_SOURCE_COMMIT}"
_HASHES = {
    "cfd.mm.scores.cas9.txt": "636e1d8e65f429db8c578036a673cb4516e896c05f594e3ab134734aab84dafc",
    "cfd.pam.scores.cas9.txt": "3f83c4f659cda48795312c080f8528984a3ce25f9b2475d79cb80b4835fb3b45",
}
_COMPLEMENT = {"A": "T", "C": "G", "G": "C", "T": "A"}
_UNAVAILABLE = "CFD parameter files are unavailable or failed integrity validation."


class CFDParameterError(ValueError):
    """The pinned parameter resource is unavailable or invalid."""


def _read_table(filename: str, expected_keys: set[str]) -> dict[str, float]:
    try:
        data = files("offtargetpred").joinpath("resources", "cfd", filename).read_bytes()
        if hashlib.sha256(data).hexdigest() != _HASHES[filename]:
            raise ValueError("Parameter hash mismatch")
        table: dict[str, float] = {}
        for line in data.decode("ascii").splitlines():
            key, value_text = line.split()
            value = float(value_text)
            if key in table or not math.isfinite(value) or not 0 <= value <= 1:
                raise ValueError("Invalid parameter")
            table[key] = value
        if table.keys() != expected_keys:
            raise ValueError("Incomplete parameter table")
        return table
    except (OSError, UnicodeError, ValueError) as exc:
        raise CFDParameterError(_UNAVAILABLE) from exc


@lru_cache(maxsize=1)
def _parameters() -> tuple[Mapping[str, float], Mapping[str, float]]:
    # crisprScore labels each weight with guide DNA + candidate DNA + position.
    # The original Doench notation is guide RNA : complementary target DNA.
    expected_mm = {f"{a}{b}{p}" for a, b in product("ACGT", repeat=2)
                   if a != b for p in range(1, 21)}
    dna_weights = _read_table("cfd.mm.scores.cas9.txt", expected_mm)
    rna_weights = {
        f"r{key[0].replace('T', 'U')}:d{_COMPLEMENT[key[1]]},{key[2:]}": value
        for key, value in dna_weights.items()
    }
    pam_weights = _read_table("cfd.pam.scores.cas9.txt", {a + b for a, b in product("ACGT", repeat=2)})
    return MappingProxyType(rna_weights), MappingProxyType(pam_weights)


def _normalize(value: object, label: str) -> tuple[str | None, str | None]:
    if not isinstance(value, str):
        return None, f"{label} must be a DNA sequence string."
    sequence = value.strip().upper()
    if "-" in sequence or "." in sequence:
        return None, f"{label} contains a gap; CFD supports ungapped alignments only."
    if len(sequence) != 23:
        return None, f"{label} must contain exactly 23 bases (20 nt + 3 nt PAM)."
    if "N" in sequence:
        return None, f"{label} contains N; CFD requires unambiguous A/C/G/T bases."
    if "U" in sequence:
        return None, f"{label} contains RNA U; provide the guide-oriented DNA sequence using T."
    if any(base not in "ACGT" for base in sequence):
        return None, f"{label} contains unsupported bases; CFD requires A/C/G/T only."
    return sequence, None


def score_cfd(guide23: str, candidate23: str) -> dict:
    """Return ``{score, version}``, or ``{score: None, reason, version}``.

    Position 1 is PAM-distal; position 20 is PAM-proximal. Only spacer
    mismatches and the candidate PAM's final two bases contribute. The guide
    PAM and candidate PAM's first base are validated but do not affect CFD.
    Case and outer whitespace are normalized. No network access occurs.
    """
    guide, reason = _normalize(guide23, "Guide")
    if reason:
        return {"score": None, "reason": reason, "version": CFD_VERSION}
    candidate, reason = _normalize(candidate23, "Candidate")
    if reason:
        return {"score": None, "reason": reason, "version": CFD_VERSION}
    try:
        mm_weights, pam_weights = _parameters()
    except CFDParameterError:
        return {"score": None, "reason": _UNAVAILABLE, "version": CFD_VERSION}

    score = 1.0
    for position, (guide_base, site_base) in enumerate(zip(guide[:20], candidate[:20]), 1):
        if guide_base != site_base:
            rna_base = "U" if guide_base == "T" else guide_base
            key = f"r{rna_base}:d{_COMPLEMENT[site_base]},{position}"
            score *= mm_weights[key]
    score *= pam_weights[candidate[-2:]]
    return {"score": score, "version": CFD_VERSION}


def cfd_metadata() -> dict:
    """JSON-compatible method/provenance metadata for the analysis document."""
    try:
        _parameters()
        available = True
    except CFDParameterError:
        available = False
    result = {
        "name": "CFD",
        "version": CFD_VERSION,
        "available": available,
        "nuclease": "SpCas9",
        "score_scope": "per-site",
        "score_range": [0.0, 1.0],
        "higher_means": "Greater predicted relative off-target cleavage activity",
        "calibrated_probability": False,
        "input": "Two ungapped, guide-oriented 23 nt DNA sequences (20 nt spacer + actual 3 nt PAM)",
        "position_convention": "1-based from guide 5-prime end; 1 PAM-distal, 20 PAM-proximal",
        "pam_convention": "Candidate final two bases; guide PAM and candidate PAM first base have no effect",
        "parameter_source": "crisprVerse/crisprScore",
        "parameter_commit": _SOURCE_COMMIT,
        "parameter_files": [
            {"filename": name, "sha256": digest, "url": f"{_SOURCE_ROOT}/inst/cfd_cas9/{name}"}
            for name, digest in _HASHES.items()
        ],
        "parameter_license": "MIT; Copyright (c) 2022 Genentech, Inc.",
        "license_url": f"{_SOURCE_ROOT}/LICENSE",
        "citation": "Doench et al. (2016), Nature Biotechnology 34:184-191, doi:10.1038/nbt.3437",
        "citation_url": "https://doi.org/10.1038/nbt.3437",
        "limitations": [
            "Sequence-only baseline; no cell or chromatin context.",
            "N, gaps, ambiguous bases, RNA inputs and non-23 nt inputs are unsupported.",
            "Zero is a model weight, not proof of no cleavage.",
            "Separate from CRISPert; no averaging or guide-level risk aggregation.",
            "A score does not establish candidate-search completeness.",
        ],
    }
    if not available:
        result["reason"] = _UNAVAILABLE
    return result
