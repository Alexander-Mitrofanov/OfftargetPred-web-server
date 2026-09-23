import type { AnalysisDocument, ModelId, ResultRow } from "../api.ts";
import { sanitizeForExport } from "./analysisExports.ts";
import type { ExportJobSummary, ExportOptions, WorkspaceViewState } from "./analysisExports.ts";
import { createOverviewFilters, filterOverviewRows } from "./overview.ts";
import { candidateKey } from "./resultIdentity.ts";
import { previewAssayEvidence } from "./assayEvidence.ts";
import type { EvidenceOptions, EvidenceState } from "./assayEvidence.ts";
import { validateReferenceChecks, verifyReferenceChecksIntegrity } from "./referenceChecks.ts";
import type { ReferenceCheckState } from "./referenceChecks.ts";

/** Browser memory bounds are deliberately lower than the writer's 2 GB ceiling. */
export const MAX_ANALYSIS_IMPORT_BYTES = 256 * 1024 * 1024;
export const MAX_ANALYSIS_JSON_BYTES = 128 * 1024 * 1024;
export const MAX_ANALYSIS_IMPORT_FILES = 32;
const MAX_ROWS = 60_000;
const MAX_JSON_DEPTH = 40;
const MAX_JSON_VALUES = 5_000_000;
const decoder = new TextDecoder("utf-8", { fatal: true });
const archiveNames = new Set([
  "provenance-settings.json", "results-full.json", "results-full.csv",
  "results-filtered.csv", "shortlist-selected.csv", "candidates-full.bed",
  "shortlist-selected.bed", "bed-skipped.json", "schema.json", "selection-notes.json",
  "experimental-evidence.json", "reference-checks.json", "report.html", "CITATION.cff",
  "LICENSE.txt", "THIRD_PARTY_NOTICES.md",
]);

export interface ImportedWorkspaceState extends WorkspaceViewState {
  selectedKeys: string[];
  selectionNotes: Record<string, string[]>;
  experimentalEvidence: EvidenceState | null;
  referenceChecks?: ReferenceCheckState;
}
export interface ImportedAnalysis {
  document: AnalysisDocument;
  job?: ExportJobSummary;
  state: ImportedWorkspaceState;
  savedAt: string;
  source: {
    exportSchemaVersion: "1.0" | "1.1";
    workspaceSchemaVersion?: "1.0";
    frontendBuild?: string;
    warnings: string[];
  };
}

