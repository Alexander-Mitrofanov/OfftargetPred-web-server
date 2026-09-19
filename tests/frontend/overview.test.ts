import assert from "node:assert/strict";
import test from "node:test";
import type { ResultRow } from "../../frontend/src/api.ts";
import { guideKey } from "../../frontend/src/features/resultIdentity.ts";
import {
  countRowsByGuide,
  createOverviewFilters,
  exactSequenceMatch,
  filterOverviewRows,
  overviewScope,
  protospacerMismatches,
  summarizeOverview,
} from "../../frontend/src/features/overview.ts";

const sequence = "A".repeat(20) + "AGG";
test("submitted genome guides with zero hits remain in the overview", () => {
  const overview = summarizeOverview([], [{ id: "zero", target: sequence }]);
  assert.equal(overview.total, 0);
  assert.equal(overview.guides.length, 1);
  assert.equal(overview.guides[0].total, 0);
});
const row = (patch: Partial<ResultRow> = {}): ResultRow => ({
  id: "duplicate-id",
  row_index: 0,
  guide_id: "guide-1",
  target: sequence,
  off_target: sequence,
  scores: { k1: 0.2, k2: 0.2 },
  ...patch,
});
const rows: ResultRow[] = [
  row({
    annotations: {
      status: "annotated",
      features: [],
      categories: ["exon", "exon", "CDS"],
    },
  }),
  row({ row_index: 1 }),
  row({
    row_index: 2,
    guide_id: "guide-2",
    off_target: "C" + sequence.slice(1),
    annotations: {
      status: "annotated",
      features: [
        {
          gene_id: "ENSG1",
          gene_name: "TESTGENE",
          feature: "gene",
          start: 1,
          end: 2,
          strand: "+",
        },
      ],
      categories: ["intergenic"],
    },
  }),
  row({
    row_index: 3,
    target: "C" + sequence.slice(1),
    off_target: "N" + sequence.slice(1),
    mismatches: 0,
    annotations: { status: "no_coordinates", features: [], categories: [] },
  }),
  row({
    row_index: 4,
    target: "C" + sequence.slice(1),
    off_target: "C" + "A".repeat(19) + "NGG",
    annotations: {
      status: "unavailable",
      features: [],
      categories: ["intergenic"],
    },
  }),
];

test("guide identity uses ID and sequence; duplicate rows and tied scores remain counted", () => {
  const summary = summarizeOverview(rows);
  assert.equal(summary.total, 5);
  assert.equal(summary.guides.length, 3);
  assert.deepEqual(
    summary.guides.map((guide) => guide.total),
    [2, 1, 2],
  );
  assert.deepEqual(
    summary.guides.map((guide) => guide.id),
    ["guide-1", "guide-2", "guide-1"],
  );
  assert.deepEqual(filterOverviewRows(rows, createOverviewFilters()), rows);
  assert.equal(countRowsByGuide(rows).get(guideKey(rows[0])), 2);
});

test("histogram partitions all rows; ambiguous protospacer bases stay unknown", () => {
  const summary = summarizeOverview(rows);
  assert.equal(summary.mismatches[0], 3);
  assert.equal(summary.mismatches[1], 1);
  assert.equal(summary.unknownMismatches, 1);
  assert.equal(
    summary.mismatches.reduce((sum, value) => sum + value, 0) +
      summary.unknownMismatches,
    rows.length,
  );
  assert.equal(protospacerMismatches(rows[3]), null); // Stored zero must not hide N.
  assert.equal(protospacerMismatches(rows[4]), 0); // PAM N is outside protospacer.
  assert.equal(protospacerMismatches(row({ target: "ACG" })), null);
});

