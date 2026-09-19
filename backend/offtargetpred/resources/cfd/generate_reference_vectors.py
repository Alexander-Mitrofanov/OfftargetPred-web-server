"""Recompute test vectors using the pinned Doench calculator, kept externally.

Run: python generate_reference_vectors.py REFERENCE_DIRECTORY OUTPUT_JSON
REFERENCE_DIRECTORY contains the three original files listed in ARTIFACTS.
No third-party source is embedded here; no files are downloaded or unpickled
with arbitrary-class support. This is an audit utility, not runtime scoring.
"""

from __future__ import annotations

import ast
import hashlib
import io
import json
import pickle
import sys
from itertools import product
from pathlib import Path


REFERENCE_COMMIT = "486659fb3594f57fa108698a5f2a1f3ae649968c"
ARTIFACTS = {
    "cfd-score-calculator.py": "75a034b1af0f89ad21b8653e854750495315c972adb86d9dd1bfb31179d181bc",
    "mismatch_score.pkl": "c58e9c1a85f01e423c35fd02aa5a27a23ab27e95c2e98abdcfc71cf4b2667f4b",
    "pam_scores.pkl": "ae486444a9135e3acc1f1b9a3973f1069e84efe7a1738a87d10d523bfb46b37e",
}


class _DataOnlyUnpickler(pickle.Unpickler):
    def find_class(self, module, name):
        raise ValueError("The audit parameters must not contain Python globals")


def generate(reference_dir: Path) -> dict:
    data = {name: (reference_dir / name).read_bytes() for name in ARTIFACTS}
    for name, digest in ARTIFACTS.items():
        if hashlib.sha256(data[name]).hexdigest() != digest:
            raise ValueError(f"Reference hash mismatch: {name}")

    mm = _DataOnlyUnpickler(io.BytesIO(data["mismatch_score.pkl"])).load()
    pam = _DataOnlyUnpickler(io.BytesIO(data["pam_scores.pkl"])).load()
    # The Python 2 CLI print is excluded. These two function bodies are used
    # verbatim, including T->U, complement lookup, 1-based index and product.
    source = data["cfd-score-calculator.py"].decode().split("if __name__ ==", 1)[0]
    parsed = ast.parse(source)
    functions = [node for node in parsed.body
                 if isinstance(node, ast.FunctionDef) and node.name in {"revcom", "calc_cfd"}]
    if {node.name for node in functions} != {"revcom", "calc_cfd"}:
        raise ValueError("Reference calculator functions missing")
    scope = {"get_mm_pam_scores": lambda: (mm, pam)}
    exec(compile(ast.Module(body=functions, type_ignores=[]), "pinned-doench-reference", "exec"), scope)
    oracle = scope["calc_cfd"]
    vectors = []

    def add(identifier, guide, site, **extra):
        assert len(guide) == len(site) == 23
        vectors.append({"id": identifier, "guide23": guide, "candidate23": site,
                        "expected": oracle(guide, site[:20], site[-2:]), **extra})

    spacer = "ATCGATGCTGATGCTAGATA"
    guide = spacer + "AGG"
    add("exact-match", guide, guide)
    for first in "ACGT":
        add(f"candidate-pam-first-{first}", guide, spacer + first + "GG")
    add("guide-pam-unused", spacer + "TAA", guide)
    for a, b in product("ACGT", repeat=2):
        if a == b:
            continue
        for pos in range(20):
            reference = spacer[:pos] + a + spacer[pos + 1:]
            candidate = spacer[:pos] + b + spacer[pos + 1:]
            add(f"mismatch-{a}-{b}-{pos + 1}", reference + "AGG", candidate + "TGG")
    for a, b in product("ACGT", repeat=2):
        add(f"pam-{a}{b}", guide, spacer + "C" + a + b)
    # The same ordered mutations exercise multiplication and non-NGG PAMs.
    for positions in ([1, 20], [2, 7, 14], [1, 5, 10, 15, 20], list(range(1, 21))):
        site = list(spacer)
        for pos in positions:
            site[pos - 1] = {"A": "C", "C": "T", "T": "G", "G": "A"}[site[pos - 1]]
        for site_pam in ("AGG", "TAG", "CGA", "TAA"):
            add("multiple-" + "-".join(map(str, positions)) + "-" + site_pam,
                guide, "".join(site) + site_pam)
    site = "ACCGATGCTGATGCTAGATAAGG"
    revcomp = site.translate(str.maketrans("ACGT", "TGCA"))[::-1]
    add("oriented-plus-locus", guide, site, strand="+", genomic_forward_sequence=site)
    add("oriented-minus-locus", guide, site, strand="-", genomic_forward_sequence=revcomp)
    return {
        "schema_version": 1,
        "reference_repository": "https://github.com/maximilianh/crisporWebsite",
        "reference_commit": REFERENCE_COMMIT,
        "reference_path": "CFD_Scoring",
        "reference_artifact_sha256": ARTIFACTS,
        "procedure": "Execute unchanged Doench revcom and calc_cfd function bodies with original parameter dictionaries; omit Python 2 CLI and replace file loader with data-only deserialization.",
        "absolute_tolerance": 1e-12,
        "vectors": vectors,
    }


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("Usage: generate_reference_vectors.py REFERENCE_DIRECTORY OUTPUT_JSON")
    Path(sys.argv[2]).write_text(json.dumps(generate(Path(sys.argv[1])), indent=2) + "\n")
