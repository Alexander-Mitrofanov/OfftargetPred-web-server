import type { ModelId, ResultRow, Submission } from "../api.ts";

export const SENSITIVITY_SCHEMA = "candidate-substitution-v1";
export const SENSITIVITY_COUNT = 61;
export const SENSITIVITY_BASES = ["A", "C", "G", "T"] as const;
export type SensitivityBase = typeof SENSITIVITY_BASES[number];
export type SensitivityModel = `k${ModelId}`;

export interface SensitivityRow extends ResultRow {
  sensitivity_schema?: string;
  sensitivity_panel?: string;
  sensitivity_original_candidate?: string;
  sensitivity_position?: string;
  sensitivity_base?: string;
  sensitivity_original_base?: string;
  sensitivity_source_id?: string;
  sensitivity_source_row?: string;
}
export interface SensitivityPanel {
  panelId: string;
  target: string;
  originalCandidate: string;
  baseline: SensitivityRow;
  variants: Map<string, SensitivityRow>;
  models: SensitivityModel[];
}
export type SensitivityInspection = { status: "absent" } | { status: "invalid"; reason: string } | { status: "valid"; panel: SensitivityPanel };
export interface SensitivityCell { original: boolean; score: number | null; baseline: number | null; delta: number | null }

const sequencePattern = /^[ACGT]{23}$/;
const keys = ["id", "guide_id", "target", "off_target", "sensitivity_schema", "sensitivity_panel", "sensitivity_original_candidate", "sensitivity_position", "sensitivity_base", "sensitivity_original_base", "sensitivity_source_id", "sensitivity_source_row"] as const;
const models: SensitivityModel[] = ["k1", "k2", "k3"];

export function sensitivityEligibility(row: ResultRow): string | null {
  if (!sequencePattern.test(row.target) || !sequencePattern.test(row.off_target)) return "Sequence sensitivity requires a guide and candidate of exactly 23 unambiguous A/C/G/T bases, including their actual PAMs. N bases and gaps are unsupported.";
  return null;
}

