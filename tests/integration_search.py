"""Independent live Cas-OFFinder correctness check on a synthetic FASTA.

Run with the actual installed binary/OpenCL device; no mocks or human reference
are used. A brute-force enumerator independently verifies every expected site,
both strands, start-zero coordinates, repeats, multiple contigs, mismatch
thresholds, PAM variation, and an empty result. The temporary manifest uses
assembly=GRCh38 only to exercise the production adapter; it is explicitly
synthetic and must never be installed as the public reference manifest.

PYTHONPATH=backend python tests/integration_search.py \
  --binary /srv/crispert/bin/cas-offinder --device G0 --output /tmp/search-check.json
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import random
import tempfile
import time

from offtargetpred.search import CasOffinderSearch


GUIDE = "GATGCTCTCCAGAATCACTGCGG"
RC = str.maketrans("ACGTN", "TGCAN")


def reverse_complement(sequence):
    return sequence.translate(RC)[::-1]


def synthetic_reference():
    rng = random.Random(9142)
    background = "".join(rng.choices("ACGT", k=800))
    one_mismatch = "C" + GUIDE[1:]
    two_mismatch = "CC" + GUIDE[2:]
    # N blocks isolate manually introduced sites without preventing genuine
    # random-window matches; the independent oracle accounts for all windows.
    barrier = "N" * 40
    return {
        "synthetic_a": GUIDE + barrier + background + barrier + reverse_complement(one_mismatch) + barrier + GUIDE,
        "synthetic_b": background[::-1] + barrier + GUIDE[:20] + "AGG" + barrier + two_mismatch + barrier + reverse_complement(GUIDE),
    }


def enumerate_expected(contigs, guides, limit):
    expected = set()
    for guide in guides:
        for chromosome, sequence in contigs.items():
            for start in range(len(sequence) - 22):
                forward = sequence[start:start + 23]
                if "N" in forward:
                    continue
                for strand, candidate in (("+", forward), ("-", reverse_complement(forward))):
                    mismatch = sum(a != b for a, b in zip(guide["target"][:20], candidate[:20]))
                    if candidate[-2:] == "GG" and mismatch <= limit:
                        expected.add((guide["id"], chromosome, start, start + 23, strand, candidate, mismatch, guide["target"]))
    return expected


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--binary", required=True)
    parser.add_argument("--device", default="G0")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    start = time.monotonic()
    contigs = synthetic_reference()
    guides = [{"id": "original", "target": GUIDE}, {"id": "alternative_pam", "target": GUIDE[:20] + "AGG"}]
    report = {"fixture": "synthetic-only; not a human reference", "device": args.device, "checks": []}
    with tempfile.TemporaryDirectory(prefix="crispert-search-check-") as temporary:
        root = Path(temporary)
        fasta = root / "synthetic.fa"
        # Ensembl uses descriptive FASTA headers; Cas2.4.1 emits the whole
        # header, which the production parser must normalize to its first token.
        fasta.write_text("".join(f">{name} dna:chromosome chromosome:synthetic:{name}:1:{len(sequence)}:1 REF\n{sequence}\n"
                                 for name, sequence in contigs.items()))
        manifest = {"assembly": "GRCh38", "id": "synthetic-adapter-test-only", "name": "Synthetic validation fixture, NOT GRCh38",
                    "synthetic": True, "verified": True, "filename": fasta.name, "sha256": hashlib.sha256(fasta.read_bytes()).hexdigest()}
        search = CasOffinderSearch(args.binary, root, manifest, timeout=120, max_candidates=50000, device=args.device)
        for threshold in (0, 1, 2):
            expected = enumerate_expected(contigs, guides, threshold)
            rows = search.search(guides, threshold, root / f"mismatch-{threshold}")
            actual = {(r["guide_id"], r["chromosome"], r["start"], r["end"], r["strand"], r["off_target"], r["mismatches"], r["target"]) for r in rows}
            if actual != expected:
                raise AssertionError(f"Threshold {threshold}: missing={sorted(expected - actual)}, unexpected={sorted(actual - expected)}")
            assert len(rows) == len(actual), "Duplicate rows must be removed consistently."
            assert any(r["strand"] == "-" for r in rows), "Fixture must test reverse strand."
            assert any(r["start"] == 0 for r in rows), "Fixture must test genomic position zero."
            assert any(r["protospacer_match"] and not r["exact_match"] for r in rows), "Original PAM must survive candidate search."
            report["checks"].append({"mismatch_limit": threshold, "expected": len(expected), "observed": len(rows), "passed": True})
        absent = [{"id": "absent", "target": "A" * 20 + "AGG"}]
        assert not enumerate_expected(contigs, absent, 0)
        rows = search.search(absent, 0, root / "zero-hits")
        assert rows == [], "Zero-hit search must return a successful empty result."
        report["checks"].append({"case": "zero_hits", "expected": 0, "observed": len(rows), "passed": True})
    report["elapsed_seconds"] = round(time.monotonic() - start, 2)
    text = json.dumps(report, indent=2)
    if args.output:
        args.output.write_text(text + "\n")
    print(text)


if __name__ == "__main__":
    main()
