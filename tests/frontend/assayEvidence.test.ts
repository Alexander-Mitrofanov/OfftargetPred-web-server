import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { hashEvidenceBytes, hashEvidenceText, previewAssayEvidence, SYNTHETIC_ASSAY_EVIDENCE } from "../../frontend/src/features/assayEvidence.ts";
import type { EvidenceOptions } from "../../frontend/src/features/assayEvidence.ts";
import type { ResultRow } from "../../frontend/src/api.ts";

const target = "GATGCTCTCCAGAATCACTGCGG", candidate = "GTTGCTCTTCAGAATCACTGAGG";
const different = "C".repeat(20) + "AGG";
const row = (patch: Partial<ResultRow> = {}): ResultRow => ({ id: "site-1", row_index: 0, target, off_target: candidate, scores: { k1: 0.3 }, assembly: "GRCh38", chromosome: "1", start: 100, end: 123, strand: "+", coordinate_system: "0-based half-open", ...patch });
const options: EvidenceOptions = { assay: "GUIDE-seq", sampleContext: "Synthetic test only", matchMode: "pair-sequence", valueKind: "read_count" };
const pairText = `target,off_target,value\n${target},${candidate},12\n`;
const coordOptions: EvidenceOptions = { ...options, matchMode: "coordinates", assembly: "GRCh38", coordinateSystem: "0-based half-open" };
const coordText = "chromosome,start,end,strand,value\nchr1,100,123,+,12\n";

test("paired sequences require both exact actual 23-base sequences", () => {
  const result = previewAssayEvidence(pairText, options, [row(), row({ row_index: 1, target: different }), row({ row_index: 2, off_target: different })]);
  assert.equal(result.canApply, true);
  assert.deepEqual(result.state!.observations[0].match_result_indices, [0]);
  assert.equal(result.state!.summary.prediction_rows_without_observations, 2);
  assert.equal(result.state!.per_row[0].positive_observation_ids[0], "observation-1");
});

test("candidate-only mode retains matches across guides and loci as ambiguous", () => {
  const result = previewAssayEvidence(`off_target,value\n${candidate},2`, { ...options, matchMode: "candidate-sequence" }, [row(), row({ row_index: 1, target: different, start: 400, end: 423 })]);
  assert.deepEqual(result.state!.observations[0].match_result_indices, [0, 1]);
  assert.equal(result.state!.observations[0].status, "ambiguous");
  assert.deepEqual(result.state!.per_row.map((entry) => entry.ambiguous_observation_ids), [["observation-1"], ["observation-1"]]);
});

test("same pair at two genomic loci remains ambiguous", () => {
  const result = previewAssayEvidence(pairText, options, [row(), row({ row_index: 1, chromosome: "2" })]);
  assert.equal(result.state!.summary.ambiguous_observations, 1);
  assert.equal(result.state!.summary.matched_observations, 0);
  assert.equal(result.state!.summary.prediction_rows_with_observations, 2);
});

test("duplicate observations and duplicate result identities are kept separately", () => {
  const result = previewAssayEvidence(pairText + `${target},${candidate},12\n`, options, [row(), row()]);
  assert.deepEqual(result.state!.observations.map((entry) => entry.import_row_id), ["observation-1", "observation-2"]);
  assert.equal(result.state!.observations[1].duplicate_of, "observation-1");
  assert.equal(result.state!.summary.duplicate_observations, 1);
  assert.equal(result.state!.per_row.length, 2);
  assert.deepEqual(result.state!.per_row.map((entry) => entry.result_index), [0, 1]);
  assert.equal(result.state!.summary.positive_observations, 2); // Explicit input-row counts; never summed values.
  assert.equal("accuracy" in result.state!, false);
});

