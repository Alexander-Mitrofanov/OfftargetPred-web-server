import assert from "node:assert/strict";
import test from "node:test";
import type { ResultRow } from "../../frontend/src/api.ts";
import { candidateKey, guideKey } from "../../frontend/src/features/resultIdentity.ts";
import { applyShortlist, defaultShortlistRule, MAX_AUTOMATIC_SHORTLIST, planShortlist, reconcileSelectionNotes, shortlistGuideSummary } from "../../frontend/src/features/shortlist.ts";

const sequence = "A".repeat(20) + "AGG";
const row = (index: number, score: number | undefined, patch: Partial<ResultRow> = {}): ResultRow => ({ row_index: index, id: "repeated-id", guide_id: "guide-a", target: sequence, off_target: sequence, scores: score === undefined ? {} : { k1: score }, ...patch });
const rule = () => ({ ...defaultShortlistRule(), perGroup: 1 });

test("top N is ranked separately for every guide using all complete rows", () => {
  const rows = [row(0, 1), row(1, 9), row(2, 100, { guide_id: "guide-b" }), row(3, 200, { guide_id: "guide-b" })];
  const plan = planShortlist(rows, rule());
  assert.deepEqual(plan.rows.map(item => item.row_index), [1, 3]);
  assert.deepEqual(plan.groups.map(group => [group.eligible, group.proposed]), [[2, 1], [2, 1]]);
  assert.equal(plan.considered, 4);
  assert.deepEqual(rows.map(item => item.row_index), [0, 1, 2, 3]);
});

test("all cutoff ties are retained unless the explicit deterministic tie-break is chosen", () => {
  const rows = [row(3, 8), row(2, 10), row(0, 10), row(1, 10)];
  const allTies = planShortlist(rows, rule());
  assert.deepEqual(allTies.rows.map(item => item.row_index), [2, 0, 1]);
  assert.equal(allTies.groups[0].boundaryTie, 3);
  assert.equal(allTies.groups[0].proposed, 3);
  const exact = planShortlist(rows, { ...rule(), includeTies: false });
  assert.deepEqual(exact.rows.map(item => item.row_index), [0]);
  assert.deepEqual([...planShortlist([...rows].reverse(), { ...rule(), includeTies: false }).keys], [...exact.keys]);
  assert.match(exact.notes[candidateKey(rows[2])][0], /stable row identity/);
});

test("duplicate display IDs and same guide IDs with different sequences remain distinct", () => {
  const rows = [row(0, 2), row(1, 2), row(2, 2, { target: "C" + sequence.slice(1) })];
  const plan = planShortlist(rows, rule());
  assert.equal(plan.keys.size, 3);
  assert.equal(plan.groups.length, 2);
  assert.deepEqual(plan.rows, rows);
});

test("missing and nonfinite scores are excluded; zero and negative scores remain valid", () => {
  const rows = [row(0, undefined), row(1, NaN), row(2, Infinity), row(3, 0), row(4, -1)];
  const plan = planShortlist(rows, { ...rule(), perGroup: 10 });
  assert.deepEqual(plan.rows.map(item => item.row_index), [3, 4]);
  assert.equal(plan.missingScores, 3);
  const cfd = planShortlist([row(0, 100), row(1, 1, { baselines: { cfd: { score: 0, version: "test" } } }), row(2, 2, { baselines: { cfd: { score: null, version: "test" } } })], { ...rule(), model: "cfd" });
  assert.deepEqual(cfd.rows.map(item => item.row_index), [1]);
  assert.equal(cfd.missingScores, 2);
  assert.match(cfd.notes[candidateKey(cfd.rows[0])][0], /CFD baseline/);
});

test("intended-locus exclusion is opt-in and does not exclude other exact sequence matches", () => {
  const rows = [row(0, 10, { user_selected_locus: true, exact_match: true }), row(1, 9, { exact_match: true }), row(2, 8, { off_target: "C" + sequence.slice(1) })];
  assert.deepEqual(planShortlist(rows, rule()).rows.map(item => item.row_index), [0]);
  const excluded = planShortlist(rows, { ...rule(), excludeIntended: true });
  assert.deepEqual(excluded.rows.map(item => item.row_index), [1]);
  assert.equal(excluded.excludedIntended, 1);
  assert.match(excluded.notes[candidateKey(rows[1])][0], /excluded before ranking/);
});

