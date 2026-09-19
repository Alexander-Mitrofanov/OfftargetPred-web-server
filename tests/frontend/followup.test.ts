import assert from "node:assert/strict";
import { test } from "node:test";
import type { ResultRow } from "../../frontend/src/api.ts";
import { contextMetadata, contextRequest, validateContextDocument } from "../../frontend/src/features/followup.ts";
import type { ContextDocument } from "../../frontend/src/features/followup.ts";

const site = "GACTACGATCGTAGCTACGTAGG";
const row: ResultRow = { id: "chosen", row_index: 4, target: site, off_target: site, scores: { k1: .8 },
  chromosome: "chr1", start: 10, end: 33, strand: "+", assembly: "GRCh38", coordinate_system: "0-based half-open" };

function document(): ContextDocument {
  return { schema_version: "1.0", complete: true, flank_bases: 5,
    summary: { selected: 1, ready: 1, skipped: 0 },
    records: [{ selection_index: 0, candidate: { ...contextRequest([row], "5").records[0], chromosome: "1" },
      status: "ready", fasta_id: "candidate_1", context: { start: 5, end: 38, sequence: "AAAAA" + site + "TTTTT",
        sequence_sha256: "a".repeat(64), sequence_orientation: "forward reference", coordinate_system: "0-based half-open",
        target_start_offset: 5, target_end_offset: 28, left_bases: 5, right_bases: 5,
        left_clipped: false, right_clipped: false, ambiguous_bases: 0 } }],
    fasta: ">candidate_1\nAAAAA" + site + "TTTTT\n", fasta_sha256: "b".repeat(64),
    reference: { assembly: "GRCh38", sha256: "c".repeat(64), filename: "reference.fa", scope: "GRCh38 primary assembly" },
    coordinate_system: "0-based half-open", sequence_orientation: "forward reference", limitations: [] };
}

test("request requires an explicit bounded selection and sends only declared fields", () => {
  const request = contextRequest([{ ...row, token: "private", position: 100 } as ResultRow], "250");
  assert.equal(request.records[0].start, 10);
  assert.equal(request.flank_bases, 250);
  assert.equal("token" in request.records[0], false);
  assert.equal("scores" in request.records[0], false);
  for (const flank of ["-1", "1001", "1e2", "0.1", "", "NaN"]) assert.throws(() => contextRequest([row], flank));
  assert.throws(() => contextRequest([], "5"));
  assert.throws(() => contextRequest(Array(21).fill(row), "5"));
  assert.equal(contextRequest([row], "0").flank_bases, 0);
});

test("sequence-only rows are retained without guessed genomic coordinates", () => {
  const sequenceOnly = { id: "pair", target: site, off_target: site, scores: {}, position: 500 };
  const record = contextRequest([sequenceOnly], "20").records[0];
  assert.equal(record.start, undefined);
  assert.equal(record.assembly, undefined);
});

test("complete verified context validates and metadata preserves every outcome", () => {
  const value = validateContextDocument(document(), contextRequest([row], "5"));
  const metadata = JSON.parse(contextMetadata(value));
  assert.equal("fasta" in metadata, false);
  assert.equal(metadata.records[0].candidate.row_index, 4);
  assert.equal(metadata.fasta_sha256, value.fasta_sha256);
});

test("incomplete counts, invalid geometry and candidate substitutions fail closed", () => {
  for (const change of [
    (value: ContextDocument) => { value.summary.selected = 2; },
    (value: ContextDocument) => { value.records[0].selection_index = 1; },
    (value: ContextDocument) => { value.records[0].candidate.id = "different"; },
    (value: ContextDocument) => { value.records[0].candidate.row_index = 3; },
    (value: ContextDocument) => { value.records[0].context!.target_end_offset = 27; },
    (value: ContextDocument) => { value.records[0].context!.left_clipped = true; },
    (value: ContextDocument) => { value.records[0].context!.sequence = "T".repeat(33); },
    (value: ContextDocument) => { value.records[0].context!.ambiguous_bases = 1; },
    (value: ContextDocument) => { value.fasta = ""; },
  ]) {
    const value = document(); change(value);
    assert.throws(() => validateContextDocument(value, contextRequest([row], "5")));
  }
});

test("minus-strand candidate verifies against reverse complement of the forward-reference slice", () => {
  const negative = { ...row, strand: "-" };
  const value = document(); value.records[0].candidate.strand = "-";
  const reverse = [...site].reverse().map((base) => ({ A: "T", C: "G", G: "C", T: "A" })[base]).join("");
  value.records[0].context!.sequence = "AAAAA" + reverse + "TTTTT";
  assert.equal(validateContextDocument(value, contextRequest([negative], "5")).summary.ready, 1);
});

test("skipped records preserve their reason and support an empty FASTA", () => {
  const value = document(); value.summary.ready = 0; value.summary.skipped = 1; value.fasta = "";
  value.records = [{ selection_index: 0, candidate: contextRequest([row], "5").records[0], status: "skipped",
    reason_code: "reference_sequence_mismatch", reason: "Declared sequence does not match reference." }];
  assert.equal(validateContextDocument(value, contextRequest([row], "5")).records.length, 1);
  assert.equal(JSON.parse(contextMetadata(value)).records[0].reason_code, "reference_sequence_mismatch");
  value.records[0].reason = "";
  assert.throws(() => validateContextDocument(value, contextRequest([row], "5")));
});
