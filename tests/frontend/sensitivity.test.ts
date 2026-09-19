import assert from "node:assert/strict";
import test from "node:test";
import type { ResultRow } from "../../frontend/src/api.ts";
import { inspectSensitivity, prepareSensitivity, sensitivityCell, sensitivityEligibility, sensitivityRows, sensitivityScore, SENSITIVITY_BASES } from "../../frontend/src/features/sensitivity.ts";
import type { SensitivityRow } from "../../frontend/src/features/sensitivity.ts";

const source: ResultRow = { id: "public-reference-pair", row_index: 3, target: "TGAGACTCTTGCAGTCACACAGG", off_target: "TGAGACTCTTGCAGTCACACGGG", scores: { k1: .4, k2: .3, k3: .2 }, chromosome: "1", start: 100056, end: 100079, strand: "+", assembly: "GRCh38", coordinate_system: "0-based half-open", user_selected_locus: true, annotations: { status: "annotated", features: [], categories: ["intergenic"] } };
function scored(): SensitivityRow[] { return sensitivityRows(source).map((row, index) => ({ ...row, row_index: index + 1, scores: { k1: .4 + index / 1000, k2: .3 - index / 1000, k3: .2 } })); }
function valid(rows = scored()) { const inspected = inspectSensitivity(rows); assert.equal(inspected.status, "valid"); if (inspected.status !== "valid") throw new Error("Expected valid panel"); return inspected.panel; }
function invalid(change: (rows: SensitivityRow[]) => void) { const rows = scored(); change(rows); assert.equal(inspectSensitivity(rows).status, "invalid"); }

test("generate exactly 61 unique pairs with fixed guide and PAM and no genomic claims", () => {
  const rows = sensitivityRows(source);
  assert.equal(rows.length, 61); assert.equal(new Set(rows.map(row => row.id)).size, 61); assert.equal(new Set(rows.map(row => row.off_target)).size, 61);
  assert.equal(rows[0].off_target, source.off_target);
  for (const row of rows) {
    assert.equal(row.target, source.target); assert.equal(row.off_target.slice(20), source.off_target.slice(20));
    assert.equal(row.sensitivity_source_id, source.id); assert.equal(row.sensitivity_source_row, "3");
    for (const key of ["assembly", "chromosome", "start", "end", "position", "strand", "annotations", "user_selected_locus", "baselines"]) assert.ok(!(key in row));
    const differences = [...row.off_target].filter((base, index) => base !== source.off_target[index]).length;
    assert.equal(differences, row.sensitivity_position === "0" ? 0 : 1);
  }
  for (let position = 1; position <= 20; position++) assert.equal(rows.filter(row => row.sensitivity_position === String(position)).length, 3);
});

test("61-row submission preserves metadata as CSV and only selected scored models", () => {
  const submission = prepareSensitivity({ ...source, scores: { k1: .2, k3: .4 } });
  assert.equal(submission.mode, "pairs"); assert.equal(submission.format, "csv"); assert.deepEqual(submission.models, [1, 3]);
  assert.equal(submission.input.split("\n").length, 62); assert.ok(submission.input.startsWith("id,guide_id,target,off_target,sensitivity_schema,"));
  assert.ok(!("intended_loci" in submission)); assert.ok(!("assembly" in submission));
  assert.deepEqual(prepareSensitivity(source, [2]).models, [2]);
  assert.throws(() => prepareSensitivity(source, [])); assert.throws(() => prepareSensitivity(source, [1, 1]));
  assert.throws(() => prepareSensitivity(source, [4] as never)); assert.throws(() => prepareSensitivity({ ...source, scores: {} }));
});

test("source identifiers are CSV-escaped and spreadsheet-formula neutralized", () => {
  const input = prepareSensitivity({ ...source, id: '=HYPERLINK("https://invalid.example")' }).input;
  assert.ok(input.includes('"\'=HYPERLINK(""https://invalid.example"")"'));
  assert.ok(!input.includes('"=HYPERLINK('));
});

test("N, gaps, lowercase, RNA and wrong sequence lengths cannot define substitutions", () => {
  for (const sequence of ["N" + source.target.slice(1), source.target.toLowerCase(), source.target.slice(1), source.target + "A", "-" + source.target.slice(1), "U" + source.target.slice(1)]) {
    assert.ok(sensitivityEligibility({ ...source, target: sequence })); assert.throws(() => sensitivityRows({ ...source, target: sequence }));
    assert.ok(sensitivityEligibility({ ...source, off_target: sequence })); assert.throws(() => sensitivityRows({ ...source, off_target: sequence }));
  }
  assert.equal(sensitivityEligibility(source), null);
});

