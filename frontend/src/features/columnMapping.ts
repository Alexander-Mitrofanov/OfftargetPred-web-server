import { parseTable, validateInput } from "../input.ts";

export type TableDelimiter = "auto" | "csv" | "tsv";
export interface MappingLimits {
  maxRows?: number;
  maxRequestBytes?: number;
}
export interface ColumnSelection {
  guide: number | null;
  candidate: number | null;
  id: number | null;
}
export interface MappableTable {
  headers: string[];
  rows: string[][];
  delimiter: "," | "\t";
  bytes: number;
  errors: string[];
}
export interface MappingIssue {
  row: number | null;
  message: string;
}
export interface MappedPreview {
  row: number;
  id: string;
  guide: string;
  candidate: string;
  errors: string[];
  warnings: string[];
}
export interface MappingResult {
  valid: boolean;
  normalizedCsv: string;
  totalRows: number;
  invalidRows: number;
  issues: MappingIssue[];
  warnings: string[];
  preview: MappedPreview[];
  preservedColumns: string[];
  omittedColumns: string[];
}
const DEFAULT_MAX_ROWS = 10_000;
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;
const MAX_COLUMNS = 256;
const METADATA = new Set([
  "guide_id",
  "chromosome",
  "position",
  "start",
  "end",
  "strand",
  "assembly",
  "coordinate_system",
]);
const GUIDE_ALIASES = new Set([
  "target",
  "sgrna",
  "guide_sequence",
  "alignedtarget",
  "guide",
  "spacer_pam",
]);
const CANDIDATE_ALIASES = new Set([
  "off_target",
  "offtarget",
  "target_sequence",
  "alignedtext",
  "candidate_sequence",
  "candidate",
  "site",
]);
const ID_ALIASES = new Set(["id", "sgrna_id", "guide_id", "name"]);

function limit(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isSafeInteger(value) && value > 0
    ? Math.min(value, fallback)
    : fallback;
}
function delimiterFor(text: string): "," | "\t" {
  let quoted = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === '"') {
      if (quoted && text[index + 1] === '"') index++;
      else quoted = !quoted;
    } else if (!quoted) {
      if (char === "\t") return "\t";
      if (char === "\r" || char === "\n") break;
    }
  }
  return ",";
}

/** A cheap logical-record bound before parseTable allocates the row matrix. */
function tooManyRecords(text: string, maxRows: number): boolean {
  let quoted = false,
    nonBlank = false,
    records = 0;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === '"') {
      nonBlank = true;
      if (quoted && text[index + 1] === '"') index++;
      else quoted = !quoted;
    } else if (!quoted && (char === "\r" || char === "\n")) {
      if (char === "\r" && text[index + 1] === "\n") index++;
      if (nonBlank && ++records > maxRows + 1) return true;
      nonBlank = false;
    } else if (!/\s/.test(char)) nonBlank = true;
  }
  return nonBlank && records + 1 > maxRows + 1;
}

function tooManyFields(text: string, separator: string): boolean {
  let quoted = false,
    fields = 1;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === '"') {
      if (quoted && text[index + 1] === '"') index++;
      else quoted = !quoted;
    } else if (!quoted && char === separator) {
      if (++fields > MAX_COLUMNS) return true;
    } else if (!quoted && (char === "\r" || char === "\n")) fields = 1;
  }
  return false;
}

