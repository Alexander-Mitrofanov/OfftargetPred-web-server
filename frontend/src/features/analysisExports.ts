import type { AnalysisDocument, Job, ResultRow } from "../api.ts";
import { buildBed } from "./genomeLinks.ts";
import { candidateKey } from "./resultIdentity.ts";
import type { EvidenceState } from "./assayEvidence.ts";

export const ANALYSIS_EXPORT_VERSION = "1.0";
export const MAX_EXPORT_ROWS = 50_000;
const MAX_ZIP_BYTES = 2_000_000_000;
const encoder = new TextEncoder();

export type ExportJobSummary = Pick<
  Job,
  "id" | "mode" | "models" | "name" | "created_at" | "finished_at"
>;
export interface AnalysisExportInput {
  document: AnalysisDocument;
  filteredRows: ResultRow[];
  selectedRows: ResultRow[];
  filters: unknown;
  selectionNotes?: Record<string, string[]>;
  experimentalEvidence?: EvidenceState | null;
  job?: ExportJobSummary;
  generatedAt?: Date;
  citation: string;
  license: string;
  notices?: string;
}
export interface ExportFile {
  name: string;
  data: Blob;
}
export interface ExportOptions {
  signal?: AbortSignal;
  onProgress?: (message: string) => void;
}
export interface CsvExportOptions extends ExportOptions {
  selectionNotes?: Record<string, string[]>;
}

/** Deliberately matches credentials, but not scientific tokenizer/model identifiers. */
function credentialKey(key: string): boolean {
  const normalized = key
    .replace(/([a-z])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_");
  return (
    /(^|_)(token|tokens|authorization|cookie|cookies|password|secret|credential|credentials|session|apikey|api_key)(_|$)/.test(
      normalized,
    ) ||
    /(^|_)(private|capability|resume|share|job)_(url|link)(_|$)/.test(
      normalized,
    )
  );
}

function sensitiveString(value: string): boolean {
  let decoded = value;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    /* Plain text may contain a literal %. */
  }
  return (
    /\bBearer\s+\S+/i.test(decoded) ||
    /[?#&](?:access[_-]?token|refresh[_-]?token|token|api[_-]?key|secret|password|authorization|signature|credential|x-amz-(?:signature|credential|security-token))=/i.test(
      decoded,
    ) ||
    /https?:\/\/[^\s/]+:[^\s/]+@/i.test(decoded)
  );
}

/** Export only JSON values. Recursively remove credential fields and redact credential URLs. */
export function sanitizeForExport(
  value: unknown,
  seen = new WeakSet<object>(),
  depth = 0,
): unknown {
  if (depth > 40) return "[omitted: excessive nesting]";
  if (typeof value === "string")
    return sensitiveString(value)
      ? "[private credential or link removed]"
      : value;
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (!value || typeof value !== "object") return undefined;
  if (seen.has(value)) return "[omitted: circular reference]";
  seen.add(value);
  let result: unknown;
  if (Array.isArray(value))
    result = value.map(
      (item) => sanitizeForExport(item, seen, depth + 1) ?? null,
    );
  else {
    const safe: Record<string, unknown> = Object.create(null);
    for (const [key, item] of Object.entries(value)) {
      if (credentialKey(key)) continue;
      const sanitized = sanitizeForExport(item, seen, depth + 1);
      if (sanitized !== undefined) safe[key] = sanitized;
    }
    result = safe;
  }
  seen.delete(value);
  return result;
}

