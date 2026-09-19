"""Synthetic spacer resolution, coordinate boundaries, and index integrity."""
import hashlib
import json
from pathlib import Path

import pytest

from offtargetpred.reference import ReferenceUnavailable, build_fasta_index, load_reference
from offtargetpred.resolver import resolve_guide
from offtargetpred.sequence import ValidationError

SPACER = "GACTACGATCGTAGCTACGT"


def reverse(sequence):
    return sequence.translate(str.maketrans("ACGT", "TGCA"))[::-1]


def prepare(tmp_path, contigs, *, width=13, newline=b"\n", trailing=True):
    path = tmp_path / "fixture.fa"
    data = b""
    for name, sequence in contigs.items():
        data += b">" + name.encode() + b" fixture" + newline
        data += newline.join(sequence[i:i + width].encode() for i in range(0, len(sequence), width)) + newline
    if not trailing:
        data = data[:-len(newline)]
    path.write_bytes(data)
    reference = {"assembly": "GRCh38", "verified": True, "filename": path.name,
                 "sha256": hashlib.sha256(data).hexdigest(), "contigs": len(contigs),
                 "total_bases": sum(len(value) for value in contigs.values()), "scope": "Synthetic test fixture"}
    build_fasta_index(path, reference)
    return path, reference


@pytest.fixture
def fixture(tmp_path):
    # Three exact spacers, two distinct actual PAMs, both strands, one non-NGG.
    sequence = "T" * 10 + SPACER + "AGG" + "T" * 17 + reverse(SPACER + "TGG") + "T" * 17 + SPACER + "CGG" + "T" * 17 + SPACER + "ATA" + "T" * 10
    return (*prepare(tmp_path, {"1": sequence, "MT": SPACER + "GGG", "KI270728.1": "A" * 40}), sequence)


def test_all_exact_matches_preserve_real_pam_and_orientation(fixture):
    path, reference, sequence = fixture
    result = resolve_guide(path, reference, SPACER.lower(), "chr1", 0, len(sequence))
    assert [(m["start"], m["end"], m["strand"], m["target23"]) for m in result["matches"]] == [
        (10, 33, "+", SPACER + "AGG"), (50, 73, "-", SPACER + "TGG"), (90, 113, "+", SPACER + "CGG")]
    assert [m["spacer_start"] for m in result["matches"]] == [10, 53, 90]
    assert result["reference_sha256"] == reference["sha256"]
    assert result["scope"]["chromosome"] == "1" and result["scope"]["complete"]
    assert result["selection_required"] is True
    for match in result["matches"]:
        genomic = sequence[match["start"]:match["end"]]
        assert match["target23"] == (genomic if match["strand"] == "+" else reverse(genomic))


@pytest.mark.parametrize("start,end,expected", [(10, 30, [(10, "+")]), (53, 73, [(50, "-")]),
    (11, 31, []), (9, 29, []), (52, 72, []), (54, 74, []), (10, 73, [(10, "+"), (50, "-")])])
def test_exact_locus_and_half_open_boundary(fixture, start, end, expected):
    path, reference, _ = fixture
    result = resolve_guide(path, reference, SPACER, "1", start, end)
    assert [(m["start"], m["strand"]) for m in result["matches"]] == expected
    assert result["scope"]["start"] == start and result["scope"]["end"] == end


def test_missing_pam_at_contig_edges_and_unknown_pam(tmp_path):
    sequence = SPACER + "NGG" + "TTTT" + SPACER
    path, reference = prepare(tmp_path, {"1": sequence})
    assert resolve_guide(path, reference, SPACER, "1", 0, len(sequence))["matches"] == []
    assert resolve_guide(path, reference, reverse(SPACER), "1", 0, 20)["matches"] == []


def test_no_match_is_complete_only_for_requested_interval(fixture):
    path, reference, _ = fixture
    result = resolve_guide(path, reference, "A" * 20, "1", 0, 33)
    assert result["matches"] == [] and result["scope"]["complete"]
    assert "Only the selected interval" in result["limitations"][0]


@pytest.mark.parametrize("spacer", ["A" * 19, "A" * 21, "A" * 19 + "U", "A" * 19 + "N", "A" * 10 + " " + "A" * 10, None])
def test_invalid_spacers_fail_before_reference_access(spacer):
    with pytest.raises(ValidationError, match="20 DNA bases"):
        resolve_guide("missing.fa", {}, spacer, "1", 0, 20)


@pytest.mark.parametrize("start,end", [(-1, 20), (1, 20), (0, 10001), (True, 21), (0, 20.0), ("0", 20)])
def test_invalid_interval(fixture, start, end):
    with pytest.raises(ValidationError):
        resolve_guide(fixture[0], fixture[1], SPACER, "1", start, end)