/** Parses only bounded local text; never guesses DNA, a PAM or strand orientation. */
export function inspectTable(
  rawText: string,
  limits: MappingLimits = {},
  delimiter: TableDelimiter = "auto",
): MappableTable {
  const maxRows = limit(limits.maxRows, DEFAULT_MAX_ROWS);
  const maxBytes = limit(limits.maxRequestBytes, DEFAULT_MAX_BYTES);
  const separator =
    delimiter === "tsv"
      ? "\t"
      : delimiter === "csv"
        ? ","
        : delimiterFor(rawText);
  const result: MappableTable = {
    headers: [],
    rows: [],
    delimiter: separator,
    bytes: 0,
    errors: [],
  };
  // Every UTF-16 code unit needs at least one UTF-8 byte. Avoid encoding enormous input.
  if (rawText.length > maxBytes) {
    result.errors.push(
      `The table exceeds the ${maxBytes.toLocaleString()}-byte request limit. Split it into smaller files.`,
    );
    return result;
  }
  result.bytes = new TextEncoder().encode(rawText).byteLength;
  if (result.bytes > maxBytes) {
    result.errors.push(
      `The table exceeds the ${maxBytes.toLocaleString()}-byte request limit. Split it into smaller files.`,
    );
    return result;
  }
  if (!rawText.trim()) return result;
  if (tooManyRecords(rawText, maxRows)) {
    result.errors.push(
      `Use at most ${maxRows.toLocaleString()} data rows. Split this table into smaller jobs.`,
    );
    return result;
  }
  if (tooManyFields(rawText, separator)) {
    result.errors.push(
      `The mapper supports at most ${MAX_COLUMNS} columns. Keep the sequence, identifier and needed metadata columns.`,
    );
    return result;
  }
  try {
    const [header, ...rows] = parseTable(rawText, separator);
    result.headers = (header ?? []).map((name) => name.trim());
    result.rows = rows;
    if (!result.headers.length) result.errors.push("The input table is empty.");
    if (result.headers.some((name) => name.length > 200))
      result.errors.push(
        "Column headers must contain at most 200 characters. Shorten the headers before mapping.",
      );
    if (result.headers.some((name) => !name))
      result.errors.push("Every column needs a non-empty header.");
    if (new Set(result.headers).size !== result.headers.length)
      result.errors.push(
        "Column names must be unique, including after trimming surrounding spaces.",
      );
    if (!rows.length)
      result.errors.push("The table has a header but no candidate rows.");
    if (rows.length > maxRows)
      result.errors.push(
        `Use at most ${maxRows.toLocaleString()} data rows. Split this table into smaller jobs.`,
      );
  } catch (error) {
    result.errors.push(
      error instanceof Error ? error.message : "The table could not be read.",
    );
  }
  return result;
}

export function guessColumns(headers: string[]): ColumnSelection {
  function unique(aliases: Set<string>): number | null {
    const matches = headers.flatMap((name, index) =>
      aliases.has(name.toLowerCase()) ? [index] : [],
    );
    return matches.length === 1 ? matches[0] : null;
  }
  return {
    guide: unique(GUIDE_ALIASES),
    candidate: unique(CANDIDATE_ALIASES),
    id: unique(ID_ALIASES),
  };
}

function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

