"""Aggregate sequence-filter audit; never a genomic-retrieval or model benchmark.

Run on the de.NBI VM from the repository root. Only the four fingerprinted
supplied files are read. No sequences, row IDs or coordinates leave this script.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
PAM_CLASSES = ("NGG", "NAG", "NGA", "other_unambiguous", "unresolved")
THRESHOLDS = (0, 1, 2, 3, 4, 5, 6, 20)


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def pam_class(site: str) -> str:
    if "N" in site[-3:]:
        return "unresolved"
    return {"GG": "NGG", "AG": "NAG", "GA": "NGA"}.get(site[-2:], "other_unambiguous")


def summarize(pairs: list[tuple[str, str, int]]) -> dict:
    """Count submitted rows without deduplication; strict eligibility excludes N."""
    counts = {name: {"rows": 0, "positive_rows": 0} for name in PAM_CLASSES}
    scopes = {
        pam: {str(limit): {"rows": 0, "positive_rows": 0} for limit in THRESHOLDS}
        for pam in ("NGG", "NGG_or_NAG", "any_unambiguous_PAM")
    }
    partitions = {
        name: {"rows": 0, "positive_rows": 0}
        for name in ("current_NGG_0_to_4", "NGG_more_than_4", "non_NGG_0_to_4", "non_NGG_more_than_4", "unresolved_bases")
    }
    positive_rows = 0
    for target, site, label in pairs:
        if len(target) != 23 or len(site) != 23 or set(target + site) - set("ACGTN") or label not in (0, 1):
            raise ValueError("Expected aligned 23-base DNA pairs and binary labels.")
        positive_rows += label
        pam = pam_class(site)
        counts[pam]["rows"] += 1
        counts[pam]["positive_rows"] += label
        if "N" in target + site:
            partition = "unresolved_bases"
        else:
            mismatch_count = sum(a != b for a, b in zip(target[:20], site[:20]))
            partition = (
                "current_NGG_0_to_4" if pam == "NGG" and mismatch_count <= 4
                else "NGG_more_than_4" if pam == "NGG"
                else "non_NGG_0_to_4" if mismatch_count <= 4
                else "non_NGG_more_than_4"
            )
            for scope, included in (
                ("NGG", pam == "NGG"),
                ("NGG_or_NAG", pam in ("NGG", "NAG")),
                ("any_unambiguous_PAM", True),
            ):
                if included:
                    for limit in THRESHOLDS:
                        if mismatch_count <= limit:
                            scopes[scope][str(limit)]["rows"] += 1
                            scopes[scope][str(limit)]["positive_rows"] += label
        partitions[partition]["rows"] += 1
        partitions[partition]["positive_rows"] += label
    return {
        "rows": len(pairs), "positive_rows": positive_rows,
        "label_zero_rows": len(pairs) - positive_rows,
        "candidate_PAM_classes": counts,
        "mutually_exclusive_current_scope_partition": partitions,
        "hypothetical_sequence_filter_counts": scopes,
    }


def read_pairs(path: Path) -> list[tuple[str, str, int]]:
    with path.open(newline="") as handle:
        reader = csv.DictReader(handle)
        fields = reader.fieldnames or []
        guide = next(name for name in ("target", "sgRNA", "Guide_sequence", "AlignedTarget") if name in fields)
        site = next(name for name in ("off_target", "offtarget", "Target_sequence", "AlignedText") if name in fields)
        label = next(name for name in ("label", "Label") if name in fields)
        rows = []
        for number, row in enumerate(reader, 2):
            try:
                value = float(row[label])
                if value not in (0, 1):
                    raise ValueError
                rows.append((row[guide].strip().upper(), row[site].strip().upper(), int(value)))
            except (TypeError, ValueError, KeyError) as exc:
                raise ValueError(f"Invalid pair/label at CSV row {number}.") from exc
        return rows


def build_report(data_root: Path) -> dict:
    prior_path = ROOT / "docs/nar-readiness/dataset-audit.json"
    prior = json.loads(prior_path.read_text())
    datasets = {}
    for name, expected in sorted(prior["datasets"].items()):
        if Path(name).name != name:
            raise ValueError("Dataset manifest requires plain filenames.")
        path = data_root / name
        sha256 = digest(path)
        if sha256 != expected["sha256"]:
            raise ValueError(f"Fingerprint changed for {name}; stop and review provenance.")
        summary = summarize(read_pairs(path))
        if (summary["rows"], summary["positive_rows"]) != (expected["rows"], expected["positives"]):
            raise ValueError(f"Dataset totals disagree for {name}.")
        datasets[name] = {"sha256": sha256, **summary}
    return {
        "schema_version": 1,
        "generator_sha256": digest(Path(__file__)),
        "source_audit_sha256": digest(prior_path),
        "scope": "Sequence-filter eligibility in the four supplied files only; not actual genome search, recall, cost, cleavage probability or evidence supporting a new PAM mode.",
        "method": "Trim outer whitespace; uppercase aligned 23-base pairs; count substitutions at positions 1–20 only; exclude any pair containing N from strict filter counts. Preserve every row, including label-zero rows. Threshold 20 removes only the protospacer substitution limit.",
        "provenance_limits": [
            "Dataset assembly, assay detection limits and label-zero generation are incompletely traced.",
            "Files share some guides and pairs; do not sum them as independent observations.",
            "The T-cell file is a reported training corpus; actual checkpoint training membership is unknown.",
            "NGG_or_NAG and any_unambiguous_PAM are hypothetical string filters, not supported discovery modes or validated biochemical PAM sets.",
            "Guide-associated PAM suitability is not inferred; input shape compatibility does not establish model accuracy in a stratum.",
        ],
        "datasets": datasets,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-root", type=Path, default=ROOT / "Model/crispert_share/data")
    args = parser.parse_args()
    print(json.dumps(build_report(args.data_root), indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