test("mismatch strata exclude PAM mismatches and keep unknown bases in a separate group", () => {
  const rows = [row(0, 5), row(1, 4, { off_target: sequence.slice(0, 20) + "TGG" }), row(2, 1, { off_target: "C" + sequence.slice(1) }), row(3, 0, { off_target: "N" + sequence.slice(1) })];
  const plan = planShortlist(rows, { ...rule(), stratify: "mismatches" });
  assert.deepEqual(plan.rows.map(item => item.row_index), [0, 2, 3]);
  assert.deepEqual(plan.groups.map(group => group.stratum), ["0 protospacer mismatches", "1 protospacer mismatch", "unknown protospacer mismatch count"]);
});

test("overlapping annotation categories produce one selected row with multiple reasons", () => {
  const rows = [row(0, 5, { annotations: { status: "annotated", categories: ["CDS", "exon", "CDS"], features: [] } }), row(1, 4, { annotations: { status: "annotated", categories: ["exon"], features: [] } }), row(2, 1), row(3, 1, { annotations: { status: "no_coordinates", categories: [], features: [] } })];
  const plan = planShortlist(rows, { ...rule(), stratify: "annotation" });
  assert.equal(plan.keys.size, 3);
  assert.equal(plan.groups.length, 4);
  assert.equal(plan.notes[candidateKey(rows[0])].length, 2);
  assert.ok(plan.groups.some(group => group.stratum === "annotation unavailable"));
  assert.ok(plan.groups.some(group => group.stratum === "no genomic coordinates"));
  assert.ok(!plan.groups.some(group => group.stratum.includes("intergenic")));
});

test("per-group request is bounded and oversized ties are blocked rather than truncated", () => {
  assert.equal(planShortlist([], { ...rule(), perGroup: 1000 }).rule.perGroup, 100);
  assert.equal(planShortlist([], { ...rule(), perGroup: -5 }).rule.perGroup, 1);
  assert.equal(planShortlist([], { ...rule(), perGroup: 2.5 }).rule.perGroup, 2);
  assert.equal(planShortlist([], { ...rule(), perGroup: NaN }).rule.perGroup, 10);
  const rows = Array.from({ length: MAX_AUTOMATIC_SHORTLIST + 1 }, (_, i) => row(i, 1));
  const plan = planShortlist(rows, rule());
  assert.equal(plan.keys.size, rows.length);
  assert.equal(plan.blocked, true);
  const existing = new Set(["manual-key"]);
  assert.throws(() => applyShortlist(existing, plan, "replace"), /limited/);
  assert.deepEqual([...existing], ["manual-key"]);
});

test("add preserves manual candidates, replace is explicit, and notes survive only current selection", () => {
  const rows = [row(0, 1), row(1, 5)];
  const manual = candidateKey(rows[0]), ranked = candidateKey(rows[1]);
  const selected = new Set([manual]), plan = planShortlist(rows, rule());
  const added = applyShortlist(selected, plan, "add");
  assert.deepEqual([...added], [manual, ranked]);
  assert.deepEqual([...selected], [manual]);
  const notes = reconcileSelectionNotes(added, reconcileSelectionNotes(selected, {}), plan.notes);
  assert.match(notes[manual][0], /Manually selected/);
  assert.match(notes[ranked][0], /top 1/);
  const replacement = applyShortlist(selected, plan, "replace");
  assert.deepEqual([...replacement], [ranked]);
  assert.deepEqual(Object.keys(reconcileSelectionNotes(replacement, notes)), [ranked]);
  assert.deepEqual(reconcileSelectionNotes(new Set(), notes), {});
  assert.deepEqual(reconcileSelectionNotes(added, notes, plan.notes), notes);
});

test("guide scope and selection summary use complete identities and preserve zero selections", () => {
  const rows = [row(0, 1), row(1, 5), row(2, 99, { guide_id: "guide-b" })];
  const plan = planShortlist(rows, { ...rule(), guide: guideKey(rows[0]) });
  assert.deepEqual(plan.rows.map(item => item.row_index), [1]);
  assert.equal(plan.considered, 2);
  assert.deepEqual(shortlistGuideSummary(rows, plan.keys).map(guide => [guide.available, guide.selected]), [[2, 1], [1, 0]]);
  assert.equal(planShortlist(rows, { ...rule(), guide: "absent" }).keys.size, 0);
  assert.deepEqual(shortlistGuideSummary([], new Set()), []);
});
