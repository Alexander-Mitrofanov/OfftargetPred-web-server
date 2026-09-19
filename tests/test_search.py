"""Search parser tests verify scientific orientation and mismatch conventions."""

import hashlib
from pathlib import Path

import pytest

from offtargetpred.search import CasOffinderSearch, SearchError, parse_cas_offinder_output


GUIDE = "GATGCTCTCCAGAATCACTGCGG"
QUERY = GUIDE[:20] + "NNN"


def test_preserves_original_guide_pam_orientation_and_coordinates(tmp_path):
    output = tmp_path / "out.tsv"
    output.write_text(f"{QUERY}\tchr1\t42\t{GUIDE}\t+\t0\n"
                      f"{QUERY}\tchr2\t100\t{GUIDE[:20]}AGG\t-\t0\n"
                      f"{QUERY}\tchr3\t0\tc{GUIDE[1:]}\t+\t1\n")
    rows = parse_cas_offinder_output(output, [{"id": "g1", "target": GUIDE}], 1)
    assert rows[0]["exact_match"]
    minus = next(row for row in rows if row["strand"] == "-")
    assert minus["target"] == GUIDE
    assert minus["off_target"] == GUIDE[:20] + "AGG"  # no second reverse complement
    assert minus["protospacer_match"] and not minus["exact_match"]
    assert minus["mismatches"] == 0 and minus["pam_mismatches"] == 1
    assert minus["start"] == 100 and minus["end"] == 123


def test_shared_spacer_distinct_original_pams_are_scored_separately(tmp_path):
    output = tmp_path / "out.tsv"
    output.write_text(f"{QUERY}\tchr1\t42\t{GUIDE}\t+\t0\n")
    rows = parse_cas_offinder_output(output, [{"id": "a", "target": GUIDE}, {"id": "b", "target": GUIDE[:20] + "AGG"}], 0)
    assert len(rows) == 2
    assert rows[0]["target"] != rows[1]["target"]


def test_fasta_header_description_normalizes_to_contig_id_before_deduplication(tmp_path):
    output = tmp_path / "out.tsv"
    output.write_text(f"{QUERY}\t1 dna:chromosome chromosome:GRCh38:1:1:248956422:1 REF\t42\t{GUIDE}\t+\t0\n"
                      f"{QUERY}\t1\t42\t{GUIDE}\t+\t0\n")
    rows = parse_cas_offinder_output(output, [{"id": "g1", "target": GUIDE}], 0)
    assert len(rows) == 1
    assert rows[0]["chromosome"] == "1"
    assert rows[0]["start"] == 42


@pytest.mark.parametrize("line", [
    f"{QUERY}\tchr1\t42\t{GUIDE}\t+\t1\n",  # false mismatch annotation
    f"{QUERY}\tchr1\t-1\t{GUIDE}\t+\t0\n",  # invalid coordinate
    f"{QUERY}\tchr1\t42\t{GUIDE[:-1]}A\t+\t0\n",  # wrong PAM
    f"{QUERY}\tchr1\t42\t{GUIDE}\t?\t0\n",  # invalid strand
])
def test_malformed_or_inconsistent_search_fails_closed(tmp_path, line):
    output = tmp_path / "out.tsv"
    output.write_text(line)
    with pytest.raises(SearchError):
        parse_cas_offinder_output(output, [{"id": "g1", "target": GUIDE}], 1)


def test_search_candidate_limit_never_returns_truncated_success(tmp_path):
    output = tmp_path / "out.tsv"
    output.write_text("".join(f"{QUERY}\tchr1\t{i}\t{GUIDE}\t+\t0\n" for i in range(3)))
    with pytest.raises(SearchError, match="no partial"):
        parse_cas_offinder_output(output, [{"id": "g1", "target": GUIDE}], 0, max_candidates=2)


def test_reference_checksum_verified_before_search(tmp_path):
    genome = tmp_path / "genome.fa"
    genome.write_text(">chr1\n" + GUIDE + "\n")
    metadata = {"assembly": "GRCh38", "verified": True, "filename": genome.name, "sha256": "bad"}
    with pytest.raises(SearchError, match="SHA-256"):
        CasOffinderSearch("/bin/true", tmp_path, metadata)


def test_subprocess_uses_verified_file_ngg_and_wildcard_query(tmp_path):
    genome = tmp_path / "genome.fa"
    genome.write_text(">chr1\n" + GUIDE + "\n")
    binary = tmp_path / "cas-test"
    binary.write_text("#!/usr/bin/env python3\nimport pathlib,sys\np=pathlib.Path(sys.argv[1]).read_text().splitlines()\n"
                      "assert p[1] == 'N'*21 + 'GG'\nassert p[2].endswith('NNN 0')\n"
                      f"pathlib.Path(sys.argv[3]).write_text('{QUERY}\\tchr1\\t0\\t{GUIDE}\\t+\\t0\\n')\n")
    binary.chmod(0o755)
    metadata = {"assembly": "GRCh38", "verified": True, "filename": genome.name, "sha256": hashlib.sha256(genome.read_bytes()).hexdigest()}
    search = CasOffinderSearch(binary, tmp_path, metadata)
    rows = search.search([{"id": "g1", "target": GUIDE}], 0, tmp_path / "work")
    assert rows[0]["exact_match"]
    assert (tmp_path / "work/cas-input.txt").read_text().splitlines()[0] == str(genome)
