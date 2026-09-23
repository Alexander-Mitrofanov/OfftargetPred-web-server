import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import type { ResultRow } from "../../frontend/src/api.ts";
import { contextRequest, validateContextDocument } from "../../frontend/src/features/followup.ts";
import type { ContextDocument } from "../../frontend/src/features/followup.ts";
import { appendReferenceCheck, createReferenceCheckBatch, emptyReferenceChecks, referenceCheckForRow, validateReferenceChecks, verifyReferenceChecksIntegrity } from "../../frontend/src/features/referenceChecks.ts";
import type { ReferenceCheckState } from "../../frontend/src/features/referenceChecks.ts";
import { analysisFiles, createAnalysisPackage, storedZip } from "../../frontend/src/features/analysisExports.ts";
import { importAnalysisPackage } from "../../frontend/src/features/analysisImports.ts";
import { createOverviewFilters } from "../../frontend/src/features/overview.ts";

const site = "GACTACGATCGTAGCTACGTAGG";
const row: ResultRow = { id: "duplicate-label", row_index: 1, target: site, off_target: site, scores: { k1: .8 },
  chromosome: "chr1", start: 10, end: 33, strand: "+", assembly: "GRCh38", coordinate_system: "0-based half-open" };
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const stamp = "2026-09-19T22:00:00.000Z";
const reverse = (sequence: string) => [...sequence].reverse().map(base => ({ A: "T", C: "G", G: "C", T: "A" })[base]).join("");

function document(rows: ResultRow[] = [row], flank = 0, skips: Record<number, string> = {}): ContextDocument {
  const request = contextRequest(rows, String(flank));
  const result: ContextDocument = { schema_version: "1.0", complete: true, flank_bases: flank,
    summary: { selected: rows.length, ready: 0, skipped: 0 }, records: [], fasta: "", fasta_sha256: hash(""),
    reference: { assembly: "GRCh38", sha256: "a".repeat(64), filename: "reference.fa", scope: "GRCh38 primary assembly" },
    coordinate_system: "0-based half-open", sequence_orientation: "forward reference", limitations: [] };
  rows.forEach((selected, index) => {
    const candidate = copy(request.records[index]);
    if (skips[index]) {
      result.records.push({ selection_index: index, candidate, status: "skipped", reason_code: skips[index], reason: "This declared candidate could not be prepared." });
      result.summary.skipped += 1; return;
    }
    const sequence = "A".repeat(flank) + (selected.strand === "-" ? reverse(selected.off_target) : selected.off_target) + "T".repeat(flank);
    const fastaId = `candidate_${index + 1}`;
    result.records.push({ selection_index: index,
      candidate: { ...candidate, requested_chromosome: candidate.chromosome, chromosome: candidate.chromosome?.replace(/^chr/, ""), off_target: candidate.off_target.toUpperCase() },
      status: "ready", fasta_id: fastaId, context: { start: selected.start! - flank, end: selected.end! + flank,
        sequence, sequence_sha256: hash(sequence), sequence_orientation: "forward reference", coordinate_system: "0-based half-open",
        target_start_offset: flank, target_end_offset: flank + 23, left_bases: flank, right_bases: flank,
        left_clipped: false, right_clipped: false, ambiguous_bases: 0 } });
    result.fasta += `>${fastaId}\n${sequence}\n`; result.summary.ready += 1;
  });
  result.fasta_sha256 = hash(result.fasta); return result;
}

async function state(rows: ResultRow[] = [row], value = document(rows), purpose: "check" | "flanks" = "check") {
  const batch = await createReferenceCheckBatch(rows, contextRequest(rows, String(value.flank_bases)), { purpose, document: value, checkedAt: stamp, id: "batch-1" });
  return appendReferenceCheck(emptyReferenceChecks(), batch);
}

test("zero-flank checks bind exact declarations and preserve immutable original rows", async () => {
  const before = copy(row); const saved = await state();
  const outcome = referenceCheckForRow(saved, row);
  assert.equal(outcome.status, "match"); assert.equal(outcome.origin, "current-session");
  assert.equal(outcome.reference_sha256, "a".repeat(64)); assert.equal(outcome.checked_at, stamp);
  assert.equal(saved.batches[0].bindings[0].request.chromosome, "chr1");
  assert.equal(outcome.record!.candidate.chromosome, "1"); assert.deepEqual(row, before);
});

test("minus-strand and documented aliases retain exact original coordinates", async () => {
  const negative = { ...row, strand: "-", coordinate_system: "0-based half-open, forward-reference coordinates" };
  const value = document([negative]); value.records[0].candidate.coordinate_system = "0-based half-open";
  assert.equal(referenceCheckForRow(await state([negative], value), negative).status, "match");
  for (const edit of [
    (value: ContextDocument) => { value.records[0].candidate.chromosome = "2"; },
    (value: ContextDocument) => { value.records[0].candidate.requested_chromosome = "chr2"; },
  ]) { const wrong = copy(value); edit(wrong); assert.throws(() => validateContextDocument(wrong, contextRequest([negative], "0"))); }
});

