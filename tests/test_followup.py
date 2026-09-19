"""Selected reference-flank preparation: verified orientation and complete reporting."""
import hashlib
import json
import os
from pathlib import Path

import pytest

from offtargetpred.followup import reference_context
from offtargetpred.reference import ReferenceUnavailable, build_fasta_index, load_reference
from offtargetpred.sequence import ValidationError

TARGET = "GACTACGATCGTAGCTACGTAGG"


def reverse(sequence):
    return sequence.translate(str.maketrans("ACGT", "TGCA"))[::-1]


def prepare(tmp_path, sequence):
    tmp_path.mkdir(parents=True, exist_ok=True)
    path = tmp_path / "fixture.fa"
    path.write_text(">1\n" + "\n".join(sequence[i:i + 13] for i in range(0, len(sequence), 13)) + "\n")
    metadata = {"assembly": "GRCh38", "verified": True, "filename": path.name,
                "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}
    build_fasta_index(path, metadata)
    return path, metadata


def candidate(start=10, strand="+", **changes):
    return {"id": "chosen candidate", "row_index": 7, "off_target": TARGET, "chromosome": "chr1",
            "start": start, "end": start + 23, "strand": strand, "assembly": "GRCh38",
            "coordinate_system": "0-based half-open", **changes}


def test_both_strands_keep_forward_reference_flanks_and_target_offsets(tmp_path):
    sequence = "A" * 10 + TARGET + "T" * 27 + reverse(TARGET) + "G" * 10
    path, metadata = prepare(tmp_path, sequence)
    records = [candidate(), candidate(60, "-", id="other", row_index=8)]
    document = reference_context(path, metadata, records, 5)
    assert document["complete"] and document["summary"] == {"selected": 2, "ready": 2, "skipped": 0}
    assert records[0]["chromosome"] == "chr1"  # caller data is never mutated
    for index, entry in enumerate(document["records"]):
        start = records[index]["start"]
        context = entry["context"]
        assert context["sequence"] == sequence[start - 5:start + 28]
        assert (context["target_start_offset"], context["target_end_offset"]) == (5, 28)
        assert context["sequence_sha256"] == hashlib.sha256(context["sequence"].encode()).hexdigest()
        assert context["left_clipped"] is False and context["right_clipped"] is False
        assert entry["candidate"]["chromosome"] == "1" and entry["candidate"]["requested_chromosome"] == "chr1"
    assert "candidate_strand=- orientation=forward_reference coordinates=0_based_half_open" in document["fasta"]
    assert "chosen candidate" not in document["fasta"]
    assert document["fasta_sha256"] == hashlib.sha256(document["fasta"].encode()).hexdigest()


def test_contig_boundary_clipping_zero_flank_and_ambiguous_context(tmp_path):
    sequence = TARGET + "NNRY" + reverse(TARGET)
    path, metadata = prepare(tmp_path, sequence)
    document = reference_context(path, metadata, [candidate(0), candidate(27, "-")], 1000)
    for entry in document["records"]:
        context = entry["context"]
        assert context["sequence"] == sequence
        assert context["left_clipped"] and context["right_clipped"]
        assert context["ambiguous_bases"] == 4
    zero = reference_context(path, metadata, [candidate(0)], 0)["records"][0]["context"]
    assert zero["sequence"] == TARGET and not zero["left_clipped"] and not zero["right_clipped"]


def test_duplicate_selections_and_all_skip_reasons_are_preserved(tmp_path):
    path, metadata = prepare(tmp_path, "A" * 10 + TARGET + "T" * 10)
    records = [candidate(), candidate(), candidate(off_target="T" * 23), candidate(chromosome="unknown"),
               candidate(start=50, end=73), candidate(assembly=None), candidate(coordinate_system="1-based inclusive"),
               candidate(strand=None), candidate(start=-1, end=22), candidate(off_target="N" * 23)]
    document = reference_context(path, metadata, records, 10)
    assert document["summary"] == {"selected": 10, "ready": 2, "skipped": 8}
    assert [entry["selection_index"] for entry in document["records"]] == list(range(10))
    assert [entry["reason_code"] for entry in document["records"][2:]] == [
        "reference_sequence_mismatch", "unknown_contig", "out_of_bounds", "unsupported_assembly",
        "unsupported_coordinates", "missing_coordinates", "invalid_locus", "invalid_candidate_sequence"]
    assert document["records"][0]["fasta_id"] != document["records"][1]["fasta_id"]
    assert document["records"][2]["candidate"]["off_target"] == "T" * 23


def test_wrong_strand_and_ambiguous_candidate_reference_cannot_pass(tmp_path):
    path, metadata = prepare(tmp_path, "A" * 10 + TARGET + "T" * 10)
    assert reference_context(path, metadata, [candidate(strand="-")])["records"][0]["status"] == "skipped"
    path2, metadata2 = prepare(tmp_path / "other", "A" * 10 + "N" + TARGET[1:])
    assert reference_context(path2, metadata2, [candidate()])["records"][0]["reason_code"] == "reference_sequence_mismatch"


@pytest.mark.parametrize("flank", [-1, 1001, True, "250", 1.5, None])
def test_invalid_flank_rejected_before_reference_access(flank):
    with pytest.raises(ValidationError):
        reference_context("missing.fa", {}, [candidate()], flank)


@pytest.mark.parametrize("records", [[], [candidate()] * 21, {}, [None], [candidate(token="private")],
                                      [candidate(start=True)], [candidate(end=2**60)], [candidate(row_index=-1)],
                                      [candidate(id="x" * 201)], [candidate(id="header\n>injection")],
                                      [candidate(off_target=[])], [candidate(id="")]])
def test_structural_bounds_rejected_before_reference_access(records):
    with pytest.raises(ValidationError):
        reference_context("missing.fa", {}, records)


def test_reference_integrity_failure_is_not_reported_as_a_skipped_row(tmp_path):
    path, metadata = prepare(tmp_path, "A" * 10 + TARGET)
    with pytest.raises(ReferenceUnavailable):
        reference_context(path, {**metadata, "sha256": "a" * 64}, [candidate()])


def test_actual_public_reference_plus_minus_and_contig_boundary():
    path = os.environ.get("OFFTARGET_DEMO_REFERENCE")
    if not path:
        pytest.skip("Opt-in actual FASTA verification runs on the de.NBI VM.")
    root = Path(__file__).resolve().parents[1]
    manifest = json.loads((root / "frontend/public/demonstrations/manifest.json").read_text())
    case = next(case for case in manifest["scenarios"] if case["id"] == "reference-walkthrough")
    demo = json.loads((root / "frontend/public/demonstrations" / case["document_filename"]).read_text())
    metadata = demo["metadata"]["reference"]
    selected = []
    for strand in ("+", "-"):
        row = next(row for row in demo["rows"] if row["strand"] == strand)
        selected.append({key: row[key] for key in candidate() if key in row})
        selected[-1]["id"] = str(row["id"])
    reference = load_reference(path, metadata)
    # Select the first unambiguous 23-mer near the short public contig's end;
    # flanks clip to its true boundary rather than inventing sequence padding.
    contig, length = min(reference.contigs.items(), key=lambda item: item[1])
    sequence = reference.fetch(contig, max(0, length - 500), length)
    offset = next(index for index in range(len(sequence) - 23, -1, -1)
                  if set(sequence[index:index + 23]) <= set("ACGT"))
    start = max(0, length - 500) + offset
    selected.append(candidate(start, chromosome=contig, off_target=sequence[offset:offset + 23], id="public-boundary"))
    document = reference_context(path, metadata, selected, 1000)
    assert document["summary"] == {"selected": 3, "ready": 3, "skipped": 0}
    assert document["records"][2]["context"]["right_clipped"]
    for entry in document["records"]:
        context, site = entry["context"], entry["candidate"]
        assert context["sequence"] == reference.fetch(site["chromosome"], context["start"], context["end"])
