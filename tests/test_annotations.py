"""Coordinate, provenance and bounded full-result annotation contracts."""
from copy import deepcopy
import gzip
import json

import pytest

from offtargetpred.annotations import (AnnotationIndex, AnnotationUnavailable, annotate_rows,
                                     build_annotation_index, file_sha256, read_reference_contigs)


def gtf_line(feature, start, end, *, gene="G1", transcript="T1", strand="+", chromosome="1"):
    attributes = f'gene_id "{gene}"; gene_name "Gene {gene}";'
    if feature != "gene":
        attributes += f' transcript_id "{transcript}";'
    return f"{chromosome}\ttest\t{feature}\t{start + 1}\t{end}\t.\t{strand}\t.\t{attributes}\n"


@pytest.fixture
def prepared(tmp_path):
    archive, index = tmp_path / "fixture.gtf.gz", tmp_path / "annotations.sqlite"
    text = "#!genome-build GRCh38.p14\n" + "".join([
        gtf_line("gene", 100, 500),
        gtf_line("transcript", 100, 400),
        gtf_line("exon", 100, 160), gtf_line("CDS", 120, 150),
        gtf_line("five_prime_utr", 100, 120),
        gtf_line("exon", 300, 400), gtf_line("CDS", 300, 350),
        gtf_line("three_prime_utr", 350, 400),
        gtf_line("transcript", 100, 500, transcript="T2"),
        gtf_line("exon", 100, 130, transcript="T2"),
        gtf_line("exon", 140, 220, transcript="T2"),
        gtf_line("exon", 450, 500, transcript="T2"),
        gtf_line("gene", 110, 300, gene="G2", strand="-"),
        gtf_line("transcript", 110, 300, gene="G2", transcript="T3", strand="-"),
        gtf_line("exon", 110, 170, gene="G2", transcript="T3", strand="-"),
        gtf_line("CDS", 135, 160, gene="G2", transcript="T3", strand="-"),
        gtf_line("exon", 230, 300, gene="G2", transcript="T3", strand="-"),
        gtf_line("three_prime_utr", 110, 135, gene="G2", transcript="T3", strand="-"),
        gtf_line("five_prime_utr", 270, 300, gene="G2", transcript="T3", strand="-"),
        gtf_line("gene", 1, 40, chromosome="ALT"),
    ])
    with gzip.open(archive, "wt") as stream:
        stream.write(text)
    reference = {"assembly": "GRCh38", "verified": True, "sha256": "a" * 64, "contigs": 2}
    manifest = build_annotation_index(archive, index, reference=reference, contig_lengths={"1": 100_000, "MT": 1000},
                                      expected_sha256=file_sha256(archive))
    return index, reference, manifest


def candidate(start, **values):
    return {"id": f"r{start}", "row_index": start, "chromosome": "1", "start": start, "end": start + 23,
            "strand": "+", "assembly": "GRCh38", "coordinate_system": "0-based half-open",
            "scores": {"k1": 0.123456}, **values}


def test_boundary_half_open_and_pam_overlap(prepared):
    with AnnotationIndex(prepared[0], prepared[1]) as index:
        before = index.annotate_row(candidate(77))  # [77, 100): touches, does not overlap
        assert before["categories"] == ["intergenic"]
        includes_pam = index.annotate_row(candidate(78))  # Only final PAM base overlaps
        assert "exon" in includes_pam["categories"]
        assert includes_pam["interval"] == {"start": 78, "end": 101, "length": 23, "includes_pam": True}
        assert index.annotate_row(candidate(500))["categories"] == ["intergenic"]
        assert index.annotate_row(candidate(477))["categories"] == ["exon"]


def test_both_strands_and_transcript_ambiguity(prepared):
    with AnnotationIndex(prepared[0]) as index:
        plus, minus = [index.annotate_row(candidate(180, strand=s)) for s in ("+", "-")]
        assert plus == minus
        assert plus["categories"] == ["exon", "intron"]
        assert plus["transcript_count"] == 3 and plus["ambiguous_transcripts"]
        assert {(f["transcript_id"], f["feature"], f["strand"]) for f in plus["features"] if f["feature"] in {"exon", "intron"}} == {
            ("T1", "intron", "+"), ("T2", "exon", "+"), ("T3", "intron", "-")}
        cds = index.annotate_row(candidate(137))
        assert "CDS" in cds["categories"]
        assert {f["strand"] for f in cds["features"] if f["feature"] == "CDS"} == {"+", "-"}
        assert "UTR" in index.annotate_row(candidate(100))["categories"]
        assert "UTR" in index.annotate_row(candidate(270))["categories"]
        assert "UTR" in index.annotate_row(candidate(360))["categories"]


