import assert from "node:assert/strict";
import test from "node:test";
import type { ResultRow } from "../../frontend/src/api.ts";
import { candidateKey, guideKey } from "../../frontend/src/features/resultIdentity.ts";
import { compareGuide, comparisonGuides, comparisonScore, comparisonTableRows, rankCandidates, spearmanForRows } from "../../frontend/src/features/comparison.ts";

const sequence = "A".repeat(20) + "AGG";
const row = (index: number, scores: ResultRow["scores"], patch: Partial<ResultRow> = {}): ResultRow => ({ id: "duplicate-id", row_index: index, guide_id: "guide-1", target: sequence, off_target: sequence, scores, ...patch });
const close = (actual: number | null, expected: number) => { assert.notEqual(actual, null); assert.ok(Math.abs(actual! - expected) < 1e-12, `${actual} should be ${expected}`); };

test("independent descending ranks retain every tied row with deterministic average ranks", () => {
  const rows = [row(3, { k1: -1 }), row(2, { k1: 8 }), row(0, { k1: 10 }), row(1, { k1: 8 })];
  const ranks = rankCandidates(rows, "k1");
  assert.deepEqual(ranks.map(item => [item.row.row_index, item.rank, item.firstRank, item.lastRank]), [[0, 1, 1, 1], [1, 2.5, 2, 3], [2, 2.5, 2, 3], [3, 4, 4, 4]]);
  assert.deepEqual(rankCandidates([...rows].reverse(), "k1"), ranks);
  assert.deepEqual(rows.map(item => item.row_index), [3, 2, 0, 1]);
});

test("missing, null and nonfinite scores are unavailable, while zero and negative scores are valid", () => {
  const rows = [row(0, { k1: 0 }), row(1, {}), row(2, { k1: NaN }), row(3, { k1: Infinity }), row(4, { k1: -2 }), row(5, {}, { baselines: { cfd: { score: null, reason: "N", version: "x" } } })];
  assert.deepEqual(rankCandidates(rows, "k1").map(item => item.row.row_index), [0, 4]);
  assert.equal(comparisonScore(rows[5], "cfd"), null);
  assert.equal(comparisonScore(row(6, {}, { baselines: { cfd: { score: 0, version: "x" } } }), "cfd"), 0);
  const compared = compareGuide(rows, guideKey(rows[0]), "k1", "k2");
  assert.equal(compared.missingA, 4);
  assert.equal(compared.missingB, 6);
  assert.equal(compared.candidates.length, 6);
});

test("Spearman reranks the shared subset; full-universe table ranks stay independent", () => {
  const rows = [row(0, { k1: 10 }), row(1, { k1: 9, k2: -5 }), row(2, { k1: 8, k2: -6 }), row(3, { k1: 7, k2: -7 }), row(4, { k2: 1000 })];
  const compared = compareGuide(rows, guideKey(rows[0]), "k1", "k2");
  close(compared.correlation.value, 1);
  assert.equal(compared.correlation.n, 3);
  assert.equal(compared.candidates[1].a?.rank, 2);
  assert.equal(compared.candidates[1].b?.rank, 2);
  assert.equal(compared.candidates[0].delta, null);
});

test("Spearman uses tied midranks and matches hand-computed Pearson correlation of ranks", () => {
  // k1 ranks: 1.5,1.5,3,4; k2 ranks: 1,2.5,2.5,4.
  // Centered cross-products sum to 3.75; squared sums are 4.5 and 4.5.
  const rows = [row(0, { k1: 4, k2: 4 }), row(1, { k1: 4, k2: 3 }), row(2, { k1: 2, k2: 3 }), row(3, { k1: 1, k2: 1 })];
  close(spearmanForRows(rows, "k1", "k2").value, 5 / 6);
  const compared = compareGuide(rows, guideKey(rows[0]), "k1", "k2");
  assert.equal(compared.tiedA, 2);
  assert.equal(compared.tiedB, 2);
});

test("Spearman is descriptive and undefined for small or constant jointly scored sets", () => {
  const two = [row(0, { k1: 10, k2: 3 }), row(1, { k1: 20, k2: 4 })];
  assert.deepEqual(spearmanForRows(two, "k1", "k2"), { value: null, n: 2, reason: "fewer_than_three_pairs" });
  const constant = [row(0, { k1: 1, k2: 3 }), row(1, { k1: 1, k2: 4 }), row(2, { k1: 1, k2: 5 })];
  assert.deepEqual(spearmanForRows(constant, "k1", "k2"), { value: null, n: 3, reason: "constant_ranks" });
});

