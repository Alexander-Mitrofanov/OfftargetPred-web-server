"""Metric edge cases and consistency of the public, sequence-free VM report."""

import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import random

import pytest


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "docs/validation/reproduce_web_diagnostics.py"
spec = importlib.util.spec_from_file_location("web_diagnostics", SCRIPT)
diagnostics = importlib.util.module_from_spec(spec)
spec.loader.exec_module(diagnostics)


@pytest.mark.parametrize(("labels", "scores", "expected"), [
    ([1, 0, 1], [0.9, 0.8, 0.7], 5 / 6),
    ([1, 0], [0.5, 0.5], 0.5),
    ([0, 1], [0.5, 0.5], 0.5),
    ([1, 1], [0.3, 0.1], 1.0),
    ([0, 0], [0.8, 0.1], None),
    ([], [], None),
])
def test_ap_uses_distinct_thresholds_and_explicit_undefined(labels, scores, expected):
    result = diagnostics.average_precision(labels, scores)
    assert result is None if expected is None else result == pytest.approx(expected)


@pytest.mark.parametrize(("labels", "scores"), [([1], []), ([2], [0.5]), ([1], [float("nan")])])
def test_ap_rejects_invalid_values(labels, scores):
    with pytest.raises(ValueError):
        diagnostics.average_precision(labels, scores)


def test_rank_ties_and_constant_vectors():
    assert diagnostics.average_ranks([0.2, 0.1, 0.2, 0.5]) == [2.5, 1, 2.5, 4]
    assert diagnostics.spearman([1, 2, 2], [2, 1, 1]) == pytest.approx(-1)
    assert diagnostics.spearman([1, 1], [2, 3]) is None
    assert diagnostics.spearman([], []) is None


def test_independent_sklearn_and_scipy_parity_when_reference_dependencies_installed():
    metrics = pytest.importorskip("sklearn.metrics")
    stats = pytest.importorskip("scipy.stats")
    generator = random.Random(42)
    for _ in range(100):
        labels = [1] + [generator.randrange(2) for _ in range(49)]
        scores = [generator.randrange(10) / 10 for _ in labels]
        other = [generator.randrange(10) / 10 for _ in labels]
        assert diagnostics.average_precision(labels, scores) == pytest.approx(metrics.average_precision_score(labels, scores), abs=1e-12)
        assert diagnostics.spearman(scores, other) == pytest.approx(stats.spearmanr(scores, other).statistic, abs=1e-12)


def test_zero_positive_groups_stay_in_pooled_rows_and_out_of_macro():
    guide_a, guide_b = "A" * 20 + "AGG", "C" * 20 + "TGG"
    pairs = [(guide_a, guide_a, 1), (guide_a, guide_b, 0), (guide_b, guide_b, 0)]
    result = diagnostics.summarize(pairs, {"k1": [0.9, 0.1, 1.0]}, {guide_a[:20]})
    full = result["partitions"]["full"]
    method = full["methods"]["k1"]
    assert full["rows"] == 3 and full["guides"] == 2 and full["zero_positive_guides"] == 1
    assert method["macro_average_precision"] == 1
    assert method["macro_evaluated_guides"] == 1 and method["macro_excluded_guides"] == 1
    assert method["pooled_average_precision"] == 0.5
    assert result["partitions"]["reported_training_guide_overlap"]["rows"] == 2
    assert result["partitions"]["reported_training_guide_disjoint"]["rows"] == 1


def test_entire_spacer_group_excluded_even_when_guide_pam_differs():
    guide = "A" * 20 + "AGG"
    result = diagnostics.summarize([(guide, guide, 1)], {"k1": [0.4]}, {guide[:20]})
    assert result["partitions"]["reported_training_guide_disjoint"]["rows"] == 0
    assert result["partitions"]["reported_training_guide_overlap"]["rows"] == 1


def test_missing_method_values_do_not_silently_change_pooled_scope():
    guide = "A" * 20 + "AGG"
    result = diagnostics.summarize([(guide, guide, 1), (guide, guide, 0)], {"cfd": [0.4, None]}, set())
    metric = result["partitions"]["full"]["methods"]["cfd"]
    assert metric["pooled_average_precision"] is None
    assert metric["pooled_reason"] == "incomplete_method_coverage"
    assert metric["unavailable_rows"] == 1
    assert metric["macro_evaluated_guides"] == 0


def load_report():
    path = ROOT / "docs/validation/web-diagnostics.json"
    if not path.exists():
        pytest.skip("Aggregate VM diagnostic report has not yet been generated.")
    return json.loads(path.read_text())


def test_saved_report_counts_roles_and_guide_fingerprints_match_provenance():
    report = load_report()
    diagnostics.validate_report(report)
    roles = json.loads((ROOT / "docs/science/dataset-roles.json").read_text())
    assert len(report["datasets"]) == 3
    for dataset in report["datasets"]:
        role = roles["datasets"][dataset["filename"]]
        assert dataset["sha256"] == role["sha256"]
        actual = {guide["guide_23nt_sha256"]: guide for guide in dataset["per_guide"]}
        assert len(actual) == len(role["guides"])
        for guide in role["guides"]:
            item = actual[guide["guide_23nt_sha256"]]
            assert item["rows"] == guide["rows"]
            assert item["positives"] == guide["positives"]
            assert item["reported_training_guide_overlap"] == guide["reported_training_corpus_overlap"]["exact_20nt_guide"]
    full_k562 = report["datasets"][0]["partitions"]
    assert full_k562["reported_training_guide_disjoint"]["rows"] == 33407
    assert full_k562["reported_training_guide_disjoint"]["positives"] == 180
    ipsc = report["datasets"][2]["partitions"]["full"]
    assert ipsc["guides"] == 3 and ipsc["zero_positive_guides"] == 1
    assert ipsc["methods"]["k1"]["macro_evaluated_guides"] == 2


def test_saved_artifact_provenance_and_no_sequence_or_candidate_exports():
    report = load_report()
    provenance = report["provenance"]
    for name, digest in provenance["source_sha256"].items():
        assert hashlib.sha256((ROOT / name).read_bytes()).hexdigest() == digest, name
    assert hashlib.sha256(SCRIPT.read_bytes()).hexdigest() == provenance["script_sha256"]
    assert hashlib.sha256((ROOT / "docs/science/dataset-roles.json").read_bytes()).hexdigest() == provenance["dataset_roles_sha256"]
    assert not re.search(r"[ACGTN]{20,}", json.dumps(report))
    assert report["uncertainty"]["confidence_intervals"] is None
    assert all(check["passed"] for check in report["reference_reproduction"])
    assert report["runtime"]["device"] == "cuda"


def test_saved_macro_matches_visible_guide_values():
    for dataset in load_report()["datasets"]:
        for partition, summary in dataset["partitions"].items():
            guides = [guide for guide in dataset["per_guide"] if partition == "full" or guide["reported_training_guide_overlap"] == (partition == "reported_training_guide_overlap")]
            for method, metric in summary["methods"].items():
                aps = [guide["methods"][method]["average_precision"] for guide in guides if guide["methods"][method]["average_precision"] is not None]
                assert metric["macro_evaluated_guides"] == len(aps)
                assert metric["macro_average_precision"] == pytest.approx(sum(aps) / len(aps)) if aps else metric["macro_average_precision"] is None


def test_inconsistent_report_rejected():
    report = copy.deepcopy(load_report())
    report["datasets"][0]["partitions"]["full"]["rows"] += 1
    with pytest.raises(ValueError, match="Partition rows"):
        diagnostics.validate_report(report)