def test_absence_is_distinct_from_unavailable(prepared):
    with AnnotationIndex(prepared[0]) as index:
        assert index.annotate_row(candidate(10, chromosome="MT"))["categories"] == ["intergenic"]
        for row in (candidate(10, chromosome="unknown"), candidate(10, chromosome="chr1"),
                    candidate(10, assembly="GRCh37"), candidate(10, assembly=None),
                    candidate(10, coordinate_system=None), candidate(10, coordinate_system="1-based"),
                    candidate(99_990), candidate(-1), candidate(10, end=30), candidate(True)):
            result = index.annotate_row(row)
            assert result["status"] == "unavailable" and result["categories"] == []
        assert index.annotate_row({"id": "pair"})["status"] == "no_coordinates"
    fallback = annotate_rows([candidate(10), {"id": "pair"}])
    assert [r["annotations"]["status"] for r in fallback] == ["unavailable", "no_coordinates"]
    assert all(r["annotations"]["categories"] == [] for r in fallback)


def test_rows_scores_and_order_unchanged(prepared):
    rows = [candidate(180), candidate(100), candidate(500)]
    original = deepcopy(rows)
    with AnnotationIndex(prepared[0]) as index:
        annotated = index.annotate_rows(rows)
        assert [{k: v for k, v in r.items() if k != "annotations"} for r in annotated] == original
        assert rows == original
        annotated[0]["annotations"]["features"].clear()
        assert index.annotate_row(rows[0])["features"]


def test_provenance_binding_and_tamper_detection(prepared):
    path, reference, manifest = prepared
    assert manifest["source_gtf_sha256"] and manifest["source_archive_sha256"]
    assert manifest["ignored_nonreference_features"] == 1
    assert manifest["feature_counts"]["intron"] == 4
    with AnnotationIndex(path, reference) as index:
        assert index.metadata() == manifest
    with pytest.raises(AnnotationUnavailable, match="incompatible"):
        AnnotationIndex(path, {**reference, "sha256": "b" * 64})
    manifest["release"] = "fake"
    path.with_suffix(".json").write_text(json.dumps(manifest))
    with pytest.raises(AnnotationUnavailable, match="manifest"):
        AnnotationIndex(path)
    with path.open("ab") as stream:
        stream.write(b"tampered")
    with pytest.raises(AnnotationUnavailable, match="SHA-256"):
        AnnotationIndex(path)


def test_missing_index_is_unavailable(tmp_path):
    with pytest.raises(AnnotationUnavailable):
        AnnotationIndex(tmp_path / "missing.sqlite")


def test_reference_lengths_require_matching_hash(tmp_path):
    fasta = tmp_path / "ref.fa"
    fasta.write_bytes(b">1 chromosome\nACGT\nAA\n>MT\nAAA\n")
    assert read_reference_contigs(fasta, file_sha256(fasta)) == {"1": 6, "MT": 3}
    with pytest.raises(ValueError, match="SHA-256"):
        read_reference_contigs(fasta, "a" * 64)


def test_pinned_source_digest_required(tmp_path):
    archive = tmp_path / "wrong.gz"
    archive.write_bytes(b"wrong")
    with pytest.raises(ValueError, match="archive SHA-256"):
        build_annotation_index(archive, tmp_path / "wrong.sqlite", reference={"assembly": "GRCh38", "verified": True, "sha256": "a" * 64},
                               contig_lengths={"1": 100})


def test_fifty_thousand_unique_hits_are_complete_and_bounded(prepared):
    rows = [candidate(i) for i in range(50_000)]
    with AnnotationIndex(prepared[0]) as index:
        annotated = index.annotate_rows(rows)
        assert len(annotated) == 50_000
        assert [r["row_index"] for r in annotated] == list(range(50_000))
        assert all(r["scores"] == {"k1": 0.123456} for r in annotated)
        assert annotated[-1]["annotations"]["categories"] == ["intergenic"]
        assert len(index._cache) <= 4096
        with pytest.raises(ValueError, match="50,000"):
            index.annotate_rows([candidate(900)] * 50_001)