test("a complete panel is reconstructed regardless of result order", () => {
  const panel = valid(scored().reverse());
  assert.equal(panel.target, source.target); assert.equal(panel.originalCandidate, source.off_target); assert.equal(panel.variants.size, 60); assert.deepEqual(panel.models, ["k1", "k2", "k3"]);
  const cell = sensitivityCell(panel, 1, "A", "k1");
  assert.equal(cell.original, false); assert.ok(Math.abs(cell.delta! - .001) < 1e-12);
  assert.ok(Math.abs(sensitivityCell(panel, 1, "A", "k2").delta! + .001) < 1e-12);
  assert.equal(sensitivityCell(panel, 1, "A", "k3").delta, 0);
  for (let position = 1; position <= 20; position++) {
    const base = source.off_target[position - 1] as typeof SENSITIVITY_BASES[number];
    assert.deepEqual(sensitivityCell(panel, position, base, "k1"), { original: true, score: .4, baseline: .4, delta: 0 });
  }
});

test("ordinary results are absent while partial or mixed panels fail closed", () => {
  assert.deepEqual(inspectSensitivity([]), { status: "absent" }); assert.deepEqual(inspectSensitivity([source]), { status: "absent" });
  invalid(rows => { rows.pop(); }); invalid(rows => { rows.push({ ...source }); }); invalid(rows => { rows[60] = source; });
  invalid(rows => { delete rows[30].sensitivity_schema; }); invalid(rows => { rows[0].sensitivity_position = "1"; });
});

test("duplicate IDs, substitutions, baseline rows and matrix labels are rejected", () => {
  invalid(rows => { rows[60] = { ...rows[59] }; }); invalid(rows => { rows[60] = { ...rows[0] }; });
  invalid(rows => { rows[1].sensitivity_base = "T"; }); invalid(rows => { rows[1].sensitivity_position = "01"; });
  invalid(rows => { rows[1].sensitivity_original_base = "A"; }); invalid(rows => { rows[1].sensitivity_panel += "forged"; });
  invalid(rows => { rows[1].sensitivity_schema = "other"; }); invalid(rows => { rows[1].sensitivity_original_candidate = rows[1].off_target; });
  invalid(rows => { rows[1].id = "fake"; }); invalid(rows => { rows[1].guide_id = "other"; });
});

test("single-base labels cannot conceal changed guide, changed PAM or second substitution", () => {
  invalid(rows => { rows[1].target = "A" + rows[1].target.slice(1); });
  invalid(rows => { rows[1].off_target = rows[1].off_target.slice(0, 22) + "A"; });
  invalid(rows => { rows[1].off_target = rows[1].off_target.slice(0, 2) + "C" + rows[1].off_target.slice(3); });
  invalid(rows => { rows[0].off_target = "N" + rows[0].off_target.slice(1); });
});

test("source provenance must agree across all rows", () => {
  invalid(rows => { rows[2].sensitivity_source_id = "another"; }); invalid(rows => { rows[2].sensitivity_source_row = "400"; });
  invalid(rows => { delete rows[2].sensitivity_source_id; }); invalid(rows => { delete rows[2].sensitivity_source_row; });
});

test("synthetic sequence panels reject coordinates and genomic annotation claims", () => {
  invalid(rows => { rows[2].start = 0; }); invalid(rows => { rows[2].position = 0; }); invalid(rows => { rows[2].chromosome = "1"; });
  invalid(rows => { rows[2].assembly = "GRCh38"; }); invalid(rows => { rows[2].user_selected_locus = true; });
  invalid(rows => { rows[2].annotations = source.annotations; });
  const rows = scored().map(row => ({ ...row, annotations: { status: "no_coordinates" as const, features: [], categories: [] } }));
  assert.equal(inspectSensitivity(rows).status, "valid");
});

test("missing and nonfinite scores remain unavailable, including absent baseline", () => {
  const rows = scored(); rows[1].scores = { k1: NaN, k2: Infinity }; rows[0].scores = { k1: .4, k3: 0 };
  const panel = valid(rows);
  assert.equal(sensitivityCell(panel, 1, "A", "k1").delta, null); assert.equal(sensitivityCell(panel, 1, "A", "k2").delta, null);
  assert.equal(sensitivityCell(panel, 1, "T", "k2").delta, null); assert.equal(sensitivityCell(panel, 1, "T", "k3").delta, 0);
  assert.equal(sensitivityScore({ ...source, scores: { k1: -1 } }, "k1"), null); assert.equal(sensitivityScore({ ...source, scores: { k1: 2 } }, "k1"), null);
});

test("cell addressing is bounded to the protospacer and four DNA bases", () => {
  const panel = valid();
  for (const position of [0, -1, 21, 1.5, NaN]) assert.throws(() => sensitivityCell(panel, position, "A", "k1"));
  assert.throws(() => sensitivityCell(panel, 1, "N" as never, "k1"));
});