function fail(message: string): never { throw new Error(`Cannot open analysis: ${message}`); }
function object(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${name} must be an object.`);
  return value as Record<string, unknown>;
}
function list(value: unknown, name: string, max = MAX_ROWS): unknown[] {
  if (!Array.isArray(value) || value.length > max) fail(`${name} must be an array of at most ${max.toLocaleString()} items.`);
  return value;
}
function text(value: unknown, name: string, max = 4096): string {
  if (typeof value !== "string" || value.length > max || value.includes("\u0000")) fail(`${name} must be bounded text.`);
  return value;
}
function integer(value: unknown, name: string, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > max) fail(`${name} must be a nonnegative safe integer.`);
  return value;
}
function finite(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) fail(`${name} must be a finite number.`);
  return value;
}
function bool(value: unknown, name: string): boolean {
  if (typeof value !== "boolean") fail(`${name} must be true or false.`);
  return value;
}
function oneOf<T extends string>(value: unknown, choices: readonly T[], name: string): T {
  if (typeof value !== "string" || !choices.includes(value as T)) fail(`${name} is unsupported.`);
  return value as T;
}
function timestamp(value: unknown, name: string): string {
  const result = text(value, name, 64);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(result) || !Number.isFinite(Date.parse(result))) fail(`${name} is invalid.`);
  return result;
}
function sequence(value: unknown, name: string, allowUnknown = true): string {
  const result = text(value, name, 23);
  if (!(allowUnknown ? /^[ACGTN]{23}$/ : /^[ACGT]{23}$/).test(result)) fail(`${name} requires exactly 23 uppercase DNA bases including the PAM.`);
  return result;
}
function cancelled(options: ExportOptions) {
  if (options.signal?.aborted) throw new DOMException("Opening analysis cancelled", "AbortError");
}
async function yieldBrowser(options: ExportOptions) {
  cancelled(options);
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  cancelled(options);
}

const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
async function crc32(bytes: Uint8Array, options: ExportOptions): Promise<number> {
  let crc = 0xffffffff;
  for (let start = 0; start < bytes.length; start += 1_048_576) {
    for (let i = start; i < Math.min(start + 1_048_576, bytes.length); i++) crc = crcTable[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    await yieldBrowser(options);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Reads only the exact flat ZIP32 STORE layout written by this app. No extraction or URL access. */
async function readArchive(file: Blob, options: ExportOptions): Promise<Map<string, Uint8Array>> {
  cancelled(options);
  if (file.size > MAX_ANALYSIS_IMPORT_BYTES) fail("the ZIP exceeds the 256 MiB opening limit. Its original downloads remain usable separately.");
  if (file.size < 22) fail("the file is not a complete analysis ZIP.");
  const buffer = await file.arrayBuffer(), bytes = new Uint8Array(buffer), view = new DataView(buffer);
  const range = (offset: number, size: number) => {
    if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(size) || offset < 0 || size < 0 || offset + size > bytes.length) fail("the ZIP has an out-of-range record.");
  };
  const u16 = (offset: number) => { range(offset, 2); return view.getUint16(offset, true); };
  const u32 = (offset: number) => { range(offset, 4); return view.getUint32(offset, true); };
  // Our writer has no comments, extras, data descriptors or multi-disk/ZIP64 records.
  const end = bytes.length - 22;
  if (u32(end) !== 0x06054b50 || u16(end + 20) !== 0 || u16(end + 4) !== 0 || u16(end + 6) !== 0) fail("only single-disk, comment-free ZIP32 analysis packages are supported.");
  const count = u16(end + 10), centralSize = u32(end + 12), centralOffset = u32(end + 16);
  if (!count || count > MAX_ANALYSIS_IMPORT_FILES || u16(end + 8) !== count) fail("the archive file count is invalid (maximum 32).");
  if (centralOffset + centralSize !== end) fail("the ZIP directory is inconsistent or uses unsupported extensions.");
  const files = new Map<string, Uint8Array>();
  let cursor = centralOffset, nextLocal = 0, totalBytes = 0;
  for (let index = 0; index < count; index++) {
    range(cursor, 46);
    if (u32(cursor) !== 0x02014b50) fail("the ZIP directory is corrupt.");
    const flags = u16(cursor + 8), method = u16(cursor + 10), crc = u32(cursor + 16);
    const size = u32(cursor + 24), nameLength = u16(cursor + 28), local = u32(cursor + 42);
    if (u16(cursor + 6) > 20 || (flags !== 0 && flags !== 0x800) || method !== 0 || u32(cursor + 20) !== size || u16(cursor + 30) || u16(cursor + 32) || u16(cursor + 34)) fail("compressed, encrypted, extended or multi-disk ZIP records are unsupported. Open the original OfftargetPred ZIP.");
    range(cursor + 46, nameLength);
    let name: string;
    try { name = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength)); }
    catch { fail("a ZIP filename is not valid UTF-8."); }
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(name) || !archiveNames.has(name)) fail("the ZIP contains an unsafe path or an unsupported file.");
    if (files.has(name)) fail(`the ZIP contains duplicate ${name} records.`);
    if (local !== nextLocal) fail("the ZIP contains overlapping, reordered or unaccounted file records.");
    range(local, 30 + nameLength);
    if (u32(local) !== 0x04034b50 || u16(local + 4) > 20 || u16(local + 6) !== flags || u16(local + 8) !== method || u32(local + 14) !== crc || u32(local + 18) !== size || u32(local + 22) !== size || u16(local + 26) !== nameLength || u16(local + 28) !== 0) fail(`the ${name} ZIP header disagrees with its directory.`);
    for (let i = 0; i < nameLength; i++) if (bytes[local + 30 + i] !== bytes[cursor + 46 + i]) fail("ZIP filenames disagree between records.");
    const start = local + 30 + nameLength;
    range(start, size);
    if (start + size > centralOffset) fail("a ZIP entry overlaps its directory.");
    totalBytes += size;
    if (totalBytes > MAX_ANALYSIS_IMPORT_BYTES) fail("the archive contents exceed 256 MiB.");
    if (name.endsWith(".json") && size > MAX_ANALYSIS_JSON_BYTES) fail(`${name} exceeds the 128 MiB JSON limit.`);
    const data = bytes.subarray(start, start + size);
    options.onProgress?.(`Checking ${name}…`);
    if (await crc32(data, options) !== crc) fail(`${name} failed its ZIP integrity check (CRC32).`);
    files.set(name, data);
    cursor += 46 + nameLength;
    nextLocal = start + size;
  }
  if (cursor !== end || nextLocal !== centralOffset) fail("the ZIP contains trailing or unaccounted records.");
  return files;
}

/** Bound depth before parsing; then bound aggregate values and disallow prototype keys. */
function parseJson(files: Map<string, Uint8Array>, name: string): unknown {
  const bytes = files.get(name);
  if (!bytes) fail(`the package is missing ${name}.`);
  let source: string;
  try { source = decoder.decode(bytes); } catch { fail(`${name} is not valid UTF-8.`); }
  let depth = 0, quoted = false, escaped = false;
  for (const char of source) {
    if (quoted) { if (escaped) escaped = false; else if (char === "\\") escaped = true; else if (char === '"') quoted = false; }
    else if (char === '"') quoted = true;
    else if (char === "{" || char === "[") { if (++depth > MAX_JSON_DEPTH) fail(`${name} is nested too deeply (maximum 40).`); }
    else if (char === "}" || char === "]") depth--;
  }
  let parsed: unknown;
  try { parsed = JSON.parse(source); } catch { fail(`${name} is not valid JSON.`); }
  const stack: unknown[] = [parsed];
  let values = 0;
  while (stack.length) {
    const item = stack.pop();
    if (++values > MAX_JSON_VALUES) fail(`${name} contains too many JSON values.`);
    if (typeof item === "number" && !Number.isFinite(item)) fail(`${name} contains a non-finite number.`);
    if (typeof item === "string" && item.length > 2_000_000) fail(`${name} contains an oversized string.`);
    if (item && typeof item === "object") {
      if (Array.isArray(item)) { for (const child of item) stack.push(child); }
      else for (const [key, child] of Object.entries(item)) {
        if (["__proto__", "prototype", "constructor"].includes(key)) fail(`${name} contains an unsafe object key.`);
        stack.push(child);
      }
    }
  }
  // Importing never restores secrets, even when a package was edited outside the app.
  return sanitizeForExport(parsed);
}

async function readDocument(value: unknown, options: ExportOptions): Promise<AnalysisDocument> {
  const doc = object(value, "Results document"), rows = list(doc.rows, "Results rows"), metadata = object(doc.metadata, "Results metadata");
  const keys = new Set<string>(), indices = new Set<number>();
  for (let index = 0; index < rows.length; index++) {
    if (index % 500 === 0) await yieldBrowser(options);
    const row = object(rows[index], `Result ${index + 1}`), label = `Result ${index + 1}`;
    if (typeof row.id === "number") integer(row.id, `${label} id`); else text(row.id, `${label} id`);
    sequence(row.target, `${label} target`); sequence(row.off_target, `${label} off_target`);
    const scores = object(row.scores, `${label} scores`);
    for (const [key, value] of Object.entries(scores)) { oneOf(key, ["k1", "k2", "k3"], `${label} model`); finite(value, `${label} score`); }
    if (row.row_index !== undefined) { const n = integer(row.row_index, `${label} row_index`); if (indices.has(n)) fail("result row_index values must be unique."); indices.add(n); }
    for (const key of ["guide_id", "chromosome", "coordinate_system", "strand", "assembly", "coordinate_verification", "source_tool", "source_format", "source_id", "source_chromosome", "sensitivity_schema", "sensitivity_panel", "sensitivity_original_candidate", "sensitivity_position", "sensitivity_base", "sensitivity_original_base", "sensitivity_source_id", "sensitivity_source_row"])
      if (row[key] !== undefined) text(row[key], `${label} ${key}`);
    for (const key of ["position", "start", "end"]) if (row[key] !== undefined) integer(row[key], `${label} ${key}`);
    if (row.mismatches !== undefined) integer(row.mismatches, `${label} mismatches`, 23);
    if (row.pam_mismatches !== undefined) integer(row.pam_mismatches, `${label} PAM mismatches`, 3);
    for (const key of ["exact_match", "protospacer_match", "user_selected_locus"]) if (row[key] !== undefined) bool(row[key], `${label} ${key}`);
    if (row.mismatch_positions !== undefined) for (const position of list(row.mismatch_positions, `${label} mismatch positions`, 23)) if (integer(position, `${label} mismatch position`, 23) === 0) fail("mismatch positions must be 1-based.");
    if (row.warnings !== undefined) for (const warning of list(row.warnings, `${label} warnings`, 1000)) text(warning, `${label} warning`, 10000);
    if (row.baselines !== undefined) {
      const baselines = object(row.baselines, `${label} baselines`);
      if (baselines.cfd !== undefined) {
        const cfd = object(baselines.cfd, `${label} CFD`);
        if (cfd.score !== null) { const score = finite(cfd.score, `${label} CFD score`); if (score < 0 || score > 1) fail("CFD scores must be within 0–1 or null."); }
        text(cfd.version, `${label} CFD version`);
        if (cfd.reason !== undefined) text(cfd.reason, `${label} CFD reason`, 10000);
      }
    }
    if (row.annotations !== undefined) {
      const annotations = object(row.annotations, `${label} annotations`);
      oneOf(annotations.status, ["annotated", "unavailable", "no_coordinates"], `${label} annotation status`);
      for (const category of list(annotations.categories, `${label} annotation categories`, 1000)) text(category, `${label} category`);
      for (const feature of list(annotations.features, `${label} annotation features`, 10000)) {
        const entry = object(feature, `${label} annotation feature`);
        for (const key of ["gene_id", "gene_name", "feature", "strand"]) text(entry[key], `${label} feature ${key}`);
        if (entry.transcript_id !== undefined) text(entry.transcript_id, `${label} transcript`);
        if (integer(entry.end, `${label} feature end`) < integer(entry.start, `${label} feature start`)) fail("an annotation feature has reversed coordinates.");
      }
      for (const key of ["source", "release", "reason"]) if (annotations[key] !== undefined) text(annotations[key], `${label} annotation ${key}`, 10000);
      if (annotations.transcript_count !== undefined) integer(annotations.transcript_count, `${label} transcript count`);
      if (annotations.ambiguous_transcripts !== undefined) bool(annotations.ambiguous_transcripts, `${label} ambiguous transcripts`);
    }
    const key = candidateKey(row as unknown as ResultRow);
    if (keys.has(key)) fail("two result rows have the same stable identity. This older file cannot restore their selections safely.");
    keys.add(key);
  }
  if (metadata.submitted_guides !== undefined) for (const guide of list(metadata.submitted_guides, "Submitted guides", MAX_ROWS)) {
    const item = object(guide, "Submitted guide"); text(item.id, "Submitted guide id"); sequence(item.target, "Submitted guide target");
  }
  if (metadata.mode !== undefined) oneOf(metadata.mode, ["pairs", "genome"], "Recorded mode");
  if (metadata.candidate_scope !== undefined) text(metadata.candidate_scope, "Recorded candidate scope", 10000);
  if (metadata.model_keys !== undefined) for (const key of list(metadata.model_keys, "Recorded models", 3)) oneOf(key, ["k1", "k2", "k3"], "Recorded model");
  return { rows: rows as ResultRow[], metadata };
}

function readJob(value: unknown): ExportJobSummary | undefined {
  if (value == null) return undefined;
  const job = object(value, "Job summary");
  const models = list(job.models, "Job models", 3).map((value) => {
    const model = integer(value, "Job model", 3); if (!model) fail("a model ID must be 1, 2 or 3."); return model as ModelId;
  });
  if (!models.length || new Set(models).size !== models.length) fail("job models must be nonempty and unique.");
  return {
    id: text(job.id, "Job id"), mode: oneOf(job.mode, ["pairs", "genome"], "Job mode"), models,
    created_at: timestamp(job.created_at, "Job creation time"),
    ...(job.name !== undefined ? { name: text(job.name, "Job name") } : {}),
    ...(job.finished_at != null ? { finished_at: timestamp(job.finished_at, "Job completion time") } : {}),
  };
}

function readView(value: unknown, defaultModel: ModelId, legacy: boolean): WorkspaceViewState {
  const entry = object(value, "Saved view"), filters = object(legacy ? entry : entry.filters, "Saved filters");
  const defaults = createOverviewFilters(), merged = legacy ? { ...defaults, ...filters } : filters;
  const bound = (value: unknown, name: string) => value === null ? null : integer(value, name, 20);
  return {
    filters: {
      guideKey: text(merged.guideKey, "Guide filter"), query: text(merged.query, "Text filter"),
      annotation: text(merged.annotation, "Annotation filter"),
      minMismatches: bound(merged.minMismatches, "Minimum mismatch filter"), maxMismatches: bound(merged.maxMismatches, "Maximum mismatch filter"),
      includeUnknownMismatches: bool(merged.includeUnknownMismatches, "Unknown mismatch filter"),
      exactMatch: oneOf(merged.exactMatch, ["all", "hide", "only"], "Exact match filter"),
    },
    sort: oneOf(entry.sort ?? (legacy ? `k${defaultModel}` : undefined), ["input", "mismatches", "cfd", "k1", "k2", "k3"], "Sort field"),
    ascending: legacy ? entry.order === "asc" : bool(entry.ascending, "Sort direction"),
    showCfd: legacy ? entry.sort === "cfd" : bool(entry.showCfd, "CFD visibility"),
  };
}

function readSelection(value: unknown, rows: ResultRow[], expectedCount: number): Pick<ImportedWorkspaceState, "selectedKeys" | "selectionNotes"> {
  const records = list(object(value, "Selection document").rows, "Selection rows"), byKey = new Map(rows.map((row, index) => [candidateKey(row), index]));
  if (records.length !== expectedCount) fail("the selected-row count disagrees with the saved shortlist.");
  const selectedKeys: string[] = [], selectionNotes: Record<string, string[]> = Object.create(null), seen = new Set<string>();
  for (const value of records) {
    const selected = object(value, "Selected row"), key = text(selected.candidate_key, "Selected candidate identity", 16384), index = byKey.get(key);
    if (index === undefined || seen.has(key)) fail("a selected row is duplicated or does not match a result identity.");
    if (selected.result_index !== undefined && integer(selected.result_index, "Selected result index") !== index) fail("a selection result index disagrees with its candidate identity.");
    const row = rows[index];
    if (selected.id !== row.id || selected.row_index !== row.row_index) fail("a selection row identity disagrees with its result.");
    selectionNotes[key] = list(selected.notes, "Selection reasons", 1000).map((note) => text(note, "Selection reason", 10000));
    selectedKeys.push(key); seen.add(key);
  }
  return { selectedKeys, selectionNotes };
}

function csv(value: unknown): string { return `"${String(value ?? "").replaceAll('"', '""')}"`; }
function sameJson(value: unknown, expected: unknown): boolean {
  if (value === expected) return true;
  if (value === null || expected === null || typeof value !== "object" || typeof expected !== "object") return false;
  if (Array.isArray(value) || Array.isArray(expected)) return Array.isArray(value) && Array.isArray(expected) && value.length === expected.length && value.every((item, index) => sameJson(item, expected[index]));
  const a = value as Record<string, unknown>, b = expected as Record<string, unknown>, keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => Object.hasOwn(b, key) && sameJson(a[key], b[key]));
}
function equal(value: unknown, expected: unknown, label: string) {
  if (!sameJson(value, expected)) fail(`${label} disagrees with matches recomputed from the scientific rows.`);
}
/** Reuse the existing evidence matcher rather than trusting saved joins, status or totals. */
function readEvidence(value: unknown, rows: ResultRow[]): EvidenceState {
  const saved = object(value, "Experimental evidence");
  if (saved.schema_version !== "1.0") fail("the experimental-evidence schema is unsupported.");
  const metadata = object(saved.metadata, "Evidence metadata"), mode = oneOf(metadata.match_mode, ["pair-sequence", "candidate-sequence", "coordinates"], "Evidence matching mode");
  const options: EvidenceOptions = {
    assay: text(metadata.assay, "Assay name", 120), sampleContext: text(metadata.sample_context, "Sample context", 500),
    matchMode: mode, valueKind: oneOf(metadata.value_kind, ["read_count", "evidence_value"], "Evidence value kind"),
  };
  if (mode === "coordinates") {
    if (metadata.assembly !== "GRCh38" || metadata.stored_coordinate_system !== "0-based half-open") fail("evidence coordinates require an explicit GRCh38 0-based half-open declaration.");
    oneOf(metadata.source_coordinate_system, ["0-based half-open", "1-based inclusive"], "Evidence source coordinate convention");
    options.assembly = "GRCh38"; options.coordinateSystem = "0-based half-open";
  }
  const observations = list(saved.observations, "Evidence observations", 10_000);
  const headers = mode === "coordinates" ? ["id", "chromosome", "start", "end", "strand", "target", "value"] : mode === "pair-sequence" ? ["id", "target", "off_target", "value"] : ["id", "off_target", "value"];
  const records = observations.map((value, index) => {
    const observation = object(value, "Evidence observation");
    if (observation.import_row_id !== `observation-${index + 1}` || observation.input_record !== index + 1) fail("evidence observation identities are inconsistent.");
    if (observation.source_id !== undefined) text(observation.source_id, "Evidence source id", 200);
    if (mode !== "coordinates") sequence(observation.off_target, "Observed candidate", false);
    if (mode === "pair-sequence" || observation.target !== undefined) sequence(observation.target, "Observed guide", false);
    if (mode === "coordinates") { text(observation.chromosome, "Evidence chromosome", 100); integer(observation.start, "Evidence start", 2_147_483_647); integer(observation.end, "Evidence end", 2_147_483_647); oneOf(observation.strand, ["+", "-"], "Evidence strand"); }
    const valueNumber = finite(observation.value, "Observation value");
    if (valueNumber < 0 || (options.valueKind === "read_count" && !Number.isSafeInteger(valueNumber))) fail("observation values must be nonnegative; read counts must be safe integers.");
    list(observation.match_result_indices, "Evidence row links", MAX_ROWS).forEach((value) => integer(value, "Evidence linked row", Math.max(0, rows.length - 1)));
    return headers.map((field) => csv(field === "id" ? observation.source_id : observation[field])).join(",");
  });
  const preview = previewAssayEvidence(`${headers.join(",")}\n${records.join("\n")}\n`, options, rows);
  if (!preview.canApply || !preview.state) fail(`experimental observations are invalid: ${preview.issues[0]?.message ?? "no observations"}`);
  const computed = preview.state;
  observations.forEach((value, index) => {
    const observation = value as Record<string, unknown>, expected = computed.observations[index];
    for (const field of ["source_id", "value", "target", "off_target", "chromosome", "start", "end", "strand"] as const)
      equal(observation[field], expected[field], `An observation ${field}`);
    equal(observation.match_result_indices, expected.match_result_indices, "An observation join");
    equal(observation.status, expected.status, "An observation match status");
    equal(observation.duplicate_of, expected.duplicate_of, "An observation duplicate identity");
  });
  equal(saved.per_row, computed.per_row, "Per-row experimental evidence");
  // Compare named counts, independent of JSON object member order.
  const summary = object(saved.summary, "Evidence summary");
  for (const [key, count] of Object.entries(computed.summary)) if (summary[key] !== count) fail("saved evidence totals disagree with the observations.");
  for (const key of ["source_filename", "interpretation"]) if (metadata[key] !== undefined) text(metadata[key], `Evidence ${key}`, 10000);
  if (metadata.source_sha256 !== undefined && !/^[a-f0-9]{64}$/.test(text(metadata.source_sha256, "Evidence source hash", 64))) fail("the evidence source hash is invalid.");
  if (metadata.hash_status !== undefined) oneOf(metadata.hash_status, ["available", "unavailable"], "Evidence hash status");
  if (metadata.hash_basis !== undefined) oneOf(metadata.hash_basis, ["original_file_bytes", "UTF-8 text"], "Evidence hash basis");
  if (metadata.imported_at !== undefined) timestamp(metadata.imported_at, "Evidence import time");
  // Keep provenance, but regenerate interpretation and matching outputs from the current supported contract.
  return { ...computed, metadata: { ...metadata, ...computed.metadata, ...(mode === "coordinates" ? { source_coordinate_system: metadata.source_coordinate_system as EvidenceOptions["coordinateSystem"] } : {}) } };
}