export function mapColumns(
  table: MappableTable,
  selection: ColumnSelection,
  limits: MappingLimits = {},
): MappingResult {
  const issues: MappingIssue[] = table.errors.map((message) => ({
    row: null,
    message,
  }));
  const result: MappingResult = {
    valid: false,
    normalizedCsv: "",
    totalRows: table.rows.length,
    invalidRows: 0,
    issues,
    warnings: [],
    preview: [],
    preservedColumns: [],
    omittedColumns: [],
  };
  const isColumn = (index: number | null): index is number =>
    index !== null &&
    Number.isInteger(index) &&
    index >= 0 &&
    index < table.headers.length;
  if (!isColumn(selection.guide))
    issues.push({
      row: null,
      message: "Choose the column containing the 23-nt guide and its PAM.",
    });
  if (!isColumn(selection.candidate))
    issues.push({
      row: null,
      message: "Choose the column containing the 23-nt candidate and its PAM.",
    });
  if (selection.id !== null && !isColumn(selection.id))
    issues.push({
      row: null,
      message: "Choose a valid identifier column or generated identifiers.",
    });
  const chosen = [selection.guide, selection.candidate, selection.id].filter(
    (index) => index !== null,
  );
  if (new Set(chosen).size !== chosen.length)
    issues.push({
      row: null,
      message: "Guide, candidate and identifier must use different columns.",
    });
  if (
    issues.length ||
    !isColumn(selection.guide) ||
    !isColumn(selection.candidate)
  )
    return result;
  const guideColumn = selection.guide,
    candidateColumn = selection.candidate;
  const metadata = table.headers.flatMap((name, index) =>
    !chosen.includes(index) && METADATA.has(name) ? [{ name, index }] : [],
  );
  result.preservedColumns = metadata.map(({ name }) => name);
  result.omittedColumns = table.headers.filter(
    (_, index) =>
      !chosen.includes(index) &&
      !metadata.some((column) => column.index === index),
  );
  const output: string[][] = [
    ["ID", "target", "off_target", ...result.preservedColumns],
  ];
  const rowErrors = new Map<number, string[]>();
  function rowError(row: number, message: string) {
    issues.push({ row, message });
    const errors = rowErrors.get(row) ?? [];
    errors.push(message);
    rowErrors.set(row, errors);
  }
  table.rows.forEach((row, index) => {
    const number = index + 1;
    if (row.length !== table.headers.length)
      rowError(
        number,
        `Data row ${number} has ${row.length} fields; the header has ${table.headers.length}.`,
      );
    const identifier =
      selection.id === null ? `pair-${number}` : (row[selection.id] ?? "");
    if (!identifier.trim())
      rowError(
        number,
        `Data row ${number}: identifier is empty. Fill it in or choose generated identifiers.`,
      );
    if (identifier.length > 200 || /[\u0000-\u001f]/.test(identifier))
      rowError(
        number,
        `Data row ${number}: identifier must contain at most 200 printable characters, without line breaks or tabs.`,
      );
    const guide = (row[guideColumn] ?? "").trim().toUpperCase();
    const candidate = (row[candidateColumn] ?? "").trim().toUpperCase();
    output.push([
      identifier,
      guide,
      candidate,
      ...metadata.map(({ index: column }) => row[column] ?? ""),
    ]);
    if (number <= 10) {
      const warnings: string[] = [];
      if (guide.length === 23 && !/GG$/.test(guide))
        warnings.push(
          "Guide PAM is not NGG: outside the supplied guide training scope.",
        );
      if (/[N]/.test(guide + candidate))
        warnings.push("Contains N: affected model tokens are unknown.");
      result.preview.push({
        row: number,
        id: identifier,
        guide,
        candidate,
        errors: [],
        warnings,
      });
    }
  });
  const csv = output.map((row) => row.map(csvCell).join(",")).join("\n");
  const validation = validateInput("pairs", "table", "", "", csv, "", null);
  for (const message of validation.errors) {
    const match = /^Data row (\d+)/.exec(message);
    if (match) rowError(Number(match[1]), message);
    else issues.push({ row: null, message });
  }
  result.warnings = validation.warnings;
  // Include JSON escaping and reserve 1 KiB for the job name and other request fields.
  const bodyBytes =
    new TextEncoder().encode(
      JSON.stringify({
        mode: "pairs",
        input: csv,
        format: "csv",
        models: [1, 2, 3],
      }),
    ).byteLength + 1024;
  const maxBytes = limit(limits.maxRequestBytes, DEFAULT_MAX_BYTES);
  if (bodyBytes > maxBytes)
    issues.push({
      row: null,
      message: `The normalized request exceeds the ${maxBytes.toLocaleString()}-byte limit after JSON encoding and reserving space for request metadata. Split the table into smaller jobs.`,
    });
  const maxRows = limit(limits.maxRows, DEFAULT_MAX_ROWS);
  if (table.rows.length > maxRows)
    issues.push({
      row: null,
      message: `Use at most ${maxRows.toLocaleString()} data rows.`,
    });
  result.invalidRows = rowErrors.size;
  result.preview.forEach((row) => {
    row.errors = rowErrors.get(row.row) ?? [];
  });
  result.valid = issues.length === 0;
  result.normalizedCsv = result.valid ? csv : "";
  return result;
}