test("mismatch, ineligible and untouched candidates remain distinct", async () => {
  const missing = { id: "no-locus", row_index: 2, target: site, off_target: site, scores: {} };
  const rows = [row, missing];
  const saved = await state(rows, document(rows, 0, { 0: "reference_sequence_mismatch", 1: "unsupported_assembly" }));
  assert.equal(referenceCheckForRow(saved, row).status, "mismatch");
  assert.equal(referenceCheckForRow(saved, missing).status, "ineligible");
  assert.equal(referenceCheckForRow(saved, { ...row, row_index: 3 }).status, "unchecked");
  assert.equal(saved.batches[0].document!.records.length, 2);
});

test("unavailable response is durable but supplies no reference match or hash", async () => {
  const batch = await createReferenceCheckBatch([row], contextRequest([row], "0"), { purpose: "check", unavailableReason: "Reference service unavailable.", checkedAt: stamp, id: "failed" });
  const saved = appendReferenceCheck(emptyReferenceChecks(), batch);
  assert.equal(referenceCheckForRow(saved, row).status, "unavailable");
  assert.equal(referenceCheckForRow(saved, row).reference_sha256, undefined);
  assert.equal(referenceCheckForRow(validateReferenceChecks(saved, [row]), row).origin, "saved-file");
});

test("changed end, assembly, convention, target or strand cannot inherit a prior check", async () => {
  const saved = await state();
  for (const changed of [{ ...row, end: 34 }, { ...row, assembly: "GRCh37" }, { ...row, coordinate_system: "1-based inclusive" },
    { ...row, target: "A".repeat(23) }, { ...row, strand: "-" }, { ...row, off_target: "A".repeat(23) }]) {
    assert.equal(referenceCheckForRow(saved, changed).status, "unchecked");
    assert.throws(() => validateReferenceChecks(saved, [changed]));
  }
});

test("duplicate labels at different rows and loci keep their own outcomes", async () => {
  const second = { ...row, row_index: 2, start: 100, end: 123 };
  const saved = await state([row, second], document([row, second], 0, { 1: "reference_sequence_mismatch" }));
  assert.equal(referenceCheckForRow(saved, row).status, "match");
  assert.equal(referenceCheckForRow(saved, second).status, "mismatch");
  assert.throws(() => validateReferenceChecks(saved, [row, row, second]));
});

test("reopening preserves checked data and forces recorded labels without trusting saved origin", async () => {
  const saved = await state(); const reopened = validateReferenceChecks(saved, [row]);
  await verifyReferenceChecksIntegrity(reopened);
  assert.equal(reopened.batches[0].origin, "saved-file");
  assert.equal(referenceCheckForRow(reopened, row).label, "Recorded reference match");
  assert.deepEqual(reopened.batches[0].document, saved.batches[0].document);
  assert.equal(saved.batches[0].origin, "current-session");
});

test("skipped outcomes must echo every exact submitted declaration", async () => {
  const saved = await state([row], document([row], 0, { 0: "reference_sequence_mismatch" }));
  for (const key of ["off_target", "chromosome", "start", "strand", "assembly", "coordinate_system"] as const) {
    const bad = copy(saved); const candidate = bad.batches[0].document!.records[0].candidate;
    Object.assign(candidate, { [key]: key === "start" ? 20 : "different" });
    assert.throws(() => validateReferenceChecks(bad, [row]));
  }
});

test("request order and duplicated joins cannot attach results to another candidate", async () => {
  const second = { ...row, row_index: 2, start: 100, end: 123 };
  const saved = await state([row, second]);
  const reordered = copy(saved); reordered.batches[0].request.records.reverse();
  assert.throws(() => validateReferenceChecks(reordered, [row, second]));
  const duplicated = copy(saved); duplicated.batches[0].bindings[1] = duplicated.batches[0].bindings[0];
  assert.throws(() => validateReferenceChecks(duplicated, [row, second]));
});

test("FASTA/sequence checksums are verified, including empty all-skipped FASTA", async () => {
  const saved = await state();
  for (const mutate of [
    (value: ReferenceCheckState) => { value.batches[0].document!.fasta_sha256 = "0".repeat(64); },
    (value: ReferenceCheckState) => { value.batches[0].document!.records[0].context!.sequence_sha256 = "0".repeat(64); },
  ]) { const bad = copy(saved); mutate(bad); await assert.rejects(() => verifyReferenceChecksIntegrity(validateReferenceChecks(bad, [row]))); }
  const skipped = await state([row], document([row], 0, { 0: "out_of_bounds" }));
  await verifyReferenceChecksIntegrity(validateReferenceChecks(skipped, [row]));
});

