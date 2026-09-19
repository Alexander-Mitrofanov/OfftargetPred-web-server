"""Check frozen public examples, complete scope, honest empty states and privacy."""

import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]
DIRECTORY = ROOT / "frontend/public/demonstrations"
GENERATOR = ROOT / "scripts/generate_demonstrations.py"
spec = importlib.util.spec_from_file_location("generate_demonstrations", GENERATOR)
generator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(generator)


def manifest():
    return json.loads((DIRECTORY / "manifest.json").read_text())


def document(case):
    return json.loads((DIRECTORY / case["document_filename"]).read_text())


def test_manifest_has_four_distinct_reviewable_scenarios_and_real_document_hashes():
    value = manifest()
    assert value["schema_version"] == 1
    assert value["generator_sha256"] == hashlib.sha256(GENERATOR.read_bytes()).hexdigest()
    assert value["staging_jobs_created_and_deleted"] == 2
    assert {case["id"] for case in value["scenarios"]} == {"reference-walkthrough", "multiple-exact-matches", "no-hits", "missing-pam"}
    for case in value["scenarios"]:
        assert case["tasks"] and case["expected_observations"] and case["provenance"]["sequence_origin"]
        assert case["input"]["models"] == [1, 2, 3]
        if case["kind"] == "result":
            path = DIRECTORY / case["document_filename"]
            assert path.name == case["document_filename"]
            assert hashlib.sha256(path.read_bytes()).hexdigest() == case["document_sha256"]
            frozen = document(case)
            generator.validate_document(frozen, case["input"]["input"], case["input"]["max_mismatches"])
            assert case["completed_job"]["status"] == "completed"
            assert case["completed_job"]["id"] == "demonstration-" + case["id"]
            assert case["completed_job"]["result_count"] == len(frozen["rows"]) == case["provenance"]["candidate_count"]
            assert frozen["metadata"]["demonstration"]["complete_result"] is True


def test_normal_case_preserves_one_explicitly_selected_locus_and_all_other_matches():
    case = next(case for case in manifest()["scenarios"] if case["id"] == "reference-walkthrough")
    rows = document(case)["rows"]
    assert len(rows) == 15
    selected = [row for row in rows if row.get("user_selected_locus")]
    assert len(selected) == 1
    assert (selected[0]["chromosome"], selected[0]["start"], selected[0]["end"], selected[0]["strand"]) == ("1", 100056, 100079, "+")
    assert sum(row["exact_match"] for row in rows) == 5
    assert sum(row["mismatches"] == 1 for row in rows) == 2


def test_multiple_exact_matches_distinguish_pam_and_spacer_without_selecting_a_locus():
    case = next(case for case in manifest()["scenarios"] if case["id"] == "multiple-exact-matches")
    rows = document(case)["rows"]
    assert len(rows) == 13
    assert all(row["mismatches"] == 0 and row["protospacer_match"] for row in rows)
    assert sum(row["exact_match"] for row in rows) == 5
    assert {row["strand"] for row in rows} == {"+", "-"}
    assert not any(row.get("user_selected_locus") for row in rows)
    assert not case["input"].get("intended_loci")


def test_empty_case_is_successful_complete_search_and_retains_the_synthetic_guide():
    case = next(case for case in manifest()["scenarios"] if case["id"] == "no-hits")
    frozen = document(case)
    assert frozen["rows"] == []
    assert case["completed_job"]["status"] == "completed"
    assert frozen["metadata"]["candidate_count"] == 0
    assert frozen["metadata"]["submitted_guides"][0]["target"] == generator.SYNTHETIC_GUIDE
    assert "synthetic" in case["provenance"]["sequence_origin"].lower()
    assert case["input"]["max_mismatches"] == 1


def test_invalid_input_preserves_observed_error_without_fabricated_results():
    case = next(case for case in manifest()["scenarios"] if case["id"] == "missing-pam")
    assert case["kind"] == "validation"
    assert case["document_filename"] is None and case["document_sha256"] is None and case["completed_job"] is None
    assert len(case["input"]["input"]) == 20
    assert case["expected_error"]["http_status"] == 422
    assert "23" in str(case["expected_error"]["detail"])


def test_models_and_cfd_identical_to_pinned_deployment_artifacts():
    models = json.loads((ROOT / "models.manifest.json").read_text())["models"]
    from offtargetpred.cfd import CFD_VERSION, score_cfd
    for case in manifest()["scenarios"]:
        if case["kind"] != "result":
            continue
        frozen = document(case)
        assert {model["id"]: model["sha256"] for model in frozen["metadata"]["models"]["models"]} == {key: model["sha256"] for key, model in models.items()}
        assert case["provenance"]["cfd_version"] == CFD_VERSION
        for row in frozen["rows"]:
            assert row["baselines"]["cfd"]["score"] == pytest.approx(score_cfd(row["target"], row["off_target"])["score"])


def test_no_live_credentials_private_assay_references_or_expiring_job_links():
    forbidden_keys = {"token", "access_token", "authorization", "expires_at", "job_id", "session_id"}

    def inspect(value):
        if isinstance(value, dict):
            assert not forbidden_keys.intersection(key.lower() for key in value)
            for child in value.values():
                inspect(child)
        elif isinstance(value, list):
            for child in value:
                inspect(child)
        elif isinstance(value, str):
            assert "Model/crispert_share/data" not in value
            assert "#job=" not in value and "Bearer " not in value

    for path in DIRECTORY.glob("*.json"):
        inspect(json.loads(path.read_text()))


@pytest.mark.parametrize("origin", ["https://offtargetpred-web.tail58d78e.ts.net", "http://127.0.0.1:8010", "http://example.org:8020"])
def test_generator_rejects_live_and_remote_service_targets(origin):
    with pytest.raises(ValueError, match="isolated localhost"):
        generator.StagingClient(origin)


def test_truncated_or_incomplete_examples_rejected():
    case = next(case for case in manifest()["scenarios"] if case["id"] == "reference-walkthrough")
    frozen = document(case)
    invalid = copy.deepcopy(frozen)
    invalid["rows"].pop()
    with pytest.raises(ValueError, match="every candidate"):
        generator.validate_document(invalid, generator.PUBLIC_GUIDE, 1)
    invalid = copy.deepcopy(frozen)
    invalid["metadata"]["candidate_scope"] = "Partial results"
    with pytest.raises(ValueError, match="completed, untruncated"):
        generator.validate_document(invalid, generator.PUBLIC_GUIDE, 1)


def test_actual_oriented_sequence_at_each_frozen_locus_when_vm_reference_requested():
    path = os.environ.get("OFFTARGET_DEMO_REFERENCE")
    if not path:
        pytest.skip("Direct reference check is opt-in on the VM; no local genome is required.")
    from offtargetpred.reference import load_reference
    value = manifest()
    normal = document(value["scenarios"][0])
    reference = load_reference(Path(path), normal["metadata"]["reference"])
    checked = set()
    for case in value["scenarios"]:
        if case["kind"] != "result":
            continue
        for row in document(case)["rows"]:
            key = row["chromosome"], row["start"], row["end"], row["strand"], row["off_target"]
            if key in checked:
                continue
            sequence = reference.fetch(row["chromosome"], row["start"], row["end"])
            if row["strand"] == "-":
                sequence = sequence.translate(str.maketrans("ACGTN", "TGCAN"))[::-1]
            assert sequence == row["off_target"]
            checked.add(key)
    assert len(checked) == 15