/** RFC 4180 quoting plus spreadsheet formula prevention. JSON retains original text. */
export function csvCell(value: unknown): string {
  const safe = sanitizeForExport(value);
  let text =
    safe == null
      ? ""
      : typeof safe === "object"
        ? JSON.stringify(safe)
        : String(safe);
  // Guard leading control/whitespace characters as well as direct formula prefixes.
  if (
    typeof safe === "string" &&
    (/^[\s\u0000-\u001f]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text))
  )
    text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export const RESULT_CSV_FIELDS = [
  "row_index",
  "id",
  "guide_id",
  "target",
  "off_target",
  "k1_score",
  "k2_score",
  "k3_score",
  "cfd_score",
  "cfd_unavailable_reason",
  "cfd_version",
  "assembly",
  "chromosome",
  "start",
  "end",
  "coordinate_system",
  "strand",
  "mismatches",
  "mismatch_positions",
  "pam_mismatches",
  "exact_match",
  "protospacer_match",
  "user_selected_locus",
  "annotation_status",
  "annotation_categories",
  "annotation_source",
  "annotation_release",
  "annotation_reason",
  "gene_ids",
  "gene_names",
  "annotation_features",
  "warnings",
  "source_tool",
  "source_format",
  "source_id",
  "source_chromosome",
  "coordinate_verification",
  "sensitivity_schema",
  "sensitivity_panel",
  "sensitivity_original_candidate",
  "sensitivity_position",
  "sensitivity_base",
  "sensitivity_original_base",
  "sensitivity_source_id",
  "sensitivity_source_row",
  "selection_notes",
] as const;

function csvRecord(
  row: ResultRow,
  selectionNotes?: Record<string, string[]>,
): string {
  const values: unknown[] = [
    row.row_index,
    row.id,
    row.guide_id,
    row.target,
    row.off_target,
    row.scores.k1,
    row.scores.k2,
    row.scores.k3,
    row.baselines?.cfd?.score,
    row.baselines?.cfd?.reason,
    row.baselines?.cfd?.version,
    row.assembly,
    row.chromosome,
    row.start,
    row.end,
    row.coordinate_system,
    row.strand,
    row.mismatches,
    row.mismatch_positions,
    row.pam_mismatches,
    row.exact_match,
    row.protospacer_match,
    row.user_selected_locus,
    row.annotations?.status,
    row.annotations?.categories,
    row.annotations?.source,
    row.annotations?.release,
    row.annotations?.reason,
    [
      ...new Set(
        row.annotations?.features.map((feature) => feature.gene_id) ?? [],
      ),
    ],
    [
      ...new Set(
        row.annotations?.features.map((feature) => feature.gene_name) ?? [],
      ),
    ],
    row.annotations?.features,
    row.warnings,
    row.source_tool,
    row.source_format,
    row.source_id,
    row.source_chromosome,
    row.coordinate_verification,
    row.sensitivity_schema,
    row.sensitivity_panel,
    row.sensitivity_original_candidate,
    row.sensitivity_position,
    row.sensitivity_base,
    row.sensitivity_original_base,
    row.sensitivity_source_id,
    row.sensitivity_source_row,
    selectionNotes?.[candidateKey(row)] ?? [],
  ];
  return `${values.map(csvCell).join(",")}\r\n`;
}

export function resultsCsv(
  rows: ResultRow[],
  selectionNotes?: Record<string, string[]>,
): string {
  return `${RESULT_CSV_FIELDS.map(csvCell).join(",")}\r\n${rows.map((row) => csvRecord(row, selectionNotes)).join("")}`;
}

function checkCancelled(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException("Export cancelled", "AbortError");
}
async function yieldToBrowser(signal?: AbortSignal) {
  checkCancelled(signal);
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  checkCancelled(signal);
}

export async function resultsCsvBlob(
  rows: ResultRow[],
  options: CsvExportOptions = {},
): Promise<Blob> {
  if (rows.length > MAX_EXPORT_ROWS)
    throw new Error("This export supports at most 50,000 rows.");
  const chunks: BlobPart[] = [
    `${RESULT_CSV_FIELDS.map(csvCell).join(",")}\r\n`,
  ];
  for (let start = 0; start < rows.length; start += 100) {
    await yieldToBrowser(options.signal);
    chunks.push(
      rows
        .slice(start, start + 100)
        .map((row) => csvRecord(row, options.selectionNotes))
        .join(""),
    );
  }
  return new Blob(chunks, { type: "text/csv;charset=utf-8" });
}

