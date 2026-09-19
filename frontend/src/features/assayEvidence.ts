import type { ResultRow } from "../api";
import { inspectTable } from "./columnMapping.ts";
import { candidateKey } from "./resultIdentity.ts";

export type EvidenceMatchMode = "pair-sequence" | "candidate-sequence" | "coordinates";
export interface EvidenceOptions {
  assay: string;
  sampleContext?: string;
  matchMode: EvidenceMatchMode;
  valueKind: "read_count" | "evidence_value";
  assembly?: "GRCh38" | "";
  coordinateSystem?: "0-based half-open" | "1-based inclusive" | "";
}
export interface EvidenceObservation {
  import_row_id: string;
  input_record: number;
  source_id?: string;
  value: number;
  target?: string;
  off_target?: string;
  chromosome?: string;
  start?: number;
  end?: number;
  strand?: "+" | "-";
  match_result_indices: number[];
  status: "matched" | "ambiguous" | "unmatched";
  duplicate_of?: string;
}
export interface RowEvidence {
  result_index: number;
  candidate_key: string;
  observation_ids: string[];
  positive_observation_ids: string[];
  zero_observation_ids: string[];
  ambiguous_observation_ids: string[];
}
export interface EvidenceState {
  schema_version: "1.0";
  metadata: {
    assay: string;
    sample_context: string;
    match_mode: EvidenceMatchMode;
    value_kind: EvidenceOptions["valueKind"];
    assembly?: "GRCh38";
    source_coordinate_system?: EvidenceOptions["coordinateSystem"];
    stored_coordinate_system?: "0-based half-open";
    source_filename?: string;
    source_sha256?: string;
    hash_basis?: "original_file_bytes" | "UTF-8 text";
    hash_status?: "available" | "unavailable";
    imported_at?: string;
    interpretation: string;
  };
  observations: EvidenceObservation[];
  per_row: RowEvidence[];
  summary: {
    input_observations: number;
    matched_observations: number;
    ambiguous_observations: number;
    unmatched_observations: number;
    duplicate_observations: number;
    positive_observations: number;
    zero_observations: number;
    prediction_rows_with_observations: number;
    prediction_rows_without_observations: number;
  };
}
export interface EvidencePreview {
  canApply: boolean;
  inputRows: number;
  issues: { row: number | null; message: string }[];
  state: EvidenceState | null;
}
export const EVIDENCE_MAX_BYTES = 5 * 1024 * 1024;
const MAX_MATCH_LINKS = 250_000;
const INTERPRETATION = "User-supplied experimental observations are separate from predictions. Positive values are observed evidence in the stated assay context. Zero values and rows without an imported observation are not true negatives. Multiple possible matches remain ambiguous. Duplicate observations are preserved; values are never summed and no accuracy metric is calculated.";

function textField(value: string, label: string, max: number): string {
  const text = value.trim();
  if (text.length > max || /[\x00-\x1f\x7f]/.test(text))
    throw new Error(`${label} needs at most ${max} printable characters.`);
  return text;
}
function dna(value: string, label: string): string {
  const sequence = value.trim().toUpperCase();
  if (!/^[ACGT]{23}$/.test(sequence))
    throw new Error(`${label} requires 23 actual A/C/G/T bases including its PAM, in guide orientation. Gaps, N and 20-nt spacers are not accepted.`);
  return sequence;
}
function chromosome(value: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/.test(value))
    throw new Error("Chromosome must be a plain chromosome/contig name.");
  const canonical = value.replace(/^chr/, "");
  if (/^(?:[1-9]|1\d|2[0-2]|X|Y)$/.test(canonical)) return canonical;
  if (canonical === "M" || canonical === "MT") return "MT";
  return value;
}
function integer(value: string, label: string): number {
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) > 2_147_483_647)
    throw new Error(`${label} must be an integer within the GRCh38 coordinate range.`);
  return Number(value);
}
function numericValue(value: string, kind: EvidenceOptions["valueKind"]): number {
  if (!/^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value))
    throw new Error("value must be a finite, nonnegative number.");
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || (number === 0 && /[1-9]/.test(value.split(/[eE]/, 1)[0])) || (kind === "read_count" && !Number.isSafeInteger(number)))
    throw new Error(kind === "read_count" ? "Read counts must be nonnegative safe integers." : "value must be a finite, nonnegative number.");
  return number;
}
function keyForObservation(observation: EvidenceObservation, mode: EvidenceMatchMode): string {
  if (mode === "pair-sequence") return JSON.stringify([observation.target, observation.off_target]);
  if (mode === "candidate-sequence") return observation.off_target!;
  return JSON.stringify([chromosome(observation.chromosome!), observation.start, observation.end, observation.strand]);
}
function keyForResult(row: ResultRow, mode: EvidenceMatchMode): string | null {
  if (mode === "pair-sequence") return /^[ACGT]{23}$/.test(row.target.toUpperCase()) && /^[ACGT]{23}$/.test(row.off_target.toUpperCase()) ? JSON.stringify([row.target.toUpperCase(), row.off_target.toUpperCase()]) : null;
  if (mode === "candidate-sequence") return /^[ACGT]{23}$/.test(row.off_target.toUpperCase()) ? row.off_target.toUpperCase() : null;
  if (row.assembly !== "GRCh38" || !["0-based half-open", "0-based half-open, forward-reference coordinates"].includes(row.coordinate_system ?? "") ||
      !Number.isSafeInteger(row.start) || row.start! < 0 || !Number.isSafeInteger(row.end) || row.end! - row.start! !== 23 ||
      (row.strand !== "+" && row.strand !== "-") || !row.chromosome) return null;
  try { return JSON.stringify([chromosome(row.chromosome), row.start, row.end, row.strand]); }
  catch { return null; }
}

