"""Read-only aggregate audit of the supplied CRISPert-small CSV bundle.

Run from the repository root:
  python3 docs/nar-readiness/audit_dataset_overlap.py > docs/nar-readiness/dataset-audit.json

This script neither trains nor scores models. It outputs counts and file hashes,
never raw sequences or genomic coordinates. The reported training corpus is the
supplied README's assertion; exact checkpoint training membership is unverified.
"""

import csv
import hashlib
import itertools
import json
from collections import Counter, defaultdict
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "Model/crispert_share/data"
TRAIN = "tcell_guideseq.csv"


def reverse_complement(sequence):
    return sequence.translate(str.maketrans("ACGTN", "TGCAN"))[::-1]


def read_dataset(path):
    with path.open(newline="") as handle:
        reader = csv.DictReader(handle)
        fields = reader.fieldnames
        guide_col = next(c for c in ("target", "sgRNA", "Guide_sequence", "AlignedTarget") if c in fields)
        site_col = next(c for c in ("off_target", "offtarget", "Target_sequence", "AlignedText") if c in fields)
        label_col = next(c for c in ("label", "Label") if c in fields)
        rows = [(row[guide_col].strip().upper(), row[site_col].strip().upper(), int(float(row[label_col]))) for row in reader]
    assert all(len(g) == len(s) == 23 and set(g + s) <= set("ACGTN") and label in (0, 1) for g, s, label in rows)
    groups = defaultdict(list)
    pair_labels = defaultdict(set)
    for guide, site, label in rows:
        groups[guide].append((site, label))
        pair_labels[(guide, site)].add(label)
    positives = sum(label for _, _, label in rows)
    positive_by_guide = sorted(sum(label for _, label in group) for group in groups.values())
    eligible_positives = sum(label for guide, site, label in rows if site[-2:] == "GG" and sum(a != b for a, b in zip(guide[:20], site[:20])) <= 4)
    summary = {
        "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
        "rows": len(rows), "positives": positives, "negatives": len(rows) - positives,
        "guides_23nt": len(groups), "guides_20nt": len({g[:20] for g in groups}),
        "positive_counts_per_guide_sorted": positive_by_guide,
        "zero_positive_guides": sum(n == 0 for n in positive_by_guide),
        "duplicate_pair_rows": len(rows) - len(pair_labels),
        "within_dataset_pair_label_conflicts": sum(len(labels) > 1 for labels in pair_labels.values()),
        "positive_candidate_PAM_counts": dict(sorted(Counter("NGG" if site[-2:] == "GG" else "non_NGG" for _, site, label in rows if label).items())),
        "positive_pairs_satisfying_NGG_and_at_most_4_protospacer_mismatches": eligible_positives,
        "scope_note": "Sequence eligibility only; actual GRCh38 primary-assembly presence, orientation, and retrieval were not evaluated.",
    }
    return {"rows": rows, "groups": groups, "pairs": pair_labels, "summary": summary}


def compare(left, right):
    lg, rg = set(left["groups"]), set(right["groups"])
    l20, r20 = {g[:20] for g in lg}, {g[:20] for g in rg}
    shared = set(left["pairs"]) & set(right["pairs"])
    assert all(len(labels) == 1 for dataset in (left, right) for labels in dataset["pairs"].values())
    left_labels = {p: next(iter(labels)) for p, labels in left["pairs"].items()}
    right_labels = {p: next(iter(labels)) for p, labels in right["pairs"].items()}
    transitions = Counter(f"left_{left_labels[p]}_right_{right_labels[p]}" for p in shared)
    guide_counts = sorted(
        ({"left_rows": len(left["groups"][guide]),
          "left_positives": sum(label for _, label in left["groups"][guide]),
          "right_rows": len(right["groups"][guide]),
          "right_positives": sum(label for _, label in right["groups"][guide])} for guide in lg & rg),
        key=lambda row: tuple(row.values()),
    )
    return {
        "exact_23nt_guides": len(lg & rg), "exact_20nt_guides": len(l20 & r20),
        "reverse_complement_20nt_matches": len(l20 & {reverse_complement(g) for g in r20}),
        "reverse_complement_note": "A screening check only: reverse-complement protospacers are not automatically the same oriented Cas9 target/PAM.",
        "exact_sequence_pairs": len(shared), "shared_pair_label_transitions": dict(sorted(transitions.items())),
        "shared_pairs_with_discordant_labels": sum(left_labels[p] != right_labels[p] for p in shared),
        "shared_guide_group_counts": guide_counts,
    }


def main():
    datasets = {path.name: read_dataset(path) for path in sorted(DATA.glob("*.csv"))}
    assert TRAIN in datasets
    report = {
        "audit_date": "2026-09-19",
        "method": "Standard-library CSV read; case/outer-whitespace normalized; exact directional sequence comparison; binary labels.",
        "reported_training_corpus": TRAIN,
        "provenance_limit": "The supplied README identifies this corpus as training data. Saved checkpoints name another original CSV and do not include row-level split membership; this audit does not establish which exact rows reached gradient training or validation.",
        "datasets": {name: dataset["summary"] for name, dataset in datasets.items()},
        "pairwise_overlap": {f"{left} | {right}": compare(datasets[left], datasets[right]) for left, right in itertools.combinations(datasets, 2)},
    }
    print(json.dumps(report, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