async function resultJsonBlob(
  document: AnalysisDocument,
  options: ExportOptions,
): Promise<Blob> {
  const chunks: BlobPart[] = [
    '{"metadata":',
    JSON.stringify(sanitizeForExport(document.metadata)),
    ',"rows":[',
  ];
  for (let start = 0; start < document.rows.length; start += 100) {
    await yieldToBrowser(options.signal);
    const text = document.rows
      .slice(start, start + 100)
      .map((row) => JSON.stringify(sanitizeForExport(row)))
      .join(",");
    chunks.push(start ? `,${text}` : text);
  }
  chunks.push("]}\n");
  return new Blob(chunks, { type: "application/json" });
}

export function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ]!,
  );
}

export function exportManifest(input: AnalysisExportInput, generatedAt: Date) {
  const job = input.job
    ? {
        id: input.job.id,
        mode: input.job.mode,
        models: input.job.models,
        name: input.job.name,
        created_at: input.job.created_at,
        finished_at: input.job.finished_at,
      }
    : undefined;
  return {
    export_schema_version: ANALYSIS_EXPORT_VERSION,
    generated_at_utc: generatedAt.toISOString(),
    counts: {
      full: input.document.rows.length,
      filtered: input.filteredRows.length,
      selected: input.selectedRows.length,
    },
    views: {
      full: "Every result in the downloaded analysis document, in its original order.",
      filtered:
        "All rows matching the active filters, not just the visible page; order is the supplied view order.",
      selected: input.selectedRows.length
        ? "Explicitly selected rows, including selected rows hidden by current filters."
        : "No rows selected. The shortlist CSV contains its header only.",
    },
    active_filters: sanitizeForExport(input.filters),
    job: sanitizeForExport(job),
    provenance: sanitizeForExport(input.document.metadata),
    experimental_evidence: input.experimentalEvidence ? {
      file: "experimental-evidence.json",
      metadata: sanitizeForExport(input.experimentalEvidence.metadata),
      summary: input.experimentalEvidence.summary,
      join: "per_row.result_index is the zero-based index in results-full.json rows; candidate_key is retained as a cross-check. All observations are preserved, including unmatched and duplicate observations.",
    } : null,
    privacy:
      "Created locally in the browser. Credential fields and credential-bearing links are excluded. Sequences, identifiers, job names and other analysis data remain in this archive; share it deliberately.",
    score_interpretation:
      "CRISPert k1/k2/k3 and CFD are separate uncalibrated scores. No score is a probability or a safety threshold; no average is computed.",
    coordinate_conventions:
      "Genomic start/end and BED6 are 0-based, half-open forward-reference intervals spanning all 23 nt, including the PAM. BED checks the declared GRCh38 assembly, contig, interval bounds and strand; it does not verify imported sequences against the reference. BED score 0 is neutral, not a model score. Rows failing coordinate checks are explicitly skipped in BED only. Consult each row's coordinate_verification and input provenance.",
    csv_text_convention:
      "All CSV fields are quoted. Text beginning with a spreadsheet formula/control prefix is prefixed with an apostrophe. Original text is retained in results-full.json after credential filtering. Arrays and annotation features are JSON within quoted cells.",
  };
}