/** Browser-only matching: no network calls, score changes, inferred PAMs or negative labels. */
export function previewAssayEvidence(text: string, options: EvidenceOptions, rows: ResultRow[]): EvidencePreview {
  const result: EvidencePreview = { canApply: false, inputRows: 0, issues: [], state: null };
  const issue = (row: number | null, error: unknown) => result.issues.push({ row, message: error instanceof Error ? error.message : String(error) });
  let assay = "", sampleContext = "";
  try {
    assay = textField(options.assay, "Assay name", 120);
    if (!assay) throw new Error("Enter the assay name (for example GUIDE-seq) before previewing.");
    sampleContext = textField(options.sampleContext ?? "", "Sample context", 500);
    if (!["pair-sequence", "candidate-sequence", "coordinates"].includes(options.matchMode)) throw new Error("Choose an explicit matching method.");
    if (!["read_count", "evidence_value"].includes(options.valueKind)) throw new Error("Declare read count or evidence value.");
    if (options.matchMode === "coordinates" && (options.assembly !== "GRCh38" || !["0-based half-open", "1-based inclusive"].includes(options.coordinateSystem ?? "")))
      throw new Error("Coordinate matching requires explicit GRCh38 and coordinate convention declarations.");
    if (rows.length > 50_000) throw new Error("At most 50,000 prediction rows are supported.");
  } catch (error) { issue(null, error); }
  const table = inspectTable(text, { maxRows: 10_000, maxRequestBytes: EVIDENCE_MAX_BYTES });
  result.inputRows = table.rows.length;
  table.errors.forEach((error) => issue(null, error));
  if (result.issues.length) return result;
  const headers = table.headers.map((name) => name.trim());
  const required = options.matchMode === "pair-sequence" ? ["target", "off_target", "value"] : options.matchMode === "candidate-sequence" ? ["off_target", "value"] : ["chromosome", "start", "end", "strand", "value"];
  const allowed = new Set([...required, "id", ...(options.matchMode === "coordinates" ? ["target"] : [])]);
  const missing = required.filter((name) => !headers.includes(name));
  const unknown = headers.filter((name) => !allowed.has(name));
  if (missing.length) issue(null, `Missing columns: ${missing.join(", ")}. Use the documented generic observation format.`);
  if (unknown.length) issue(null, `Unsupported columns: ${unknown.join(", ")}. Export only the documented observation columns; native assay formats are not guessed.`);
  if (new Set(headers).size !== headers.length) issue(null, "Column names must be unique.");
  if (!table.rows.length) issue(null, "The table contains no observations.");
  if (result.issues.length) return result;
  const observations: EvidenceObservation[] = [];
  table.rows.forEach((cells, index) => {
    try {
      if (cells.length !== headers.length) throw new Error(`Expected ${headers.length} columns, found ${cells.length}.`);
      const record = Object.fromEntries(headers.map((name, column) => [name, cells[column].trim()]));
      const observation: EvidenceObservation = {
        import_row_id: `observation-${index + 1}`, input_record: index + 1,
        value: numericValue(record.value, options.valueKind), match_result_indices: [], status: "unmatched",
      };
      if (record.id) observation.source_id = textField(record.id, "Observation id", 200);
      if (options.matchMode !== "coordinates") observation.off_target = dna(record.off_target, "off_target");
      if (options.matchMode === "pair-sequence" || record.target) observation.target = dna(record.target, "target");
      if (options.matchMode === "coordinates") {
        chromosome(record.chromosome); // Validate but retain the user's original spelling.
        observation.chromosome = record.chromosome;
        observation.start = integer(record.start, "start") - (options.coordinateSystem === "1-based inclusive" ? 1 : 0);
        observation.end = integer(record.end, "end");
        if (observation.start < 0 || observation.end - observation.start !== 23) throw new Error("The declared interval must cover all 23 bases, including the PAM. Cleavage-site positions and assay peaks need conversion before import.");
        if (record.strand !== "+" && record.strand !== "-") throw new Error("strand must be '+' or '-'; it is never inferred.");
        observation.strand = record.strand;
      }
      observations.push(observation);
    } catch (error) { issue(index + 1, error); }
  });
  // A bad row blocks the entire import; nothing is silently dropped.
  if (result.issues.length) return result;
  const index = new Map<string, number[]>();
  rows.forEach((row, resultIndex) => {
    const key = keyForResult(row, options.matchMode);
    if (key === null) return;
    if (!index.has(key)) index.set(key, []);
    index.get(key)!.push(resultIndex);
  });
  const perRow = new Map<number, RowEvidence>(), duplicateKeys = new Map<string, string>();
  let matchLinks = 0;
  for (const observation of observations) {
    const key = keyForObservation(observation, options.matchMode);
    const matches = index.get(key) ?? [];
    const matching = options.matchMode === "coordinates" && observation.target ? matches.filter((rowIndex) => rows[rowIndex].target.toUpperCase() === observation.target) : matches;
    matchLinks += matching.length;
    if (matchLinks > MAX_MATCH_LINKS) {
      issue(null, "More than 250,000 possible observation-to-result matches. No import was applied. Use guide + candidate matching or split the observations to reduce ambiguity.");
      return result;
    }
    observation.match_result_indices = [...matching];
    observation.status = matching.length === 0 ? "unmatched" : matching.length > 1 ? "ambiguous" : "matched";
    const duplicateKey = JSON.stringify([key, observation.target ?? "", observation.value]);
    observation.duplicate_of = duplicateKeys.get(duplicateKey);
    if (!observation.duplicate_of) duplicateKeys.set(duplicateKey, observation.import_row_id);
    for (const resultIndex of matching) {
      let evidence = perRow.get(resultIndex);
      if (!evidence) {
        evidence = { result_index: resultIndex, candidate_key: candidateKey(rows[resultIndex]), observation_ids: [], positive_observation_ids: [], zero_observation_ids: [], ambiguous_observation_ids: [] };
        perRow.set(resultIndex, evidence);
      }
      evidence.observation_ids.push(observation.import_row_id);
      (observation.value > 0 ? evidence.positive_observation_ids : evidence.zero_observation_ids).push(observation.import_row_id);
      if (observation.status === "ambiguous") evidence.ambiguous_observation_ids.push(observation.import_row_id);
    }
  }
  result.state = {
    schema_version: "1.0",
    metadata: {
      assay, sample_context: sampleContext, match_mode: options.matchMode, value_kind: options.valueKind,
      ...(options.matchMode === "coordinates" ? { assembly: "GRCh38", source_coordinate_system: options.coordinateSystem, stored_coordinate_system: "0-based half-open" } as const : {}),
      interpretation: INTERPRETATION,
    }, observations, per_row: [...perRow.values()].sort((a, b) => a.result_index - b.result_index),
    summary: {
      input_observations: observations.length,
      matched_observations: observations.filter((entry) => entry.status === "matched").length,
      ambiguous_observations: observations.filter((entry) => entry.status === "ambiguous").length,
      unmatched_observations: observations.filter((entry) => entry.status === "unmatched").length,
      duplicate_observations: observations.filter((entry) => entry.duplicate_of).length,
      positive_observations: observations.filter((entry) => entry.value > 0).length,
      zero_observations: observations.filter((entry) => entry.value === 0).length,
      prediction_rows_with_observations: perRow.size,
      prediction_rows_without_observations: rows.length - perRow.size,
    },
  };
  result.canApply = true;
  return result;
}

/** Hash the exact imported text when browser cryptography is available; failure never changes matching. */
export async function hashEvidenceText(text: string): Promise<string | undefined> {
  return hashEvidenceBytes(new TextEncoder().encode(text).buffer);
}

export async function hashEvidenceBytes(bytes: ArrayBuffer): Promise<string | undefined> {
  try {
    if (!globalThis.crypto?.subtle) return undefined;
    const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  } catch { return undefined; }
}

export const SYNTHETIC_ASSAY_EVIDENCE = {
  "pair-sequence": "id,target,off_target,value\nsynthetic-observation,GATGCTCTCCAGAATCACTGCGG,GTTGCTCTTCAGAATCACTGAGG,12\nsynthetic-zero,GATGCTCTCCAGAATCACTGCGG,GATGCTCTCCAGAATCACTGCGG,0\n",
  "candidate-sequence": "id,off_target,value\nsynthetic-observation,GTTGCTCTTCAGAATCACTGAGG,12\n",
  coordinates: "id,chromosome,start,end,strand,value\nsynthetic-observation,chr1,100,123,+,12\n",
} satisfies Record<EvidenceMatchMode, string>;