function panelId(target: string, candidate: string): string { return `sens-v1-${target}-${candidate}`; }
function variantId(panel: string, position: number, base: string): string { return `${panel}-p${String(position).padStart(2, "0")}-${base}`; }
function csvCell(value: unknown): string {
  const text = String(value ?? "");
  // Keep user-provided source identifiers inert in spreadsheet programs.
  const safe = /^[\s]*[=+@-]/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

/** One original candidate and every single substitution in its 20 nt protospacer. */
export function sensitivityRows(source: ResultRow): SensitivityRow[] {
  const reason = sensitivityEligibility(source);
  if (reason) throw new Error(reason);
  const panel = panelId(source.target, source.off_target);
  const make = (position: number, base: string): SensitivityRow => ({
    id: variantId(panel, position, base), guide_id: "sensitivity-guide", target: source.target,
    off_target: position === 0 ? source.off_target : source.off_target.slice(0, position - 1) + base + source.off_target.slice(position),
    scores: {}, sensitivity_schema: SENSITIVITY_SCHEMA, sensitivity_panel: panel,
    sensitivity_original_candidate: source.off_target, sensitivity_position: String(position),
    sensitivity_base: base, sensitivity_original_base: position === 0 ? "original" : source.off_target[position - 1],
    sensitivity_source_id: String(source.id), sensitivity_source_row: source.row_index === undefined ? "" : String(source.row_index),
  });
  const rows = [make(0, "original")];
  for (let position = 1; position <= 20; position++) for (const base of SENSITIVITY_BASES) {
    if (base !== source.off_target[position - 1]) rows.push(make(position, base));
  }
  return rows;
}

/** Prefill only. The caller must let the researcher review and submit the ordinary pair job. */
export function prepareSensitivity(source: ResultRow, requested?: ModelId[]): Submission {
  const selected = requested ?? ([1, 2, 3] as ModelId[]).filter(id => sensitivityScore(source, `k${id}`) !== null);
  if (!selected.length || new Set(selected).size !== selected.length || selected.some(id => ![1, 2, 3].includes(id))) throw new Error("Choose at least one distinct CRISPert model for the sensitivity panel.");
  const rows = sensitivityRows(source);
  return {
    mode: "pairs", format: "csv", models: [...selected], name: "Single-base sequence sensitivity",
    input: [keys.join(","), ...rows.map(row => keys.map(key => csvCell(row[key])).join(","))].join("\n"),
  };
}

export function sensitivityScore(row: ResultRow, model: SensitivityModel): number | null {
  const value = row.scores?.[model];
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1 ? value : null;
}

/** Structural validation is deliberately independent of supplied score values and row order.
 * It establishes a complete sequence panel, not authenticity of externally edited scores.
 */
export function inspectSensitivity(rows: ResultRow[]): SensitivityInspection {
  const marked = rows as SensitivityRow[];
  if (!marked.some(row => Object.keys(row).some(key => key.startsWith("sensitivity_")))) return { status: "absent" };
  const invalid = (reason: string): SensitivityInspection => ({ status: "invalid", reason });
  if (rows.length !== SENSITIVITY_COUNT) return invalid("A sensitivity result must contain exactly 61 rows: one original and 60 single-base substitutions. Use the complete, unfiltered result document.");
  const baselineRows = marked.filter(row => row.sensitivity_position === "0");
  if (baselineRows.length !== 1) return invalid("The panel needs exactly one labelled original candidate.");
  const baseline = baselineRows[0];
  if (sensitivityEligibility(baseline)) return invalid("The original guide or candidate contains an unsupported sequence.");
  const panel = panelId(baseline.target, baseline.off_target);
  const expected = sensitivityRows(baseline);
  const expectedById = new Map(expected.map(row => [row.id, row]));
  const seen = new Set<string | number>(), variants = new Map<string, SensitivityRow>();
  for (const row of marked) {
    const expectedRow = expectedById.get(row.id);
    if (!expectedRow || seen.has(row.id)) return invalid("The panel contains a duplicate, missing or incorrectly labelled sequence substitution.");
    seen.add(row.id);
    for (const key of ["target", "off_target", "guide_id", "sensitivity_schema", "sensitivity_panel", "sensitivity_original_candidate", "sensitivity_position", "sensitivity_base", "sensitivity_original_base"] as const) {
      if (row[key] !== expectedRow[key]) return invalid("The panel labels disagree with the guide, original candidate or exact single-base substitutions. Recreate the panel from one result row.");
    }
    for (const key of ["sensitivity_source_id", "sensitivity_source_row"] as const) {
      if (typeof row[key] !== "string" || row[key] !== baseline[key]) return invalid("The panel has inconsistent source-row provenance.");
    }
    if ([row.chromosome, row.start, row.end, row.position, row.strand, row.assembly, row.coordinate_system].some(value => value !== undefined && value !== null && value !== "") || row.user_selected_locus === true || row.annotations?.status === "annotated") return invalid("Synthetic sensitivity sequences must not carry genomic coordinates, a designated target locus or genomic annotation claims.");
    if (row.sensitivity_position !== "0") variants.set(`${row.sensitivity_position}:${row.sensitivity_base}`, row);
  }
  return { status: "valid", panel: { panelId: panel, target: baseline.target, originalCandidate: baseline.off_target, baseline, variants, models: models.filter(model => marked.some(row => sensitivityScore(row, model) !== null)) } };
}

export function sensitivityCell(panel: SensitivityPanel, position: number, base: SensitivityBase, model: SensitivityModel): SensitivityCell {
  if (!Number.isInteger(position) || position < 1 || position > 20 || !SENSITIVITY_BASES.includes(base)) throw new Error("Choose a protospacer position from 1 to 20 and an A/C/G/T base.");
  const original = panel.originalCandidate[position - 1] === base;
  const row = original ? panel.baseline : panel.variants.get(`${position}:${base}`);
  const score = row ? sensitivityScore(row, model) : null;
  const baseline = sensitivityScore(panel.baseline, model);
  return { original, score, baseline, delta: score !== null && baseline !== null ? score - baseline : null };
}