def test_aliases_are_explicit_and_unknown_contigs_fail(fixture):
    path, reference, sequence = fixture
    reader = load_reference(path, reference)
    assert reader.resolve_contig("chr1") == "1"
    assert reader.resolve_contig("chrM") == "MT"
    assert reader.resolve_contig("KI270728.1") == "KI270728.1"
    for name in ("chrKI270728.1", "M", "chrMT", "CHR1", "chr01", "unknown"):
        with pytest.raises(ValidationError, match="Chromosome"):
            resolve_guide(path, reference, SPACER, name, 0, 20)
    with pytest.raises(ValidationError, match="beyond"):
        resolve_guide(path, reference, SPACER, "1", 0, len(sequence) + 1)


@pytest.mark.parametrize("newline,trailing", [(b"\n", True), (b"\r\n", True), (b"\n", False), (b"\r\n", False)])
def test_index_fetch_across_lines_and_contigs(tmp_path, newline, trailing):
    contigs = {"1": "acgt" * 19 + "N", "chrM": "TCGA" * 7}
    path, reference = prepare(tmp_path, contigs, newline=newline, trailing=trailing)
    reader = load_reference(path, reference)
    assert reader is load_reference(path, reference)
    assert reader.resolve_contig("MT") == "chrM"
    for name, sequence in contigs.items():
        for start, end in ((0, 1), (0, len(sequence)), (12, 27), (len(sequence) - 1, len(sequence))):
            assert reader.fetch(name, start, end) == sequence[start:end].upper()
    with pytest.raises(ValueError):
        reader.fetch("1", 0, 30, max_bases=20)


@pytest.mark.parametrize("changes", [{"assembly": "GRCh37"}, {"verified": False}, {"sha256": "b" * 64},
    {"filename": "different.fa"}, {"contigs": 999}, {"total_bases": 1}])
def test_wrong_reference_fails_closed(fixture, changes):
    path, reference, _ = fixture
    with pytest.raises(ReferenceUnavailable):
        load_reference(path, {**reference, **changes})


@pytest.mark.parametrize("suffix", ["", ".fai", ".fai.json"])
def test_cached_reference_detects_modification(fixture, suffix):
    path, reference, _ = fixture
    reader = load_reference(path, reference)
    target = Path(str(path) + suffix)
    target.write_bytes(target.read_bytes()[:-5])
    with pytest.raises(ReferenceUnavailable):
        load_reference(path, reference)
    with pytest.raises(ReferenceUnavailable):
        reader.fetch("1", 10, 33)


def test_stale_index_and_missing_manifest(fixture):
    path, reference, _ = fixture
    reader = load_reference(path, reference)
    manifest_path = Path(str(path) + ".fai.json")
    manifest = json.loads(manifest_path.read_text())
    manifest["reference_sha256"] = "f" * 64
    manifest_path.write_text(json.dumps(manifest))
    with pytest.raises(ReferenceUnavailable, match="provenance"):
        load_reference(path, reference)
    manifest_path.unlink()
    with pytest.raises(ReferenceUnavailable, match="unavailable"):
        load_reference(path, reference)
    with pytest.raises(ReferenceUnavailable):
        reader.fetch("1", 10, 33)


@pytest.mark.parametrize("raw", [b">1\nAAA\nAA\nAAA\n", b">1\nACGT\n>1\nACGT\n", b">1\n", b"ACGT\n", b">1\nAC GT\n"])
def test_unsafe_fasta_cannot_be_indexed(tmp_path, raw):
    path = tmp_path / "fixture.fa"
    path.write_bytes(raw)
    reference = {"filename": path.name, "assembly": "GRCh38", "verified": True, "sha256": hashlib.sha256(raw).hexdigest()}
    with pytest.raises(ReferenceUnavailable):
        build_fasta_index(path, reference)
    assert not Path(str(path) + ".fai").exists()


def test_builder_never_overwrites_fixture(fixture):
    with pytest.raises(FileExistsError):
        build_fasta_index(fixture[0], fixture[1])


@pytest.mark.parametrize("column,delta", [(1, -1), (2, 1), (3, -1), (4, 1)])
def test_unsafe_index_geometry_even_with_recomputed_sidecar(fixture, column, delta):
    path, reference, _ = fixture
    index = Path(str(path) + ".fai")
    rows = index.read_text().splitlines()
    fields = rows[0].split("\t")
    fields[column] = str(int(fields[column]) + delta)
    rows[0] = "\t".join(fields)
    index.write_text("\n".join(rows) + "\n")
    manifest_path = Path(str(index) + ".json")
    manifest = json.loads(manifest_path.read_text())
    manifest["index_sha256"] = hashlib.sha256(index.read_bytes()).hexdigest()
    if column == 1:
        manifest["total_bases"] += delta
    manifest_path.write_text(json.dumps(manifest))
    with pytest.raises(ReferenceUnavailable):
        load_reference(path, reference)


def test_maximum_interval_returns_every_overlapping_match(tmp_path):
    path, reference = prepare(tmp_path, {"1": "G" * 10003}, width=60)
    result = resolve_guide(path, reference, "G" * 20, "1", 0, 10000)
    assert len(result["matches"]) == 9981
    assert result["matches"][-1]["end"] == 10003
