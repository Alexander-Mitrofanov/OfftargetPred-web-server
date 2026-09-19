"""Reference discovery contract: strands, PAMs, complete scopes and gene ambiguity."""
import gzip
import hashlib
import sqlite3

import pytest

from offtargetpred.annotations import AnnotationUnavailable, build_annotation_index
from offtargetpred.discovery import discover_guides, lookup_genes
from offtargetpred.reference import ReferenceUnavailable, build_fasta_index
from offtargetpred.sequence import ValidationError

TARGET = "GACTACGATCGTAGCTACGTAGG"


def reverse(sequence):
    return sequence.translate(str.maketrans("ACGT", "TGCA"))[::-1]


def prepare(tmp_path, sequence):
    path = tmp_path / "fixture.fa"
    path.write_text(">1\n" + "\n".join(sequence[i:i + 13] for i in range(0, len(sequence), 13)) + "\n")
    reference = {"assembly": "GRCh38", "verified": True, "filename": path.name,
                 "sha256": hashlib.sha256(path.read_bytes()).hexdigest(), "contigs": 1,
                 "total_bases": len(sequence)}
    build_fasta_index(path, reference)
    return path, reference


def test_actual_pams_both_strands_and_coordinates(tmp_path):
    sequence = "T" * 10 + TARGET + "T" * 27 + reverse(TARGET[:-3] + "CGG") + "T" * 10
    path, reference = prepare(tmp_path, sequence)
    result = discover_guides(path, reference, "chr1", 0, len(sequence))
    guides = result["guides"]
    assert [(g["start"], g["end"], g["strand"]) for g in guides] == [(10, 33, "+"), (60, 83, "-")]
    assert [g["pam"] for g in guides] == ["AGG", "CGG"]
    assert [(g["spacer_start"], g["spacer_end"]) for g in guides] == [(10, 30), (63, 83)]
    assert result["scope"]["complete"] and result["selection_required"]
    for guide in guides:
        genomic = sequence[guide["start"]:guide["end"]]
        assert guide["target23"] == (genomic if guide["strand"] == "+" else reverse(genomic))
        assert guide["reference_sha256"] == reference["sha256"]


def test_whole_site_inside_interval_no_pam_padding(tmp_path):
    path, reference = prepare(tmp_path, "T" * 10 + TARGET + "T" * 10)
    assert len(discover_guides(path, reference, "1", 10, 33)["guides"]) == 1
    assert discover_guides(path, reference, "1", 9, 32)["guides"] == []
    assert discover_guides(path, reference, "1", 11, 34)["guides"] == []


def test_ambiguous_windows_are_explicitly_skipped(tmp_path):
    path, reference = prepare(tmp_path, TARGET[:-3] + "NGG")
    result = discover_guides(path, reference, "1", 0, 23)
    assert result["guides"] == []
    assert result["scope"]["ambiguous_windows_skipped"] == 1
    assert result["scope"]["complete"]


def test_repeated_sequences_keep_each_locus_and_limit_fails_closed(tmp_path):
    path, reference = prepare(tmp_path, "G" * 224)
    result = discover_guides(path, reference, "1", 0, 222)
    assert len(result["guides"]) == 200
    assert len({g["start"] for g in result["guides"]}) == 200
    with pytest.raises(ValidationError, match="more than 200"):
        discover_guides(path, reference, "1", 0, 223)


def test_same_full_reference_interval_can_support_both_strands(tmp_path):
    path, reference = prepare(tmp_path, "CC" + "A" * 19 + "GG")
    guides = discover_guides(path, reference, "1", 0, 23)["guides"]
    assert [(guide["start"], guide["strand"]) for guide in guides] == [(0, "+"), (0, "-")]


@pytest.mark.parametrize("start,end", [(-1, 23), (0, 22), (0, 20001), (True, 24), (0, 23.0), ("0", 23)])
def test_invalid_intervals_fail_before_reference_access(start, end):
    with pytest.raises(ValidationError):
        discover_guides("missing.fa", {}, "1", start, end)