test("rank comparisons are unchanged by strictly increasing transformations of either score scale", () => {
  const rows = [row(0, { k1: 1, k2: 7 }), row(1, { k1: 4, k2: 6 }), row(2, { k1: 3, k2: 5 }), row(3, { k1: 2, k2: 8 })];
  const transformed = rows.map(item => ({ ...item, scores: { k1: item.scores.k1! ** 3 + 100, k2: Math.exp(item.scores.k2!) } }));
  const a = compareGuide(rows, guideKey(rows[0]), "k1", "k2", 2), b = compareGuide(transformed, guideKey(rows[0]), "k1", "k2", 2);
  close(a.correlation.value, b.correlation.value!);
  assert.deepEqual(a.candidates.map(item => [item.a?.rank, item.b?.rank, item.delta]), b.candidates.map(item => [item.a?.rank, item.b?.rank, item.delta]));
  assert.equal(a.intersection, b.intersection);
});

test("top N includes all ties at the cutoff and reports exact per-model set/intersection counts", () => {
  const rows = [row(0, { k1: 10, k2: 1 }), row(1, { k1: 9, k2: 10 }), row(2, { k1: 9, k2: 8 }), row(3, { k1: 9, k2: 2 }), row(4, { k1: 1, k2: 9 })];
  const result = compareGuide(rows, guideKey(rows[0]), "k1", "k2", 2);
  assert.equal(result.topCountA, 4);
  assert.equal(result.topCountB, 2);
  assert.equal(result.intersection, 1);
  assert.equal(result.union, 5);
  assert.equal(result.candidates[2].a?.rank, 3); // Midrank > N is still included: its tie spans N.
  assert.equal(result.candidates[2].topA, true);
  assert.equal(comparisonTableRows(result.candidates, "top").length, 5);
});

test("guide selection uses ID and target and never silently aggregates all guides", () => {
  const rows = [row(0, { k1: 4, k2: 5 }), row(1, { k1: 3, k2: 4 }), row(2, { k1: 100, k2: 100 }, { guide_id: "guide-2" }), row(3, { k1: 1000, k2: 1000 }, { target: "C" + sequence.slice(1) })];
  assert.deepEqual(comparisonGuides(rows).map(item => item.count), [2, 1, 1]);
  assert.equal(compareGuide(rows, "", "k1", "k2").total, 0);
  assert.equal(compareGuide(rows, "missing", "k1", "k2").total, 0);
  const result = compareGuide(rows, guideKey(rows[0]), "k1", "k2");
  assert.equal(result.total, 2);
  assert.equal(result.candidates[0].a?.rank, 1);
});

test("CFD remains a separate optional ranking and unsupported rows do not become zero", () => {
  const rows = [row(0, { k1: 10 }, { baselines: { cfd: { score: 0, version: "x" } } }), row(1, { k1: 1 }, { baselines: { cfd: { score: 1, version: "x" } } }), row(2, { k1: 5 }, { baselines: { cfd: { score: 0.5, version: "x" } } }), row(3, { k1: 100 })];
  const result = compareGuide(rows, guideKey(rows[0]), "k1", "cfd", 1);
  close(result.correlation.value, -1);
  assert.equal(result.correlation.n, 3);
  assert.equal(result.missingB, 1);
  assert.equal(result.topCountB, 1);
  assert.equal(result.intersection, 0);
});

test("disagreement sorting retains missing rows at the end and preserves selected stable identities", () => {
  const rows = [row(0, { k1: 3, k2: 1 }), row(1, { k1: 2, k2: 2 }), row(2, { k1: 1, k2: 3 }), row(3, {})];
  const result = compareGuide(rows, guideKey(rows[0]), "k1", "k2");
  const ordered = comparisonTableRows(result.candidates, "disagreement");
  assert.deepEqual(ordered.map(item => item.row.row_index), [0, 2, 1, 3]);
  assert.deepEqual(ordered.map(item => item.delta), [-2, 2, 0, null]);
  assert.equal(new Set(ordered.map(item => item.key)).size, 4);
  assert.equal(ordered[2].key, candidateKey(rows[1]));
  assert.deepEqual(result.candidates.map(item => item.row.row_index), [0, 1, 2, 3]);
});

test("empty documents and unreasonable top N are safely bounded", () => {
  const empty = compareGuide([], "", "k1", "k2");
  assert.equal(empty.total, 0);
  assert.equal(empty.correlation.value, null);
  assert.equal(empty.intersection, 0);
  assert.deepEqual(comparisonTableRows([], "all"), []);
  assert.equal(compareGuide([], "", "k1", "k2", 1000).topN, 100);
  assert.equal(compareGuide([], "", "k1", "k2", -5).topN, 1);
  assert.equal(compareGuide([], "", "k1", "k2", NaN).topN, 10);
});

test("the full 50,000-row universe determines ranks even when only one table page is visible", () => {
  const rows = Array.from({ length: 50_000 }, (_, index) => row(index, { k1: index, k2: 49_999 - index }));
  const result = compareGuide(rows, guideKey(rows[0]), "k1", "k2", 10);
  assert.equal(result.total, 50_000);
  assert.equal(result.correlation.n, 50_000);
  close(result.correlation.value, -1);
  assert.equal(result.intersection, 0);
  assert.equal(result.union, 20);
  assert.equal(result.candidates[0].a?.rank, 50_000);
  assert.equal(comparisonTableRows(result.candidates, "top").length, 20);
});
