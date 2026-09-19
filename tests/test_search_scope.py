"""Check boundary cases and released aggregate consistency for the scope audit."""

import hashlib
import importlib.util
import json
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "docs/validation/audit_search_scope.py"
spec = importlib.util.spec_from_file_location("audit_search_scope", SCRIPT)
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)


def test_pam_bases_are_not_counted_as_protospacer_mismatches():
    rows = [("A" * 20 + "TGG", "A" * 20 + "AGG", 1),
            ("A" * 20 + "TGG", "A" * 20 + "TAG", 1)]
    report = audit.summarize(rows)
    assert report["hypothetical_sequence_filter_counts"]["NGG"]["0"] == {"rows": 1, "positive_rows": 1}
    assert report["hypothetical_sequence_filter_counts"]["NGG_or_NAG"]["0"] == {"rows": 2, "positive_rows": 2}


def test_unknown_bases_are_unresolved_even_when_equal_or_in_guide_pam():
    rows = [("N" + "A" * 19 + "TGG", "N" + "A" * 19 + "TGG", 1),
            ("A" * 20 + "NGG", "A" * 20 + "TGG", 0),
            ("A" * 20 + "TGG", "A" * 20 + "NGG", 1)]
    report = audit.summarize(rows)
    assert report["mutually_exclusive_current_scope_partition"]["unresolved_bases"] == {"rows": 3, "positive_rows": 2}
    assert report["hypothetical_sequence_filter_counts"]["any_unambiguous_PAM"]["20"]["rows"] == 0
    assert report["candidate_PAM_classes"]["unresolved"]["rows"] == 1


def test_four_five_boundary_other_pams_and_duplicate_rows_remain_explicit():
    guide = "A" * 20 + "TGG"
    rows = [(guide, "C" * 4 + "A" * 16 + "TGG", 1),
            (guide, "C" * 5 + "A" * 15 + "TGG", 1),
            (guide, "C" * 4 + "A" * 16 + "TGA", 0),
            (guide, "C" * 5 + "A" * 15 + "TAC", 1)]
    rows.append(rows[0])
    report = audit.summarize(rows)
    parts = report["mutually_exclusive_current_scope_partition"]
    assert parts["current_NGG_0_to_4"] == {"rows": 2, "positive_rows": 2}
    assert parts["NGG_more_than_4"] == {"rows": 1, "positive_rows": 1}
    assert parts["non_NGG_0_to_4"] == {"rows": 1, "positive_rows": 0}
    assert parts["non_NGG_more_than_4"] == {"rows": 1, "positive_rows": 1}
    assert sum(part["rows"] for part in parts.values()) == report["rows"] == 5
    assert guide not in json.dumps(report)


@pytest.mark.parametrize("target,site,label", [("A" * 22, "A" * 23, 1), ("A" * 23, "-" + "A" * 22, 1), ("A" * 23, "A" * 23, 2)])
def test_invalid_shape_or_label_is_rejected(target, site, label):
    with pytest.raises(ValueError):
        audit.summarize([(target, site, label)])


def test_released_aggregate_matches_audit_and_partition_conservation():
    report = json.loads((ROOT / "docs/validation/search-scope.json").read_text())
    prior_path = ROOT / "docs/nar-readiness/dataset-audit.json"
    prior = json.loads(prior_path.read_text())
    assert report["generator_sha256"] == hashlib.sha256(SCRIPT.read_bytes()).hexdigest()
    assert report["source_audit_sha256"] == hashlib.sha256(prior_path.read_bytes()).hexdigest()
    assert report["datasets"].keys() == prior["datasets"].keys()
    for name, data in report["datasets"].items():
        expected = prior["datasets"][name]
        assert data["sha256"] == expected["sha256"]
        assert data["rows"] == expected["rows"]
        assert data["positive_rows"] == expected["positives"]
        parts = data["mutually_exclusive_current_scope_partition"]
        assert sum(p["rows"] for p in parts.values()) == data["rows"]
        assert sum(p["positive_rows"] for p in parts.values()) == data["positive_rows"]
        assert parts["unresolved_bases"]["rows"] == 0
        assert parts["current_NGG_0_to_4"]["positive_rows"] == expected["positive_pairs_satisfying_NGG_and_at_most_4_protospacer_mismatches"]
        for scope in data["hypothetical_sequence_filter_counts"].values():
            previous = {"rows": 0, "positive_rows": 0}
            for limit in audit.THRESHOLDS:
                current = scope[str(limit)]
                assert 0 <= previous["positive_rows"] <= current["positive_rows"] <= current["rows"]
                assert previous["rows"] <= current["rows"]
                previous = current
