"""Reproduce aggregate diagnostics without publishing the supplied pair files.

Run on the authorized model VM, from the repository root, with the reference
dependencies installed. Inference uses the unchanged production adapter. The
optional cache contains private, row-ordered scores and belongs outside Git.
"""

from __future__ import annotations

import argparse
from collections import defaultdict
import csv
from datetime import datetime, timezone
import hashlib
from itertools import combinations
import json
import math
from pathlib import Path
import statistics
import time


ROOT = Path(__file__).resolve().parents[2]
METHODS = ("k1", "k2", "k3", "cfd")
DATASETS = (
    "k562_dataset_invivo_full.csv",
    "k562_deepcrispr_withCoords_hg38.csv",
    "ipscs_dataset_invivo_full.csv",
)


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def fingerprint(sequence: str) -> str:
    return hashlib.sha256(sequence.encode("ascii")).hexdigest()


def score_digest(scores: dict) -> str:
    return hashlib.sha256(json.dumps(scores, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()).hexdigest()


def average_precision(labels: list[int], scores: list[float]) -> float | None:
    """Non-interpolated AP; equal scores enter together, as in sklearn.

    Zero-positive groups are explicitly undefined instead of quietly reporting
    zero or letting library warnings decide the macro denominator.
    """
    if len(labels) != len(scores):
        raise ValueError("Labels and scores must have the same length.")
    if any(label not in (0, 1) for label in labels):
        raise ValueError("Labels must be binary.")
    if any(not math.isfinite(score) for score in scores):
        raise ValueError("Scores must be finite.")
    positives = sum(labels)
    if not positives:
        return None
    buckets = defaultdict(lambda: [0, 0])
    for label, score in zip(labels, scores):
        buckets[score][0] += label
        buckets[score][1] += 1
    seen = true_positive = 0
    ap = 0.0
    for score in sorted(buckets, reverse=True):
        added_positive, added_count = buckets[score]
        seen += added_count
        true_positive += added_positive
        ap += (added_positive / positives) * (true_positive / seen)
    return ap


def average_ranks(values: list[float]) -> list[float]:
    """Ascending one-based ranks with average ranks for exact ties."""
    order = sorted(range(len(values)), key=values.__getitem__)
    ranks = [0.0] * len(values)
    start = 0
    while start < len(order):
        end = start + 1
        while end < len(order) and values[order[end]] == values[order[start]]:
            end += 1
        rank = (start + 1 + end) / 2
        for index in order[start:end]:
            ranks[index] = rank
        start = end
    return ranks


def spearman(left: list[float], right: list[float]) -> float | None:
    if len(left) != len(right):
        raise ValueError("Rank vectors must have equal lengths.")
    if len(left) < 2 or len(set(left)) < 2 or len(set(right)) < 2:
        return None
    return statistics.correlation(average_ranks(left), average_ranks(right))


def read_pairs(path: Path) -> list[tuple[str, str, int]]:
    with path.open(newline="") as handle:
        reader = csv.DictReader(handle)
        fields = reader.fieldnames or []
        guide = next(c for c in ("target", "sgRNA", "Guide_sequence", "AlignedTarget") if c in fields)
        site = next(c for c in ("off_target", "offtarget", "Target_sequence", "AlignedText") if c in fields)
        label = next(c for c in ("label", "Label") if c in fields)
        pairs = []
        for row in reader:
            target, candidate = row[guide].strip().upper(), row[site].strip().upper()
            value = float(row[label])
            if len(target) != 23 or len(candidate) != 23 or set(target + candidate) - set("ACGTN") or value not in (0, 1):
                raise ValueError(f"Invalid aligned pair or binary label in {path.name}.")
            pairs.append((target, candidate, int(value)))
    return pairs


def summarize(
    pairs: list[tuple[str, str, int]], scores: dict[str, list[float | None]],
    reported_training_20nt: set[str],
) -> dict:
    """Publish only aggregate counts/metrics and existing guide fingerprints."""
    if any(len(values) != len(pairs) for values in scores.values()):
        raise ValueError("Every method must preserve every input row.")
    groups = defaultdict(list)
    for index, (guide, _, _) in enumerate(pairs):
        groups[guide].append(index)
    guide_metrics = []
    for guide in sorted(groups, key=fingerprint):
        indices = groups[guide]
        labels = [pairs[index][2] for index in indices]
        methods = {}
        for method, values in scores.items():
            available = [index for index in indices if values[index] is not None]
            partial = len(available) != len(indices)
            ap = None if partial else average_precision(labels, [values[index] for index in indices])
            methods[method] = {
                "average_precision": ap,
                "available_rows": len(available),
                "unavailable_rows": len(indices) - len(available),
                "reason": "incomplete_method_coverage" if partial else "no_positive_labels" if not sum(labels) else None,
            }
        guide_metrics.append({
            "guide_23nt_sha256": fingerprint(guide),
            "split_group_20nt_sha256": fingerprint(guide[:20]),
            "reported_training_guide_overlap": guide[:20] in reported_training_20nt,
            "rows": len(indices), "positives": sum(labels),
            "label_zero_rows": len(indices) - sum(labels), "methods": methods,
        })
    partitions = {}
    for partition, member in (
        ("full", lambda guide: True),
        ("reported_training_guide_overlap", lambda guide: guide[:20] in reported_training_20nt),
        ("reported_training_guide_disjoint", lambda guide: guide[:20] not in reported_training_20nt),
    ):
        indices = [index for index, (guide, _, _) in enumerate(pairs) if member(guide)]
        selected_guides = [item for item in guide_metrics if partition == "full" or item["reported_training_guide_overlap"] == (partition == "reported_training_guide_overlap")]
        labels = [pairs[index][2] for index in indices]
        methods = {}
        for method, values in scores.items():
            aps = [item["methods"][method]["average_precision"] for item in selected_guides if item["methods"][method]["average_precision"] is not None]
            complete = all(values[index] is not None for index in indices)
            methods[method] = {
                "macro_average_precision": statistics.mean(aps) if aps else None,
                "pooled_average_precision": average_precision(labels, [values[index] for index in indices]) if complete else None,
                "macro_evaluated_guides": len(aps),
                "macro_excluded_guides": len(selected_guides) - len(aps),
                "guide_ap_min": min(aps) if aps else None,
                "guide_ap_max": max(aps) if aps else None,
                "available_rows": sum(values[index] is not None for index in indices),
                "unavailable_rows": sum(values[index] is None for index in indices),
                "pooled_reason": "incomplete_method_coverage" if not complete else "no_positive_labels" if not sum(labels) else None,
            }
        partitions[partition] = {
            "rows": len(indices), "guides": len(selected_guides), "positives": sum(labels),
            "label_zero_rows": len(indices) - sum(labels),
            "zero_positive_guides": sum(item["positives"] == 0 for item in selected_guides),
            "methods": methods,
        }
    agreement = []
    for left, right in combinations(scores, 2):
        per_guide = []
        for guide in sorted(groups, key=fingerprint):
            indices = [index for index in groups[guide] if scores[left][index] is not None and scores[right][index] is not None]
            left_scores = [scores[left][index] for index in indices]
            right_scores = [scores[right][index] for index in indices]
            k = min(10, len(indices))
            left_top = set(sorted(indices, key=lambda i: (-scores[left][i], i))[:k])
            right_top = set(sorted(indices, key=lambda i: (-scores[right][i], i))[:k])
            union = left_top | right_top
            per_guide.append({
                "guide_23nt_sha256": fingerprint(guide), "common_rows": len(indices),
                "spearman_rho": spearman(left_scores, right_scores),
                "top_k": k, "top_k_shared_rows": len(left_top & right_top),
                "top_k_jaccard": len(left_top & right_top) / len(union) if union else None,
            })
        rhos = [item["spearman_rho"] for item in per_guide if item["spearman_rho"] is not None]
        agreement.append({
            "left": left, "right": right, "per_guide": per_guide,
            "median_guide_spearman_rho": statistics.median(rhos) if rhos else None,
        })
    return {"partitions": partitions, "per_guide": guide_metrics, "descriptive_agreement": agreement}


def validate_report(report: dict) -> None:
    """Reject inconsistent public reports before replacing a saved artifact."""
    for dataset in report["datasets"]:
        partitions = dataset["partitions"]
        full = partitions["full"]
        for key in ("rows", "guides", "positives", "label_zero_rows"):
            if full[key] != sum(partitions[p][key] for p in ("reported_training_guide_overlap", "reported_training_guide_disjoint")):
                raise ValueError(f"Partition {key} do not sum to the full dataset.")
        if full["rows"] != full["positives"] + full["label_zero_rows"]:
            raise ValueError("Label counts do not sum to rows.")
        if len(dataset["per_guide"]) != full["guides"]:
            raise ValueError("Guide count is inconsistent.")
        for method in METHODS:
            item = full["methods"][method]
            if item["available_rows"] != full["rows"] or item["unavailable_rows"]:
                raise ValueError("Saved comparison requires full, identical candidate coverage.")
            if item["macro_evaluated_guides"] + item["macro_excluded_guides"] != full["guides"]:
                raise ValueError("Macro denominator is inconsistent.")
        for guide in dataset["per_guide"]:
            for method in METHODS:
                value = guide["methods"][method]["average_precision"]
                if value is not None and not 0 <= value <= 1:
                    raise ValueError("AP must be within [0, 1].")
    if not all(check["passed"] for check in report["reference_reproduction"]):
        raise ValueError("Supplied K562 reference AP was not reproduced.")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bundle", type=Path, default=ROOT / "Model/crispert_share")
    parser.add_argument("--output", type=Path, default=ROOT / "docs/validation/web-diagnostics.json")
    parser.add_argument("--cache-dir", type=Path)
    parser.add_argument("--device", choices=("cpu", "cuda"), default="cuda")
    args = parser.parse_args()
    import torch
    from offtargetpred.cfd import cfd_metadata, score_cfd
    from offtargetpred.inference import InferenceEngine
    torch.set_num_threads(4)
    roles_path = ROOT / "docs/science/dataset-roles.json"
    roles = json.loads(roles_path.read_text())
    train_path = args.bundle / "data/tcell_guideseq.csv"
    if sha256(train_path) != roles["datasets"][train_path.name]["sha256"]:
        raise ValueError("Reported training corpus differs from the audited file.")
    reported_training_20nt = {guide[:20] for guide, _, _ in read_pairs(train_path)}
    engine = InferenceEngine(args.bundle / "models", device=args.device, batch_size=512)
    engine.warmup()
    sources = ["backend/offtargetpred/inference.py", "backend/offtargetpred/sequence.py", "backend/offtargetpred/tokenizer.py", "backend/offtargetpred/cfd.py", "models.manifest.json"]
    source_hashes = {name: sha256(ROOT / name) for name in sources}
    if source_hashes["backend/offtargetpred/tokenizer.py"] != json.loads((ROOT / "models.manifest.json").read_text())["tokenizer_source_sha256"]:
        raise ValueError("Tokenizer source differs from the model manifest.")
    metadata = engine.metadata()
    cfd = cfd_metadata()
    if not cfd["available"]:
        raise ValueError("Pinned CFD parameters are unavailable.")
    datasets = []
    start = time.monotonic()
    for name in DATASETS:
        path = args.bundle / "data" / name
        digest = sha256(path)
        if digest != roles["datasets"][name]["sha256"]:
            raise ValueError(f"Dataset hash differs from the provenance record: {name}.")
        pairs = read_pairs(path)
        identity = {"schema": 1, "dataset_sha256": digest, "models": metadata, "sources": source_hashes, "cfd": cfd}
        cache_path = args.cache_dir / (name + ".scores.json") if args.cache_dir else None
        cache = json.loads(cache_path.read_text()) if cache_path and cache_path.is_file() else None
        reused = bool(cache and cache.get("identity") == identity and cache.get("scores_sha256") == score_digest(cache["scores"]))
        score_start = time.monotonic()
        if reused:
            scores = cache["scores"]
        else:
            rows = engine.score([{"target": guide, "off_target": site} for guide, site, _ in pairs], list(METHODS[:3]))
            scores = {method: [row["scores"][method] for row in rows] for method in METHODS[:3]}
            scores["cfd"] = [score_cfd(guide, site)["score"] for guide, site, _ in pairs]
            if cache_path:
                cache_path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
                cache_path.write_text(json.dumps({"identity": identity, "scores": scores, "scores_sha256": score_digest(scores)}, allow_nan=False))
                cache_path.chmod(0o600)
        diagnostic = summarize(pairs, scores, reported_training_20nt)
        expected = roles["datasets"][name]["guides"]
        if diagnostic["partitions"]["full"]["rows"] != sum(item["rows"] for item in expected):
            raise ValueError("Dataset count differs from the provenance record.")
        datasets.append({
            "id": name.removesuffix(".csv"), "display_name": {DATASETS[0]: "K562 full supplied pairs", DATASETS[1]: "K562 DeepCRISPR supplied pairs", DATASETS[2]: "iPSC supplied pairs"}[name],
            "filename": name, "sha256": digest,
            "candidate_scope": "Every row of the supplied file, without PAM/mismatch/genomic-retrieval filtering or deduplication.",
            "score_cache_reused": reused, "scoring_and_summary_seconds": round(time.monotonic() - score_start, 3),
            **diagnostic,
        })
    previous_path = ROOT / "docs/validation/model-benchmark.json"
    previous = json.loads(previous_path.read_text())
    checks = []
    for method in METHODS[:3]:
        value = datasets[0]["partitions"]["full"]["methods"][method]["macro_average_precision"]
        expected = previous["models"][method]["reference_macro_auprc"]
        checks.append({"method": method, "observed_macro_ap": value, "bundle_rounded_reference_macro_ap": expected, "tolerance": 0.0001, "passed": abs(value - expected) < 0.0001, "previous_cpu_macro_ap": previous["models"][method]["macro_auprc"], "absolute_delta_from_previous_cpu_run": abs(value - previous["models"][method]["macro_auprc"] )})
    report = {
        "schema_version": 1, "purpose": "Reproduction and descriptive diagnostics for the published-tool web interface; no new-method or superiority claim.",
        "generated_at": datetime.now(timezone.utc).isoformat(), "elapsed_seconds": round(time.monotonic() - start, 3),
        "runtime": {**metadata["runtime"], "device": metadata["device"], "precision": metadata["precision"], "batch_size": 512, "cuda_device_name": torch.cuda.get_device_name(0) if args.device == "cuda" else None},
        "provenance": {
            "model": metadata, "cfd": cfd,
            "source_sha256": source_hashes,
            "script_sha256": sha256(Path(__file__)),
            "dataset_roles_sha256": sha256(roles_path),
            "previous_reference_report_sha256": sha256(previous_path),
            "reported_training_corpus": {"filename": train_path.name, "sha256": sha256(train_path)},
        },
        "definitions": {
            "average_precision": "Non-interpolated average precision (AP), summing precision times the recall increase at each distinct score; exact ties enter together. Not trapezoidal area under an interpolated PR curve.",
            "macro_average_precision": "Unweighted mean of per-guide AP among guides with at least one positive label and complete score coverage. Zero-positive groups remain visible with null AP and excluded-guide counts.",
            "pooled_average_precision": "AP over every row in the partition, pooling all guides (micro AP); candidate-rich guides contribute more rows. Zero-positive guide rows remain included.",
            "reported_training_guide_disjoint": "Exclude entire 20 nt guide groups present in the bundle-reported T-cell corpus. Actual checkpoint training and model-selection exposure remain unknown.",
            "descriptive_agreement": "Per-guide Spearman correlation with averaged exact ties, plus top-10 overlap. Top-k exact-score ties use original file order. Constant rank vectors have null correlation. Agreement is not accuracy or uncertainty.",
            "guide_ap_min_and_max": "Observed spread across supplied guides; not a confidence interval.",
        },
        "uncertainty": {"confidence_intervals": None, "reason": "Only 5, 12 and 3 supplied guide groups, with 2 positive-containing iPSC groups; original selection history is unknown. No pair-level pseudo-replication or generalization interval is reported. Per-guide values expose heterogeneity."},
        "limitations": [
            "These are supplied-data diagnostics, not an untouched independent evaluation or a new state-of-the-art comparison.",
            "Original training/validation membership, model-selection history, assay accession and negative-generation procedure remain unresolved.",
            "One full-K562 guide and 981 exact pairs overlap the reported T-cell corpus; whole-guide-disjoint results still do not establish independence from model selection.",
            "The iPSC file has three guides with 0, 1 and 52 positives; its macro denominator is two guides.",
            "Label-zero rows are not established biological negatives; scores are uncalibrated and do not quantify cleavage probability or safety.",
            "The same full supplied rows are used for every method. These metrics do not measure the separate NGG/0–4-mismatch genome-search retrieval stage.",
            "Cross-dataset repeated guides and discordantly labelled pairs preclude treating datasets as independent replications.",
            "Private sequences, candidate records, coordinates and weights are excluded from this report; hashes identify artifacts without granting redistribution rights.",
        ],
        "datasets": datasets, "reference_reproduction": checks,
    }
    validate_report(report)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2, sort_keys=True, allow_nan=False) + "\n")
    print(json.dumps({"output": str(args.output), "datasets": len(datasets), "rows": sum(dataset["partitions"]["full"]["rows"] for dataset in datasets), "reference_checks_passed": len(checks), "elapsed_seconds": report["elapsed_seconds"]}))


if __name__ == "__main__":
    main()
