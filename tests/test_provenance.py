"""Scientific evidence consistency checks, with no inference or raw-data exports."""

import hashlib
import importlib.util
import json
import re
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]
SCIENCE = ROOT / "docs/science"


def read(path):
    return json.loads((ROOT / path).read_text())


def test_claim_evidence_references_and_available_source_hashes():
    ledger = read("docs/science/provenance-ledger.json")
    assert len({claim["id"] for claim in ledger["claims"]}) == len(ledger["claims"])
    for claim in ledger["claims"]:
        assert claim["status"] in ledger["status_definitions"]
        assert claim["allowed_wording"]
        assert set(claim["evidence"]) <= ledger["sources"].keys()
    for source in ledger["sources"].values():
        path = ROOT / source["path"]
        assert re.fullmatch(r"[0-9a-f]{64}", source["sha256"])
        if source["availability"] == "private_supplied_bundle" and not path.exists():
            continue
        assert path.is_file(), source["path"]
        assert hashlib.sha256(path.read_bytes()).hexdigest() == source["sha256"], source["path"]


def test_every_guide_has_evidence_limited_role_and_matches_aggregate_counts():
    roles = read("docs/science/dataset-roles.json")
    audit = read("docs/nar-readiness/dataset-audit.json")
    assert roles["datasets"].keys() == audit["datasets"].keys()
    assert hashlib.sha256((ROOT / roles["aggregate_audit"]["path"]).read_bytes()).hexdigest() == roles["aggregate_audit"]["sha256"]
    for name, dataset in roles["datasets"].items():
        summary = audit["datasets"][name]
        guides = dataset["guides"]
        assert dataset["sha256"] == summary["sha256"]
        assert len(guides) == len({guide["guide_23nt_sha256"] for guide in guides}) == summary["guides_23nt"]
        assert len({guide["split_group_20nt_sha256"] for guide in guides}) == summary["guides_20nt"]
        assert sum(guide["rows"] for guide in guides) == summary["rows"]
        assert sum(guide["label_zero_rows"] for guide in guides) == summary["negatives"]
        assert sorted(guide["positives"] for guide in guides) == summary["positive_counts_per_guide_sorted"]
        assert all(value is None for value in dataset["unresolved_provenance"].values())
        expected_role = "reported_training_corpus" if name == audit["reported_training_corpus"] else "supplied_cross_cell_evaluation"
        assert dataset["reported_role"] == expected_role
        for guide in guides:
            assert guide["reported_role"] == expected_role
            assert guide["rows"] == guide["positives"] + guide["label_zero_rows"]
            assert guide["both_label_classes_present"] == (0 < guide["positives"] < guide["rows"])
            for field in ("actual_gradient_training_membership", "actual_validation_membership", "model_selection_use"):
                assert guide[field] == "unknown"


def test_shared_guide_fingerprints_join_across_datasets_and_match_audit():
    roles = read("docs/science/dataset-roles.json")["datasets"]
    audit = read("docs/nar-readiness/dataset-audit.json")
    groups = {
        name: {guide["split_group_20nt_sha256"] for guide in dataset["guides"]}
        for name, dataset in roles.items()
    }
    for key, overlap in audit["pairwise_overlap"].items():
        left, right = key.split(" | ")
        assert len(groups[left] & groups[right]) == overlap["exact_20nt_guides"]
    train = audit["reported_training_corpus"]
    for name, dataset in roles.items():
        for guide in dataset["guides"]:
            fingerprint = guide["split_group_20nt_sha256"]
            assert guide["present_in_datasets_by_20nt_guide"] == sorted(other for other, values in groups.items() if fingerprint in values)
            assert guide["reported_training_corpus_overlap"]["exact_20nt_guide"] == (fingerprint in groups[train])
        if name != train:
            left, right = sorted((name, train))
            assert sum(guide["reported_training_corpus_overlap"]["exact_sequence_pairs"] for guide in dataset["guides"]) == audit["pairwise_overlap"][f"{left} | {right}"]["exact_sequence_pairs"]


def test_provenance_does_not_upgrade_reproduction_or_seed_to_independence():
    ledger = read("docs/science/provenance-ledger.json")
    claims = {claim["id"]: claim for claim in ledger["claims"]}
    assert claims["full_k562_guide_independence"]["status"] == "not_supported"
    for key in ("actual_run_seed", "original_training_file_equivalence", "other_supplied_evaluation_independence", "redistribution_rights"):
        assert claims[key]["status"] == "unresolved"
    benchmark = read("docs/validation/model-benchmark.json")
    observed = claims["full_k562_reference_reproduction"]["observed"]
    assert observed["rows"] == benchmark["rows"]
    for name, model in benchmark["models"].items():
        assert observed["macro_average_precision"][name] == model["macro_auprc"]
        assert observed["pooled_average_precision"][name] == model["pooled_auprc"]
    subset = ledger["benchmark_conditions"]["full_k562_reported_corpus_disjoint_subset"]
    roles = read("docs/science/dataset-roles.json")["datasets"]["k562_dataset_invivo_full.csv"]
    disjoint = [guide for guide in roles["guides"] if not guide["reported_training_corpus_overlap"]["exact_20nt_guide"]]
    assert subset["guides"] == len(disjoint)
    assert subset["rows"] == sum(guide["rows"] for guide in disjoint)
    assert subset["positives"] == sum(guide["positives"] for guide in disjoint)
    assert subset["independent_test_status"] == "unverified"


def test_checkpoint_metadata_matches_artifact_identity_without_inventing_missing_fields():
    manifest = read("models.manifest.json")
    metadata = read("docs/science/checkpoint-metadata.json")
    assert metadata["models"].keys() == manifest["models"].keys()
    for name, model in metadata["models"].items():
        assert model["sha256"] == manifest["models"][name]["sha256"]
        assert model["saved_config"]["kmer"] == manifest["models"][name]["kmer"]
        assert model["saved_config"]["seed"] == 42
        assert model["saved_config"]["ft_val_split"] == 0.2
        assert model["independently_verified_run_seed"] is None
        assert not model["row_level_split_manifest_available"]
        assert not set(model["absent_config_fields"]) & model["saved_config"].keys()


def test_public_records_do_not_contain_raw_sequence_rows():
    for path in SCIENCE.glob("*.json"):
        content = path.read_text()
        assert not re.search(r"\b[ACGTN]{20,}\b", content), path.name
        assert '"off_target":' not in content, path.name
        assert '"target":' not in content, path.name


def test_guide_role_manifest_reproduces_from_private_bundle_when_available():
    roles = read("docs/science/dataset-roles.json")
    if not all((ROOT / dataset["path"]).is_file() for dataset in roles["datasets"].values()):
        pytest.skip("Private supplied CSV bundle is not distributed with this repository")
    spec = importlib.util.spec_from_file_location("build_dataset_roles", SCIENCE / "build_dataset_roles.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    assert module.build_manifest() == roles