/** A bounded, script-free report: full machine-readable data are separate archive files. */
export function analysisReport(
  input: AnalysisExportInput,
  generatedAt: Date,
): string {
  const manifest = exportManifest(input, generatedAt);
  const rows = input.filteredRows.slice(0, 200);
  const rowMarkup = rows
    .map((row) => {
      const safe = sanitizeForExport(row) as ResultRow;
      return `<tr>${[safe.row_index, safe.id, safe.guide_id, safe.target, safe.off_target, safe.scores.k1, safe.scores.k2, safe.scores.k3, safe.baselines?.cfd?.score, safe.assembly, safe.chromosome, safe.start, safe.end, safe.strand].map((value) => `<td>${escapeHtml(value)}</td>`).join("")}</tr>`;
    })
    .join("\n");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>OfftargetPred analysis report</title><style>body{font:16px/1.5 system-ui,sans-serif;color:#16334a;background:#fff;max-width:1000px;margin:2rem auto;padding:0 1rem}h1,h2{line-height:1.2}a{color:#1266a8}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f5f8fb;padding:1rem}table{border-collapse:collapse;font-size:13px}th,td{border:1px solid #d7e2ea;padding:.4rem;vertical-align:top}td{overflow-wrap:anywhere}.table-wrap{overflow:auto}small{display:block}</style></head><body><h1>OfftargetPred analysis report</h1><p>Exported ${escapeHtml(manifest.generated_at_utc)} · export schema ${ANALYSIS_EXPORT_VERSION}</p><p>Full analysis: <strong>${manifest.counts.full}</strong> rows. Filtered view: <strong>${manifest.counts.filtered}</strong>. Selected shortlist: <strong>${manifest.counts.selected}</strong>.</p><p>${escapeHtml(manifest.score_interpretation)}</p><h2>Files and interpretation</h2><ul><li><a href="results-full.json">Full results JSON</a> preserves full precision and row metadata.</li><li><a href="results-full.csv">Full results CSV</a>, <a href="results-filtered.csv">filtered CSV</a> and <a href="shortlist-selected.csv">selected shortlist CSV</a> are distinct views.</li><li><a href="candidates-full.bed">Full BED</a> and <a href="shortlist-selected.bed">selected BED</a> omit only rows listed in <a href="bed-skipped.json">the skipped-row report</a>.</li><li><a href="provenance-settings.json">Provenance and settings</a>, <a href="schema.json">data schema</a>, <a href="CITATION.cff">citation</a> and <a href="LICENSE.txt">project code licence</a>.</li></ul><p>${escapeHtml(manifest.coordinate_conventions)}</p><p>${escapeHtml(manifest.csv_text_convention)}</p><h2>Filtered candidates</h2><p>This compact report shows ${rows.length} of ${manifest.counts.filtered} filtered rows. Use the linked CSV and JSON files for every row. ${manifest.counts.selected === 0 ? "No candidates were selected." : "Selection is explicit and can include rows hidden by filters."}</p><div class="table-wrap"><table><thead><tr>${["Row index", "Candidate ID", "Guide ID", "Guide with PAM", "Candidate with PAM", "k1", "k2", "k3", "CFD", "Assembly", "Chromosome", "Start (0-based)", "End (exclusive)", "Strand"].map((label) => `<th scope="col">${label}</th>`).join("")}</tr></thead><tbody>${rowMarkup}</tbody></table></div><h2>Settings and provenance</h2><pre>${escapeHtml(JSON.stringify(manifest, null, 2))}</pre><h2>Citation</h2><pre>${escapeHtml(input.citation)}</pre><small>${escapeHtml(manifest.privacy)}</small></body></html>`;
}

const schema = {
  export_schema_version: ANALYSIS_EXPORT_VERSION,
  results_document: {
    metadata:
      "Object containing model, software, reference/search, annotation and baseline provenance as available.",
    rows: "Ordered candidate array; duplicate user IDs are retained. row_index is the original stable result index when recorded.",
  },
  row_fields: {
    id: "User or generated candidate identifier; not necessarily unique.",
    row_index:
      "Stable result index when supplied by the analysis; not regenerated by filtering.",
    target:
      "Guide-associated 23-nt DNA sequence, 20-nt protospacer plus actual 3-nt PAM.",
    off_target:
      "Aligned candidate 23-nt DNA sequence including its actual PAM.",
    scores:
      "Object with k1, k2 and/or k3 full-precision JSON numbers. Missing values are unavailable, never substituted with zero.",
    baselines:
      "Optional cfd {score: number|null, reason?: string, version: string}; null is unavailable, zero is a valid CFD value.",
    annotations:
      "Optional status, categories, full overlapping features, source, release and unavailable reason. Categories can overlap. Unavailable is not intergenic.",
    assembly:
      "Reference assembly explicitly associated with coordinates; not inferred from a locus.",
    start: "0-based inclusive forward-reference start of full 23-nt site.",
    end: "0-based exclusive forward-reference end of full 23-nt site.",
    strand:
      "+ or - on the reference; candidate sequence is in guide orientation.",
    coordinate_system:
      "Explicit recorded convention; BED export requires 0-based half-open.",
    user_selected_locus:
      "User-designated intended target; not inferred automatically from sequence identity.",
  },
  csv_fields: RESULT_CSV_FIELDS,
  preservation:
    "Full JSON retains additional JSON fields after recursive credential removal. CSV exposes the documented common result fields; consult JSON for additional data.",
};

function jsonBlob(value: unknown) {
  return new Blob([`${JSON.stringify(sanitizeForExport(value), null, 2)}\n`], {
    type: "application/json",
  });
}

function exportBed(rows: ResultRow[]) {
  // BED sanitizes identifier punctuation; redact credential URLs before that
  // transformation can obscure their structure and leave a credential value.
  return buildBed(rows.map((row) => ({
    ...row,
    id: sanitizeForExport(row.id) as string | number,
    guide_id: sanitizeForExport(row.guide_id) as string | undefined,
  })));
}

export async function analysisFiles(
  input: AnalysisExportInput,
  options: ExportOptions = {},
): Promise<ExportFile[]> {
  if (
    [input.document.rows, input.filteredRows, input.selectedRows].some(
      (rows) => rows.length > MAX_EXPORT_ROWS,
    )
  )
    throw new Error("This export supports at most 50,000 rows per view.");
  const generatedAt = input.generatedAt ?? new Date();
  if (!Number.isFinite(generatedAt.getTime()))
    throw new Error("The export time is invalid.");
  const files: ExportFile[] = [
    {
      name: "provenance-settings.json",
      data: jsonBlob(exportManifest(input, generatedAt)),
    },
  ];
  options.onProgress?.("Preparing full results JSON…");
  files.push({
    name: "results-full.json",
    data: await resultJsonBlob({ ...input.document, metadata: { ...input.document.metadata, experimental_evidence: exportManifest(input, generatedAt).experimental_evidence } }, options),
  });
  if (input.experimentalEvidence) files.push({ name: "experimental-evidence.json", data: jsonBlob(input.experimentalEvidence) });
  for (const [name, rows] of [
    ["results-full.csv", input.document.rows],
    ["results-filtered.csv", input.filteredRows],
    ["shortlist-selected.csv", input.selectedRows],
  ] as const) {
    options.onProgress?.(`Preparing ${name}…`);
    files.push({
      name,
      data: await resultsCsvBlob(rows, {
        ...options,
        selectionNotes:
          name === "shortlist-selected.csv" ? input.selectionNotes : undefined,
      }),
    });
  }
  await yieldToBrowser(options.signal);
  const fullBed = exportBed(input.document.rows),
    selectedBed = exportBed(input.selectedRows);
  files.push(
    {
      name: "candidates-full.bed",
      data: new Blob([fullBed.text], { type: "text/plain" }),
    },
    {
      name: "shortlist-selected.bed",
      data: new Blob([selectedBed.text], { type: "text/plain" }),
    },
    {
      name: "bed-skipped.json",
      data: jsonBlob({
        convention:
          "Only declared GRCh38 0-based half-open 23-nt loci passing contig, bounds and strand checks are included. Imported sequence/reference agreement is not checked. No result is removed from JSON or CSV.",
        full: { exported: fullBed.exported, skipped: fullBed.skipped },
        selected: {
          exported: selectedBed.exported,
          skipped: selectedBed.skipped,
        },
      }),
    },
    { name: "schema.json", data: jsonBlob(schema) },
    {
      name: "selection-notes.json",
      data: jsonBlob({
        scope:
          "Explicit selected shortlist only. Notes record user selection reasons and are not experimental evidence.",
        rows: input.selectedRows.map((row) => ({
          candidate_key: candidateKey(row),
          row_index: row.row_index,
          id: row.id,
          notes: input.selectionNotes?.[candidateKey(row)] ?? [],
        })),
      }),
    },
    {
      name: "report.html",
      data: new Blob([analysisReport(input, generatedAt)], {
        type: "text/html;charset=utf-8",
      }),
    },
    {
      name: "CITATION.cff",
      data: new Blob([input.citation], { type: "text/plain;charset=utf-8" }),
    },
    {
      name: "LICENSE.txt",
      data: new Blob([input.license], { type: "text/plain;charset=utf-8" }),
    },
  );
  if (input.notices)
    files.push({
      name: "THIRD_PARTY_NOTICES.md",
      data: new Blob([input.notices], { type: "text/plain;charset=utf-8" }),
    });
  return files;
}

const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++)
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
async function blobCrc32(blob: Blob, signal?: AbortSignal): Promise<number> {
  const reader = blob.stream().getReader();
  let crc = 0xffffffff,
    processed = 0;
  try {
    while (true) {
      checkCancelled(signal);
      const { value, done } = await reader.read();
      if (done) break;
      for (const byte of value)
        crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
      processed += value.length;
      if (processed >= 1_048_576) {
        await yieldToBrowser(signal);
        processed = 0;
      }
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** ZIP32 STORE with CRC32, UTF-8 filenames and fixed safe archive paths; no dependencies. */
export async function storedZip(
  files: ExportFile[],
  generatedAt: Date,
  options: ExportOptions = {},
): Promise<Blob> {
  if (files.length > 65535) throw new Error("Too many archive files.");
  if (!Number.isFinite(generatedAt.getTime()))
    throw new Error("The export time is invalid.");
  const names = new Set<string>();
  let expectedSize = 22;
  for (const file of files) {
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(file.name) || names.has(file.name))
      throw new Error("Archive filenames must be unique, safe, flat paths.");
    names.add(file.name);
    const nameLength = encoder.encode(file.name).length;
    if (nameLength > 65535) throw new Error("Archive filename is too long.");
    expectedSize += file.data.size + 76 + 2 * nameLength;
  }
  if (expectedSize > MAX_ZIP_BYTES)
    throw new Error(
      "This archive exceeds the browser export limit of 2 GB. Download separate result files or a smaller filtered view.",
    );
  const year = Math.min(2107, Math.max(1980, generatedAt.getUTCFullYear()));
  const dosDate =
    ((year - 1980) << 9) |
    ((generatedAt.getUTCMonth() + 1) << 5) |
    generatedAt.getUTCDate();
  const dosTime =
    (generatedAt.getUTCHours() << 11) |
    (generatedAt.getUTCMinutes() << 5) |
    Math.floor(generatedAt.getUTCSeconds() / 2);
  const localParts: BlobPart[] = [],
    centralParts: BlobPart[] = [];
  let offset = 0,
    centralSize = 0;
  for (const file of files) {
    options.onProgress?.(`Packaging ${file.name}…`);
    const name = encoder.encode(file.name),
      crc = await blobCrc32(file.data, options.signal);
    const local = new ArrayBuffer(30),
      view = new DataView(local);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 0x800, true);
    view.setUint16(10, dosTime, true);
    view.setUint16(12, dosDate, true);
    view.setUint32(14, crc, true);
    view.setUint32(18, file.data.size, true);
    view.setUint32(22, file.data.size, true);
    view.setUint16(26, name.length, true);
    localParts.push(local, name, file.data);
    const central = new ArrayBuffer(46),
      directory = new DataView(central);
    directory.setUint32(0, 0x02014b50, true);
    directory.setUint16(4, 20, true);
    directory.setUint16(6, 20, true);
    directory.setUint16(8, 0x800, true);
    directory.setUint16(12, dosTime, true);
    directory.setUint16(14, dosDate, true);
    directory.setUint32(16, crc, true);
    directory.setUint32(20, file.data.size, true);
    directory.setUint32(24, file.data.size, true);
    directory.setUint16(28, name.length, true);
    directory.setUint32(42, offset, true);
    centralParts.push(central, name);
    centralSize += 46 + name.length;
    offset += 30 + name.length + file.data.size;
  }
  const end = new ArrayBuffer(22),
    endView = new DataView(end);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, files.length, true);
  endView.setUint16(10, files.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, offset, true);
  checkCancelled(options.signal);
  return new Blob([...localParts, ...centralParts, end], {
    type: "application/zip",
  });
}

export async function createAnalysisPackage(
  input: AnalysisExportInput,
  options: ExportOptions = {},
): Promise<Blob> {
  const generatedAt = input.generatedAt ?? new Date();
  return storedZip(
    await analysisFiles({ ...input, generatedAt }, options),
    generatedAt,
    options,
  );
}