test("unmatched observations retained and zero is explicitly not a negative", () => {
  const result = previewAssayEvidence(`target,off_target,value\n${target},${candidate},0\n${different},${different},2`, options, [row(), row({ off_target: different })]);
  assert.equal(result.state!.summary.zero_observations, 1);
  assert.equal(result.state!.summary.unmatched_observations, 1);
  assert.deepEqual(result.state!.per_row[0].zero_observation_ids, ["observation-1"]);
  assert.deepEqual(result.state!.per_row[0].positive_observation_ids, []);
  assert.match(result.state!.metadata.interpretation, /not true negatives/);
  assert.equal(result.state!.observations.length, 2);
});

test("one-based inclusive coordinates convert exactly once, including negative strand", () => {
  const result = previewAssayEvidence(coordText.replace("100,123,+", "101,123,-"), { ...coordOptions, coordinateSystem: "1-based inclusive" }, [row(), row({ strand: "-", row_index: 1 })]);
  assert.equal(result.canApply, true);
  assert.equal(result.state!.observations[0].start, 100);
  assert.equal(result.state!.observations[0].end, 123);
  assert.deepEqual(result.state!.observations[0].match_result_indices, [1]);
  assert.equal(result.state!.metadata.source_coordinate_system, "1-based inclusive");
  assert.equal(result.state!.metadata.stored_coordinate_system, "0-based half-open");
});

test("coordinate matching requires build and convention, does not assume a missing result declaration", () => {
  for (const patch of [{ assembly: "" }, { coordinateSystem: "" }]) {
    assert.equal(previewAssayEvidence(coordText, { ...coordOptions, ...patch } as EvidenceOptions, [row()]).canApply, false);
  }
  const result = previewAssayEvidence(coordText, coordOptions, [row({ assembly: undefined }), row({ assembly: "GRCh37" }), row({ coordinate_system: undefined }), row({ coordinate_system: "0-based half-open invented" }), row({ strand: undefined }), row({ end: undefined })]);
  assert.equal(result.canApply, true);
  assert.equal(result.state!.summary.unmatched_observations, 1);
});

test("canonical chromosome aliases match but arbitrary chr prefixes are not removed", () => {
  assert.equal(previewAssayEvidence(coordText.replace("chr1", "chrM"), coordOptions, [row({ chromosome: "MT" })]).state!.summary.matched_observations, 1);
  assert.equal(previewAssayEvidence(coordText.replace("chr1", "chrKI270728.1"), coordOptions, [row({ chromosome: "KI270728.1" })]).state!.summary.unmatched_observations, 1);
});

test("optional coordinate target distinguishes guides at the same locus", () => {
  const input = `chromosome,start,end,strand,value,target\nchr1,100,123,+,12,${target}`;
  const result = previewAssayEvidence(input, coordOptions, [row(), row({ target: different })]);
  assert.deepEqual(result.state!.observations[0].match_result_indices, [0]);
});

test("interval width, strand and integer coordinates are strict", () => {
  for (const mutation of ["chr1,100,122,+,12", "chr1,100,123,.,12", "chr1,100,123,1,12", "chr1,-1,22,+,12", "chr1,1e2,123,+,12", "chr1,2147483648,2147483671,+,12", "chr1:100-123,100,123,+,12"]) {
    const result = previewAssayEvidence(`chromosome,start,end,strand,value\n${mutation}`, coordOptions, [row()]);
    assert.equal(result.canApply, false);
    assert.equal(result.issues[0].row, 1);
  }
});

test("unknown bases, RNA, gaps, missing PAM and candidate-only extra target cannot be silently guessed", () => {
  for (const bad of ["A".repeat(20), "A".repeat(20) + "NGG", "U" + candidate.slice(1), "-" + candidate.slice(1)]) {
    const result = previewAssayEvidence(pairText.replace(candidate, bad), options, [row()]);
    assert.equal(result.canApply, false);
    assert.equal(result.state, null);
  }
  assert.equal(previewAssayEvidence(pairText, { ...options, matchMode: "candidate-sequence" }, [row()]).canApply, false);
});