test("annotation categories are per-row memberships and unavailable never becomes intergenic", () => {
  const summary = summarizeOverview(rows);
  assert.equal(summary.annotated, 2);
  assert.equal(summary.unavailable, 2);
  assert.equal(summary.noCoordinates, 1);
  assert.equal(summary.categories.get("exon"), 1);
  assert.equal(summary.categories.get("intergenic"), 1);
  assert.deepEqual(
    filterOverviewRows(rows, {
      ...createOverviewFilters(),
      annotation: "category:intergenic",
    }),
    [rows[2]],
  );
  assert.deepEqual(
    filterOverviewRows(rows, {
      ...createOverviewFilters(),
      annotation: "status:unavailable",
    }),
    [rows[1], rows[4]],
  );
});

test("mismatch range retains unknowns unless explicitly excluded; combining filters keeps exact totals", () => {
  const filters = {
    ...createOverviewFilters(),
    minMismatches: 1,
    maxMismatches: 1,
  };
  assert.deepEqual(filterOverviewRows(rows, filters), [rows[2], rows[3]]);
  assert.deepEqual(
    filterOverviewRows(rows, { ...filters, includeUnknownMismatches: false }),
    [rows[2]],
  );
  assert.deepEqual(
    filterOverviewRows(rows, {
      ...createOverviewFilters(),
      guideKey: guideKey(rows[0]),
    }),
    rows.slice(0, 2),
  );
  assert.deepEqual(
    filterOverviewRows(rows, { ...filters, query: " testgene " }),
    [rows[2]],
  );
  assert.equal(summarizeOverview(rows).total, 5); // Full universe is unaffected.
});

test("exact-match controls use all 23 known bases, keep unknowns when hiding, and never infer on-target", () => {
  assert.equal(exactSequenceMatch(rows[0]), true);
  assert.equal(exactSequenceMatch(rows[4]), null);
  assert.equal(
    exactSequenceMatch(row({ off_target: "A".repeat(20) + "TGG" })),
    false,
  );
  assert.equal(
    exactSequenceMatch(row({ off_target: sequence.toLowerCase() })),
    true,
  );
  assert.deepEqual(
    filterOverviewRows(rows, {
      ...createOverviewFilters(),
      exactMatch: "only",
    }),
    rows.slice(0, 2),
  );
  assert.deepEqual(
    filterOverviewRows(rows, {
      ...createOverviewFilters(),
      exactMatch: "hide",
    }),
    rows.slice(2),
  );
  assert.equal(summarizeOverview(rows).unknownExactMatches, 2);
});

test("empty results and absent annotations are valid; no guides are invented", () => {
  const summary = summarizeOverview([]);
  assert.equal(summary.total, 0);
  assert.deepEqual(summary.guides, []);
  assert.equal(summary.unknownMismatches, 0);
  assert.deepEqual(filterOverviewRows([], createOverviewFilters()), []);
  assert.equal(summarizeOverview([row()]).unavailable, 1);
});

test("scope is mode-specific and uses recorded reference boundaries", () => {
  assert.match(overviewScope("pairs", {}), /completeness is unknown/);
  const scope = overviewScope("genome", {
    reference: { assembly: "GRCh38", pam: "NGG", bulges: false },
    max_mismatches: 3,
  });
  assert.match(
    scope,
    /GRCh38.*NGG PAM.*up to 3 protospacer mismatches.*no bulges/,
  );
  assert.doesNotMatch(scope, /exhaustive|complete search/);
  assert.match(overviewScope("genome", {}), /Reference not recorded/);
});

test("50,000 rows preserve every row in full-document and per-guide totals", () => {
  const manyRows = Array.from({ length: 50_000 }, (_, index) =>
    row({
      row_index: index,
      guide_id: `guide-${index % 100}`,
      off_target: index % 2 ? "C" + sequence.slice(1) : sequence,
    }),
  );
  const summary = summarizeOverview(manyRows);
  assert.equal(summary.total, 50_000);
  assert.equal(summary.guides.length, 100);
  assert.equal(
    summary.guides.reduce((sum, guide) => sum + guide.total, 0),
    50_000,
  );
  const filtered = filterOverviewRows(manyRows, {
    ...createOverviewFilters(),
    exactMatch: "hide",
  });
  assert.equal(filtered.length, 25_000);
  assert.equal(countRowsByGuide(filtered).size, 50);
});