def test_reference_and_contig_failures_are_distinct(tmp_path):
    path, reference = prepare(tmp_path, TARGET)
    with pytest.raises(ValidationError, match="Chromosome"):
        discover_guides(path, reference, "chrUnknown", 0, 23)
    with pytest.raises(ValidationError, match="out of bounds"):
        discover_guides(path, reference, "1", 0, 24)
    with pytest.raises(ReferenceUnavailable):
        discover_guides(path, {**reference, "sha256": "a" * 64}, "1", 0, 23)


@pytest.fixture
def annotation(tmp_path):
    _, reference = prepare(tmp_path, "A" * 40_000)
    gtf = []
    for number, (start, end, name, strand) in enumerate([(1, 100, "DUP", "+"), (1001, 1200, "DUP", "-"), (2001, 30000, "LARGE", "+")], 1):
        gene, transcript = f"ENSG{number:011}", f"ENST{number:011}"
        attrs = f'gene_id "{gene}"; gene_name "{name}";'
        for feature in ("gene", "transcript", "exon"):
            detail = attrs + (f' transcript_id "{transcript}";' if feature != "gene" else "")
            gtf.append(f"1\ttest\t{feature}\t{start}\t{end}\t.\t{strand}\t.\t{detail}\n")
    archive = tmp_path / "fixture.gtf.gz"
    with gzip.open(archive, "wt") as stream:
        stream.write("".join(gtf))
    path = tmp_path / "annotation.sqlite"
    build_annotation_index(archive, path, reference=reference, contig_lengths={"1": 40_000},
                           expected_sha256=hashlib.sha256(archive.read_bytes()).hexdigest())
    return path, reference


def test_exact_gene_name_ambiguity_and_stable_identifiers(annotation):
    path, reference = annotation
    result = lookup_genes(path, reference, "DUP")
    assert result["status"] == "ambiguous" and len(result["matches"]) == 2
    assert result["selection_required"] and result["complete"]
    assert result["matches"][1]["start"] == 1000
    assert lookup_genes(path, reference, "dup")["status"] == "not_found"
    gene = lookup_genes(path, reference, "ENSG00000000001")["matches"]
    assert len(gene) == 1 and gene[0]["feature"] == "gene"
    transcript = lookup_genes(path, reference, "ENST00000000001")["matches"]
    assert len(transcript) == 1 and transcript[0]["feature"] == "transcript"
    assert transcript[0]["transcript_id"] == "ENST00000000001"
    assert lookup_genes(path, reference, "LARGE")["matches"][0]["requires_narrowing"]


@pytest.mark.parametrize("query", ["", "  ", None, "A" * 101, "TP53\n", "ENSG00000141510.5", "ENST00000269305.8"])
def test_invalid_gene_queries_fail_before_index_access(query):
    with pytest.raises(ValidationError):
        lookup_genes("missing.sqlite", {}, query)


def test_gene_queries_are_literal_not_sql_or_pattern(annotation):
    path, reference = annotation
    for query in ("%", "_", "' OR 1=1 --"):
        assert lookup_genes(path, reference, query)["matches"] == []
    with pytest.raises(AnnotationUnavailable):
        lookup_genes(path, {**reference, "sha256": "f" * 64}, "DUP")


def test_excessive_gene_ambiguity_is_rejected_not_truncated(annotation, monkeypatch):
    from offtargetpred import discovery
    monkeypatch.setattr(discovery, "MAX_GENE_MATCHES", 1)
    with pytest.raises(ValidationError, match="more than 25"):
        lookup_genes(*annotation, "DUP")


def test_gene_timeout_never_returns_partial_matches(annotation, monkeypatch):
    from offtargetpred import discovery
    original = sqlite3.connect

    class BusyConnection(sqlite3.Connection):
        def execute(self, sql, parameters=()):
            if "FROM features f JOIN contigs" in sql:
                raise sqlite3.OperationalError("interrupted")
            return super().execute(sql, parameters)

    monkeypatch.setattr(discovery.sqlite3, "connect", lambda *args, **kwargs: original(*args, **kwargs, factory=BusyConnection))
    with pytest.raises(AnnotationUnavailable, match="query limit"):
        lookup_genes(*annotation, "DUP")