test("decimal evidence allowed only as declared, invalid and missing values reject entire import", () => {
  assert.equal(previewAssayEvidence(pairText.replace(",12", ",1.5"), { ...options, valueKind: "evidence_value" }, [row()]).canApply, true);
  for (const bad of ["1.5", "-1", "Infinity", "NaN", "0x12", "", "1e999", "1e-999", "9007199254740992"]) {
    const result = previewAssayEvidence(pairText + `${target},${candidate},${bad}`, options, [row()]);
    assert.equal(result.canApply, false);
    assert.equal(result.issues[0].row, 2);
    assert.equal(result.state, null);
  }
});

test("malformed CSV, duplicate headers, unknown native columns and wrong field counts are actionable", () => {
  for (const input of [pairText + '"unterminated', pairText.replace("value", "target"), pairText.replace("value", "readcount"), pairText.replace(",12", ",12,extra"), "", "target,off_target,value\n"]) {
    const result = previewAssayEvidence(input, options, [row()]);
    assert.equal(result.canApply, false);
    assert.ok(result.issues.length > 0);
  }
});

test("TSV, lowercase sequences and quoted source IDs retain content as data", () => {
  const input = `id\ttarget\toff_target\tvalue\n"=HYPERLINK(""https://example.test"") <script>"\t${target.toLowerCase()}\t${candidate}\t3`;
  const result = previewAssayEvidence(input, { ...options, assay: "<script>not HTML</script>" }, [row()]);
  assert.equal(result.canApply, true);
  assert.equal(result.state!.observations[0].source_id, '=HYPERLINK("https://example.test") <script>');
  assert.equal(result.state!.metadata.assay, "<script>not HTML</script>");
  assert.equal(result.state!.observations[0].status, "matched");
});

test("explicit assay name and non-control metadata are required", () => {
  assert.equal(previewAssayEvidence(pairText, { ...options, assay: " " }, [row()]).canApply, false);
  assert.equal(previewAssayEvidence(pairText, { ...options, sampleContext: "sample\u0000" }, [row()]).canApply, false);
});

test("byte and observation bounds reject before any import", () => {
  assert.equal(previewAssayEvidence("a".repeat(5 * 1024 * 1024 + 1), options, []).canApply, false);
  assert.equal(previewAssayEvidence("target,off_target,value\n" + `${target},${candidate},1\n`.repeat(10_001), options, []).canApply, false);
});

test("many ambiguous links are bounded without silently truncating an applied import", () => {
  const rows = Array.from({ length: 1000 }, (_, index) => row({ row_index: index }));
  const input = "target,off_target,value\n" + `${target},${candidate},1\n`.repeat(251);
  const result = previewAssayEvidence(input, options, rows);
  assert.equal(result.canApply, false);
  assert.equal(result.state, null);
  assert.match(result.issues[0].message, /250,000/);
});

test("prediction rows and scores are never mutated", () => {
  const rows = [row()]; const before = JSON.stringify(rows);
  previewAssayEvidence(pairText, options, rows);
  assert.equal(JSON.stringify(rows), before);
});

test("synthetic examples parse in their declared modes", () => {
  for (const [mode, text] of Object.entries(SYNTHETIC_ASSAY_EVIDENCE)) {
    assert.equal(previewAssayEvidence(text, { ...coordOptions, matchMode: mode as EvidenceOptions["matchMode"] }, [row()]).canApply, true);
  }
});

test("SHA256 matches exact UTF-8 pasted text and exact file bytes including BOM", async () => {
  assert.equal(await hashEvidenceText(pairText), createHash("sha256").update(pairText).digest("hex"));
  const bytes = new TextEncoder().encode("\uFEFF" + pairText);
  assert.equal(await hashEvidenceBytes(bytes.buffer), createHash("sha256").update(bytes).digest("hex"));
  assert.notEqual(await hashEvidenceBytes(bytes.buffer), await hashEvidenceText(pairText));
});