/** Offline data import. A failure leaves replacement/retention decisions entirely to the caller. */
export async function importAnalysisPackage(file: Blob, options: ExportOptions = {}): Promise<ImportedAnalysis> {
  const files = await readArchive(file, options);
  options.onProgress?.("Validating saved results and workspace…");
  const manifest = object(parseJson(files, "provenance-settings.json"), "Package manifest");
  const version = oneOf(manifest.export_schema_version, ["1.0", "1.1"], "Analysis export schema");
  if (files.has("schema.json")) {
    const schema = object(parseJson(files, "schema.json"), "Data schema");
    if (schema.export_schema_version !== version) fail("the data schema and manifest versions disagree.");
  }
  const document = await readDocument(parseJson(files, "results-full.json"), options), job = readJob(manifest.job);
  const counts = object(manifest.counts, "Export counts");
  if (integer(counts.full, "Full result count", MAX_ROWS) !== document.rows.length) fail("the full result count disagrees with results-full.json.");
  const selectedCount = integer(counts.selected, "Selected count", document.rows.length);
  integer(counts.filtered, "Filtered count", document.rows.length);
  const warnings: string[] = ["This local file is user-supplied; its saved predictions and recorded checks are not authenticated server attestations. Opening it does not create a job or rerun predictions."];
  const workspace = manifest.workspace === undefined ? undefined : object(manifest.workspace, "Workspace manifest");
  if (version === "1.1" && !workspace) fail("this export is missing its versioned workspace.");
  if (workspace && workspace.schema_version !== "1.0") fail("the workspace schema is unsupported.");
  const view = readView(workspace?.view ?? manifest.active_filters ?? {}, job?.models[0] ?? 1, !workspace);
  if (!workspace || workspace.saved_state === "legacy_export_defaults") warnings.push("This older export did not explicitly record every view setting. Missing filters use their initial values; sort defaults to the first recorded model, descending; CFD is shown only if it was the saved sort field.");
  if (workspace && !["explicit", "legacy_export_defaults"].includes(String(workspace.saved_state))) fail("the workspace state declaration is unsupported.");
  if (workspace && workspace.selection_file !== "selection-notes.json") fail("the selection file declaration is unsupported.");
  const selection = files.has("selection-notes.json")
    ? readSelection(parseJson(files, "selection-notes.json"), document.rows, selectedCount)
    : selectedCount ? fail("the file records selections but their stable identities and reasons are missing.") : { selectedKeys: [], selectionNotes: {} };
  if (!files.has("selection-notes.json")) warnings.push("This older package did not record selection reasons. Its recorded selected count is zero; no previous notes can be recovered.");
  if (workspace?.saved_state === "explicit" && filterOverviewRows(document.rows, view.filters).length !== counts.filtered) fail("saved filters disagree with the filtered-result count.");
  const evidenceDeclaration = manifest.experimental_evidence;
  if (evidenceDeclaration != null && object(evidenceDeclaration, "Evidence declaration").file !== "experimental-evidence.json") fail("the experimental-evidence file declaration is unsupported.");
  if (workspace && workspace.evidence_file !== (files.has("experimental-evidence.json") ? "experimental-evidence.json" : null)) fail("the workspace evidence declaration disagrees with its files.");
  if (Boolean(evidenceDeclaration) !== files.has("experimental-evidence.json")) fail("the evidence manifest and package contents disagree.");
  const experimentalEvidence = files.has("experimental-evidence.json") ? readEvidence(parseJson(files, "experimental-evidence.json"), document.rows) : null;
  if (!workspace && !files.has("experimental-evidence.json")) warnings.push("No observations were recorded in this older export. Observations used outside that saved package cannot be recovered.");
  let referenceChecks: ReferenceCheckState | undefined;
  if (workspace && workspace.reference_checks_file !== (files.has("reference-checks.json") ? "reference-checks.json" : null)) fail("the reference-check declaration disagrees with its files.");
  if (files.has("reference-checks.json")) {
    referenceChecks = validateReferenceChecks(parseJson(files, "reference-checks.json"), document.rows);
    await verifyReferenceChecksIntegrity(referenceChecks);
  } else if (!workspace) warnings.push("Reference-check history was not recorded by this older export.");
  const frontendBuild = workspace?.frontend_build == null ? undefined : text(workspace.frontend_build, "Frontend build", 200);
  if (!frontendBuild) warnings.push("The frontend build identifier was not recorded.");
  cancelled(options);
  return {
    document, job, state: { ...view, ...selection, experimentalEvidence, ...(referenceChecks ? { referenceChecks } : {}) },
    savedAt: timestamp(manifest.generated_at_utc, "Saved time"),
    source: { exportSchemaVersion: version, ...(workspace ? { workspaceSchemaVersion: "1.0" as const } : {}), ...(frontendBuild ? { frontendBuild } : {}), warnings },
  };
}
