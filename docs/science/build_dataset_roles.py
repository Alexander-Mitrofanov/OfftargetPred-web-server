"""Build aggregate guide-role metadata without publishing sequences or rows.

Run from the repository root with the private supplied bundle present:
  python3 docs/science/build_dataset_roles.py --check
  python3 docs/science/build_dataset_roles.py --write

This uses the existing aggregate audit, checks every CSV against its saved hash
and counts, and computes guide fingerprints. It performs no model inference.
Unknown training/split/selection provenance is deliberately not reconstructed.
"""

import argparse
import hashlib
import importlib.util
import itertools
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
AUDIT_PATH = ROOT / "docs/nar-readiness/dataset-audit.json"
OUTPUT = ROOT / "docs/science/dataset-roles.json"
SPEC = importlib.util.spec_from_file_location(
    "dataset_overlap_audit", ROOT / "docs/nar-readiness/audit_dataset_overlap.py"
)
AUDIT = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(AUDIT)


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def fingerprint(sequence):
    return hashlib.sha256(sequence.encode("ascii")).hexdigest()


def build_manifest():
    audit = json.loads(AUDIT_PATH.read_text())
    datasets = {
        name: AUDIT.read_dataset(AUDIT.DATA / name)
        for name in sorted(audit["datasets"])
    }
    for name, dataset in datasets.items():
        if dataset["summary"] != audit["datasets"][name]:
            raise ValueError(f"Saved aggregate audit is stale for {name}; review before regenerating")
    for left, right in itertools.combinations(datasets, 2):
        if AUDIT.compare(datasets[left], datasets[right]) != audit["pairwise_overlap"][f"{left} | {right}"]:
            raise ValueError(f"Saved overlap audit is stale for {left} / {right}")

    reported_training = datasets[AUDIT.TRAIN]
    train20 = {guide[:20] for guide in reported_training["groups"]}
    result = {
        "schema_version": 1,
        "audit_date": audit["audit_date"],
        "aggregate_audit": {"path": str(AUDIT_PATH.relative_to(ROOT)), "sha256": sha256(AUDIT_PATH)},
        "guide_identity": {
            "normalization": "Trim outer whitespace; uppercase; directional sequence with PAM last.",
            "guide_23nt_sha256": "SHA-256 of the normalized 23 nt guide as ASCII, without a newline.",
            "split_group_20nt_sha256": "SHA-256 of the first 20 normalized guide bases as ASCII, without a newline. Repeated protospacers across all cells/datasets share this group.",
            "limitation": "Fingerprints support exact identity checks; they do not anonymize sequences or establish biological equivalence. No raw sequence, pair row, or coordinate is included.",
        },
        "role_policy": {
            "reported_training_corpus": "Training-corpus role is attributed to the supplied README, not verified row-level gradient membership.",
            "supplied_cross_cell_evaluation": "Supplied evaluation role does not establish independence from training or model selection.",
            "unknown_membership": "Actual gradient-training and validation row membership and model-selection use remain unknown for every guide.",
            "future_split_policy": "Keep the same split_group_20nt_sha256 together across datasets. Exclude entire overlapping guide groups, not only repeated pairs, for a guide-disjoint comparison to the reported training corpus. Such a comparison still is not an untouched independent test.",
        },
        "datasets": {},
    }
    for name, dataset in datasets.items():
        is_training = name == AUDIT.TRAIN
        role = "reported_training_corpus" if is_training else "supplied_cross_cell_evaluation"
        guides = []
        for guide, rows in dataset["groups"].items():
            positives = sum(label for _, label in rows)
            guides.append({
                "guide_23nt_sha256": fingerprint(guide),
                "split_group_20nt_sha256": fingerprint(guide[:20]),
                "rows": len(rows),
                "positives": positives,
                "label_zero_rows": len(rows) - positives,
                "both_label_classes_present": 0 < positives < len(rows),
                "reported_role": role,
                "actual_gradient_training_membership": "unknown",
                "actual_validation_membership": "unknown",
                "model_selection_use": "unknown",
                "present_in_datasets_by_20nt_guide": sorted(
                    other for other, value in datasets.items()
                    if any(g[:20] == guide[:20] for g in value["groups"])
                ),
                "reported_training_corpus_overlap": {
                    "exact_20nt_guide": guide[:20] in train20,
                    "exact_23nt_guide": guide in reported_training["groups"],
                    "exact_sequence_pairs": sum((guide, site) in reported_training["pairs"] for site, _ in rows),
                },
            })
        result["datasets"][name] = {
            "path": str((AUDIT.DATA / name).relative_to(ROOT)),
            "sha256": audit["datasets"][name]["sha256"],
            "reported_role": role,
            "role_evidence": "supplied_readme",
            "local_evidence_use": "reference_score_reproduction" if name == "k562_dataset_invivo_full.csv" else "aggregate_provenance_audit_only",
            "reported_context": {
                "cell": "T-cell" if is_training else "iPSC" if name.startswith("ipscs") else "K562",
                "assay": "GUIDE-seq" if is_training else None,
                "assay_status": "reported_by_bundle_readme" if is_training else "original_assay_not_verified",
                "nuclease": "SpCas9-style aligned sequence input; experimental reagent identity unverified",
            },
            "unresolved_provenance": {
                "original_publication": None,
                "original_accession": None,
                "original_download_url": None,
                "experimental_protocol_and_nuclease_variant": None,
                "candidate_and_label_zero_generation": None,
                "upstream_preprocessing_and_row_filtering": None,
                "assembly_and_coordinate_harmonization": None,
                "actual_training_validation_row_manifest": None,
                "model_selection_history": None,
                "redistribution_permission": None,
                "original_training_csv_equivalence": None,
            },
            "null_meaning": "Unknown or unverified; not evidence of absence or permission.",
            "guides": sorted(guides, key=lambda item: item["guide_23nt_sha256"]),
        }
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    action = parser.add_mutually_exclusive_group(required=True)
    action.add_argument("--check", action="store_true")
    action.add_argument("--write", action="store_true")
    args = parser.parse_args()
    manifest = build_manifest()
    if args.write:
        OUTPUT.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")
    elif json.loads(OUTPUT.read_text()) != manifest:
        raise SystemExit("Dataset role manifest differs from the audited bundle; review and regenerate")
    print("Dataset roles verified: 4 datasets, 37 guide occurrences; no model inference performed.")


if __name__ == "__main__":
    main()
