import pytest

from offtargetpred.input_metadata import normalize_input_metadata, USER_COORDINATES
from offtargetpred.sequence import parse_pairs, normalize_pairs, ValidationError


SEQ = "A" * 20 + "AGG"


def row(**changes):
    return {"target": SEQ, "off_target": SEQ, "assembly": "GRCh38", "chromosome": "chr1", "start": "100", "end": "123", "strand": "+", "coordinate_system": "0-based half-open", **changes}


def normalized(value):
    return normalize_input_metadata(normalize_pairs([value]))[0]


def test_csv_coordinates_are_numeric_and_canonicalized_without_claiming_verification():
    text = f"target,off_target,assembly,chromosome,start,end,strand,coordinate_system,source_id\n{SEQ},{SEQ},GRCh38,chr1,100,123,-,0-based half-open,duplicate\n"
    result = normalize_input_metadata(parse_pairs(text))[0]
    assert result["start"] == 100 and result["end"] == 123
    assert result["strand"] == "-" and result["off_target"] == SEQ
    assert result["chromosome"] == "1" and result["source_chromosome"] == "chr1"
    assert result["coordinate_verification"] == USER_COORDINATES
    assert result["source_id"] == "duplicate"


@pytest.mark.parametrize("chromosome, expected", [("chr22", "22"), ("chrX", "X"), ("chrY", "Y"), ("chrM", "MT"), ("MT", "MT"), ("KI270728.1", "KI270728.1"), ("chrUn_KI270442v1", "chrUn_KI270442v1")])
def test_only_known_aliases_are_changed(chromosome, expected):
    assert normalized(row(chromosome=chromosome))["chromosome"] == expected


def test_no_coordinates_is_valid_and_reserved_outputs_are_removed():
    result = normalized({"target": SEQ, "off_target": SEQ, "condition": "drug-free", "scores": {"k1": 1}, "baselines": {"cfd": 1}, "user_selected_locus": "true", "annotations": {"status": "annotated"}, "evidence": "positive", "coordinate_verification": "verified", "reference_sha256": "forged"})
    assert result["condition"] == "drug-free"
    assert result["exact_match"] is True
    for key in ("scores", "baselines", "user_selected_locus", "annotations", "evidence", "coordinate_verification", "reference_sha256"):
        assert key not in result


def test_empty_csv_metadata_is_absent():
    result = normalized({"target": SEQ, "off_target": SEQ, **{key: "" for key in ("assembly", "chromosome", "start", "end", "strand", "coordinate_system")}})
    assert "chromosome" not in result


@pytest.mark.parametrize("field", ["assembly", "chromosome", "start", "end", "strand", "coordinate_system"])
def test_partial_metadata_is_rejected(field):
    value = row()
    del value[field]
    with pytest.raises(ValidationError, match="incomplete locus metadata"):
        normalized(value)


@pytest.mark.parametrize("changes, message", [
    ({"assembly": "hg19"}, "GRCh38"),
    ({"coordinate_system": "1-based inclusive"}, "convert 1-based"),
    ({"coordinate_system": []}, "convert 1-based"),
    ({"start": True}, "integer"),
    ({"start": 100.0}, "integer"),
    ({"start": "1e2"}, "integer"),
    ({"start": -1}, "range"),
    ({"end": 2**53}, "range"),
    ({"end": "120"}, "23 bases"),
    ({"end": "99"}, "23 bases"),
    ({"strand": "16"}, "strand"),
    ({"chromosome": "chr1:100-123"}, "plain contig"),
    ({"chromosome": "../chr1"}, "plain contig"),
    ({"position": "99"}, "conflicts"),
])
def test_invalid_coordinates_raise_actionable_error(changes, message):
    with pytest.raises(ValidationError, match=message):
        normalized(row(**changes))


def test_repeated_rows_have_separate_stable_indices():
    result = normalize_input_metadata(normalize_pairs([row(id="duplicate"), row(id="duplicate")]))
    assert [value["id"] for value in result] == ["duplicate", "duplicate"]
    assert [value["row_index"] for value in result] == [1, 2]


def test_input_is_not_mutated_and_case_variants_cannot_promote_claims():
    value = normalize_pairs([row(Scores="forged", coordinate_verification="verified")])[0]
    result = normalize_input_metadata([value])[0]
    assert "Scores" not in result
    assert value["coordinate_verification"] == "verified"
    assert result["coordinate_verification"] == USER_COORDINATES