test("FASTA content and order must agree with the actual validated contexts", () => {
  const value = document(); value.fasta = ">candidate_1\n" + "A".repeat(23) + "\n"; value.fasta_sha256 = hash(value.fasta);
  assert.throws(() => validateContextDocument(value, contextRequest([row], "0")));
});

test("unknown fields, status codes, invalid dates and purpose/flank mismatch fail closed", async () => {
  const good = await state();
  for (const mutate of [
    (value: ReferenceCheckState) => { Object.assign(value.batches[0], { token: "not-allowed" }); },
    (value: ReferenceCheckState) => { value.batches[0].checked_at = "2026-02-30T00:00:00.000Z"; },
    (value: ReferenceCheckState) => { value.batches[0].request.flank_bases = 1; },
    (value: ReferenceCheckState) => { Object.assign(value.batches[0].document!.reference, { secret: "not-allowed" }); },
    (value: ReferenceCheckState) => { value.batches[0].document!.records[0].candidate.id = "another"; },
    (value: ReferenceCheckState) => { value.batches[0].unavailable_reason = "both result and error"; },
  ]) { const bad = copy(good); mutate(bad); assert.throws(() => validateReferenceChecks(bad, [row])); }
  const skipped = await state([row], document([row], 0, { 0: "unknown_contig" }));
  skipped.batches[0].document!.records[0].reason_code = "invented";
  assert.throws(() => validateReferenceChecks(skipped, [row]));
});

test("history keeps prior flank provenance while latest exact check controls status", async () => {
  const saved = await state([row], document([row], 5), "flanks");
  const next = await createReferenceCheckBatch([row], contextRequest([row], "0"), { purpose: "check", document: document([row], 0, { 0: "reference_sequence_mismatch" }), checkedAt: stamp, id: "batch-2" });
  const updated = appendReferenceCheck(saved, next);
  assert.equal(referenceCheckForRow(updated, row).status, "mismatch");
  assert.equal(updated.batches[0].document!.records[0].context!.sequence.length, 33);
  assert.equal(saved.batches.length, 1);
  await verifyReferenceChecksIntegrity(validateReferenceChecks(updated, [row]));
});

test("history bounds never silently discard old records", async () => {
  const saved = await state(); const original = saved.batches[0];
  const full: ReferenceCheckState = { schema_version: "1.0", batches: Array.from({ length: 50 }, (_, index) => ({ ...copy(original), id: `batch-${index}` })) };
  assert.equal(validateReferenceChecks(full, [row]).batches.length, 50);
  assert.throws(() => appendReferenceCheck(full, { ...original, id: "batch-51" }));
  assert.throws(() => validateReferenceChecks({ ...full, batches: [...full.batches, { ...original, id: "batch-51" }] }, [row]));
  assert.throws(() => appendReferenceCheck(saved, original));
});

test("complete archive roundtrip retains plus/minus flanks and mismatch provenance offline", async () => {
  const rows = [row, { ...row, row_index: 2, start: 100, end: 123, strand: "-" }, { ...row, row_index: 3, start: 200, end: 223 }];
  const history = await state(rows, document(rows, 5, { 2: "reference_sequence_mismatch" }), "flanks");
  const filters = createOverviewFilters();
  const input = { document: { rows, metadata: { mode: "pairs", candidate_scope: "Synthetic supplied pairs" } },
    filteredRows: rows, selectedRows: rows, filters,
    workspace: { filters, sort: "input" as const, ascending: true, showCfd: false },
    referenceChecks: history, generatedAt: new Date(stamp), citation: "Synthetic fixture", license: "MIT" };
  const archive = await createAnalysisPackage(input);
  const priorFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error("Reference archive import must remain offline"); };
  try {
    const reopened = await importAnalysisPackage(archive);
    const recorded = reopened.state.referenceChecks!;
    assert.equal(recorded.batches[0].origin, "saved-file");
    assert.deepEqual(recorded.batches[0].document, history.batches[0].document);
    assert.equal(referenceCheckForRow(recorded, reopened.document.rows[0]).status, "match");
    assert.equal(referenceCheckForRow(recorded, reopened.document.rows[1]).status, "match");
    assert.equal(referenceCheckForRow(recorded, reopened.document.rows[2]).status, "mismatch");
    assert.equal(recorded.batches[0].document!.records[1].context!.sequence.length, 33);
    const files = await analysisFiles(input);
    const corrupted = await Promise.all(files.map(async file => {
      if (file.name !== "reference-checks.json") return file;
      const value = JSON.parse(await file.data.text());
      value.batches[0].document.records[0].context.sequence_sha256 = "0".repeat(64);
      return { ...file, data: new Blob([JSON.stringify(value)]) };
    }));
    await assert.rejects(() => storedZip(corrupted, new Date(stamp)).then(importAnalysisPackage), /checksum/);
  } finally { globalThis.fetch = priorFetch; }
});
