"""Parity with independently executed Doench code, plus input/provenance safety."""

import hashlib
import json
from importlib.resources import files
from itertools import product

import pytest

from offtargetpred import cfd
from offtargetpred.cfd import CFD_VERSION, cfd_metadata, score_cfd


RESOURCES = files("offtargetpred").joinpath("resources", "cfd")
REFERENCE = json.loads(RESOURCES.joinpath("reference_vectors.json").read_text())
GUIDE = "ATCGATGCTGATGCTAGATAAGG"


@pytest.mark.parametrize("vector", REFERENCE["vectors"], ids=lambda v: v["id"])
def test_independent_doench_reference_parity(vector):
    result = score_cfd(vector["guide23"], vector["candidate23"])
    assert result["score"] == pytest.approx(vector["expected"], abs=1e-12, rel=0)
    assert result["version"] == CFD_VERSION
    assert "reason" not in result


def test_reference_fixture_covers_every_mismatch_type_position_and_pam():
    ids = {vector["id"] for vector in REFERENCE["vectors"]}
    assert len(ids) == len(REFERENCE["vectors"]) == 280
    assert {f"mismatch-{a}-{b}-{pos}" for a, b in product("ACGT", repeat=2)
            if a != b for pos in range(1, 21)} <= ids
    assert {f"pam-{a}{b}" for a, b in product("ACGT", repeat=2)} <= ids


def test_strand_fixture_receives_already_oriented_inputs():
    loci = [v for v in REFERENCE["vectors"] if "strand" in v]
    assert {v["strand"] for v in loci} == {"+", "-"}
    for vector in loci:
        forward = vector["genomic_forward_sequence"]
        oriented = forward if vector["strand"] == "+" else forward.translate(str.maketrans("ACGT", "TGCA"))[::-1]
        assert oriented == vector["candidate23"]
        assert score_cfd(vector["guide23"], oriented)["score"] == pytest.approx(0.857142857)
    assert loci[0]["genomic_forward_sequence"] != loci[1]["genomic_forward_sequence"]


def test_t_to_rna_u_and_position_direction_have_distinct_expected_factors():
    # rU:dG is guide DNA T versus candidate DNA C, not T versus G.
    assert score_cfd("T" * 20 + "AGG", "C" + "T" * 19 + "AGG")["score"] == pytest.approx(0.857142857)
    assert score_cfd("T" * 20 + "AGG", "T" * 19 + "CAGG")["score"] == pytest.approx(0.090909091)


def test_exact_noncanonical_pam_has_pam_weight_and_zero_stays_numeric():
    assert score_cfd(GUIDE, GUIDE)["score"] == 1.0
    assert score_cfd(GUIDE, GUIDE[:20] + "AAG")["score"] == pytest.approx(0.259259259)
    assert score_cfd(GUIDE, GUIDE[:20] + "AAA")["score"] == 0.0
    assert "reason" not in score_cfd(GUIDE, GUIDE[:20] + "AAA")


def test_case_and_outer_whitespace_normalize_without_changing_score():
    assert score_cfd("  " + GUIDE.lower() + "\n", GUIDE.lower()) == score_cfd(GUIDE, GUIDE)


@pytest.mark.parametrize("bad,reason", [
    (None, "string"),
    (123, "string"),
    (b"A" * 23, "string"),
    ("", "exactly 23"),
    ("A" * 20, "exactly 23"),
    ("A" * 24, "exactly 23"),
    ("N" + GUIDE[1:], "contains N"),
    (GUIDE[:20] + "NGG", "contains N"),
    (GUIDE[:20] + "AGN", "contains N"),
    ("-" + GUIDE[1:], "gap"),
    (GUIDE[:5] + "-" + GUIDE[5:], "gap"),
    ("." + GUIDE[1:], "gap"),
    ("U" + GUIDE[1:], "RNA U"),
    ("R" + GUIDE[1:], "unsupported bases"),
    (GUIDE[:10] + " " + GUIDE[11:], "unsupported bases"),
])
@pytest.mark.parametrize("bad_field", ["guide", "candidate"])
def test_unsupported_sequence_has_null_score_with_explanation(bad, reason, bad_field):
    guide, site = (bad, GUIDE) if bad_field == "guide" else (GUIDE, bad)
    result = score_cfd(guide, site)
    assert result["score"] is None
    assert reason in result["reason"]
    assert result["reason"].startswith(bad_field.capitalize())
    assert result["version"] == CFD_VERSION
    json.dumps(result, allow_nan=False)


@pytest.mark.parametrize("failure", ["missing", "corrupt"])
def test_missing_or_modified_parameters_disable_scoring(tmp_path, monkeypatch, failure):
    resource_dir = tmp_path / "resources" / "cfd"
    resource_dir.mkdir(parents=True)
    if failure == "corrupt":
        (resource_dir / "cfd.mm.scores.cas9.txt").write_text("AC1 0.5\n")
    cfd._parameters.cache_clear()
    monkeypatch.setattr(cfd, "files", lambda package: tmp_path)
    try:
        result = score_cfd(GUIDE, GUIDE)
        assert result["score"] is None
        assert "integrity" in result["reason"]
        assert cfd_metadata()["available"] is False
        # Invalid sequences retain their specific input reason.
        assert "contains N" in score_cfd("N" + GUIDE[1:], GUIDE)["reason"]
    finally:
        cfd._parameters.cache_clear()


def test_metadata_is_serializable_and_tracks_bundled_parameter_bytes():
    metadata = cfd_metadata()
    assert metadata["available"] is True
    assert metadata["score_scope"] == "per-site"
    assert metadata["calibrated_probability"] is False
    assert metadata["version"] == CFD_VERSION
    assert metadata["parameter_commit"] == "595d9a8ad1f4ba95ee2dca20786921f89be3004c"
    assert metadata["parameter_license"].startswith("MIT")
    for artifact in metadata["parameter_files"]:
        assert hashlib.sha256(RESOURCES.joinpath(artifact["filename"]).read_bytes()).hexdigest() == artifact["sha256"]
    assert "Genentech" in RESOURCES.joinpath("LICENSE.crisprScore.txt").read_text()
    json.dumps(metadata, allow_nan=False)
