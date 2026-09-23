import { parseTable } from "../input.ts";

export type ToolImportFormat = "cas-offinder-2.4.1" | "crispor-offtargets" | "chopchop-compatible";
export interface ToolImportOptions {
  format: ToolImportFormat;
  assembly: "GRCh38" | "";
  guide23?: string;
  guideId?: string;
  coordinateSystem?: "0-based half-open" | "1-based inclusive";
  candidateOrientation?: "guide-oriented" | "forward-reference";
}
export interface ImportedPair {
  id: string; guide_id: string; target: string; off_target: string;
  source_tool: string; source_format: ToolImportFormat; source_id: string;
  assembly: "GRCh38"; chromosome: string; start: number; end: number;
  strand: "+" | "-"; coordinate_system: "0-based half-open";
  coordinate_verification: "user-supplied, not reference-verified";
}
export interface ToolImportIssue { row: number | null; code: string; message: string }
export interface ToolImportPreview {
  rows: ImportedPair[]; csv: string; inputRows: number;
  issues: ToolImportIssue[]; warnings: string[]; canApply: boolean;
}
const MAX_BYTES = 5 * 1024 * 1024, MAX_ROWS = 60_000;
const COORDINATE_SYSTEM = "0-based half-open" as const;
const VERIFIED = "user-supplied, not reference-verified" as const;
const toolNames: Record<ToolImportFormat, string> = {
  "cas-offinder-2.4.1": "Cas-OFFinder", "crispor-offtargets": "CRISPOR", "chopchop-compatible": "CHOPCHOP",
};
const outputFields: (keyof ImportedPair)[] = ["id", "guide_id", "target", "off_target", "source_tool", "source_format", "source_id", "assembly", "chromosome", "start", "end", "strand", "coordinate_system", "coordinate_verification"];

class ImportError extends Error {
  code: string;
  constructor(code: string, message: string) { super(message); this.code = code; }
}
function fail(code: string, message: string): never { throw new ImportError(code, message); }
function integer(text: string, field: string): number {
  if (!/^\d+$/.test(text)) fail("coordinates", `${field} must be an integer without separators.`);
  const value = Number(text);
  if (!Number.isSafeInteger(value) || value > 2_147_483_647) fail("coordinates", `${field} is outside the supported GRCh38 range.`);
  return value;
}
function dna(value: string, field: string): string {
  const sequence = value.trim().toUpperCase();
  if (/[-.]/.test(sequence)) fail("gaps", `${field} contains gaps/bulges. Gapped pairs cannot be scored; no bases have been removed.`);
  if (!/^[ACGT]{23}$/.test(sequence)) fail("sequence", `${field} needs 23 actual A/C/G/T bases (20-nt spacer + its actual 3-nt PAM). Placeholder N/PAM motifs and 20-nt sequences are not accepted.`);
  return sequence;
}
function guide(sequence: string, fallback: string | undefined): string {
  const value = sequence.trim().toUpperCase();
  if (/[-.]/.test(value)) return dna(value, "Guide");
  if (/^[ACGT]{23}$/.test(value)) return value;
  const supplied = dna(fallback ?? "", "Supplied guide");
  if (value && (!/^[ACGT]{20}(?:[ACGTN]{3})?$/.test(value) || supplied.slice(0, 20) !== value.slice(0, 20)))
    fail("guide", "The supplied guide does not match this row's 20-nt spacer. Import guides separately or provide full 23-nt guides per row.");
  // Known PAM bases must agree; only explicit N placeholders can be replaced.
  if (value.length === 23 && [...value.slice(20)].some((base, index) => base !== "N" && base !== supplied[20 + index]))
    fail("guide", "The supplied actual guide PAM conflicts with a known PAM base in this row.");
  return supplied;
}
function reverseComplement(value: string): string {
  const complement: Record<string, string> = { A: "T", C: "G", G: "C", T: "A" };
  return [...value].reverse().map((base) => complement[base]).join("");
}
function locus(chromosome: string, first: string, last: string | null, strand: string, oneBased: boolean) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/.test(chromosome)) fail("coordinates", "Use a plain chromosome/contig name without a range or spaces.");
  if (strand !== "+" && strand !== "-") fail("strand", "Candidate strand must be '+' or '-'; the guide's strand is not the candidate's strand.");
  const start = integer(first, "Start") - (oneBased ? 1 : 0);
  const end = last === null ? start + 23 : integer(last, "End");
  if (start < 0 || end > 2_147_483_647 || end - start !== 23) fail("coordinates", "The interval must cover 23 bases including the PAM. Check the coordinate convention and interval length.");
  return { chromosome, start, end, strand: strand as "+" | "-" };
}
function identifier(value: string, fallback: string): string {
  const id = value || fallback;
  if (id.length > 200 || /[\x00-\x1f\x7f]/.test(id)) fail("identifier", "Identifiers need at most 200 printable characters.");
  return id;
}
function csvCell(value: unknown): string {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** Strict, bounded browser-only adapters. Issues block the whole apply operation. */
export function previewToolImport(text: string, options: ToolImportOptions): ToolImportPreview {
  const result: ToolImportPreview = { rows: [], csv: "", issues: [], warnings: [], inputRows: 0, canApply: false };
  const issue = (row: number | null, error: unknown) => result.issues.push({ row, code: error instanceof ImportError ? error.code : "format", message: error instanceof Error ? error.message : String(error) });
  if (options.assembly !== "GRCh38") issue(null, new ImportError("assembly", "Explicitly confirm that these loci use GRCh38. No assembly conversion is performed."));
  if (text.length > MAX_BYTES || new TextEncoder().encode(text).byteLength > MAX_BYTES) { issue(null, "Use a file smaller than 5 MiB."); return result; }
  if (!text.trim()) { issue(null, "Paste an export or choose a file first."); return result; }
  let records: string[][], headers: string[] = [];
  try {
    // Cas-OFFinder 2.4.1 is explicitly headerless and TAB separated.
    const delimiter = options.format === "cas-offinder-2.4.1" || text.split(/\r?\n/, 1)[0].includes("\t") ? "\t" : ",";
    records = parseTable(text, delimiter);
    if (options.format !== "cas-offinder-2.4.1") headers = (records.shift() ?? []).map((name) => name.trim());
    if (new Set(headers).size !== headers.length) fail("format", "Duplicate headers are ambiguous. Use unique column names.");
    result.inputRows = records.length;
    if (!records.length) fail("format", "The export contains no candidate rows.");
    if (records.length > MAX_ROWS) fail("limit", "Import at most 60,000 pairs per job. Split this export into smaller files.");
    const required = options.format === "crispor-offtargets" ? ["guideId", "guideSeq", "offtargetSeq", "chrom", "start", "end", "strand"]
      : options.format === "chopchop-compatible" ? ["Target sequence", "Genomic location", "Strand"] : [];
    const missing = required.filter((name) => !headers.includes(name));
    if (missing.length) fail("format", `This supported format requires ${missing.join(", ")}. Use the generic column mapper for other variants. CHOPCHOP native off-target exports lack candidate strand and need explicit enrichment.`);
    if (options.format === "chopchop-compatible" && (!options.coordinateSystem || !options.candidateOrientation))
      fail("declaration", "Declare the CHOPCHOP-compatible table's coordinate convention and candidate sequence orientation before import.");
  } catch (error) { issue(null, error); return result; }
  records.forEach((fields, index) => {
    const number = index + 1;
    try {
      let target: string, candidate: string, coordinates: ReturnType<typeof locus>, guideId: string, sourceId: string;
      if (options.format === "cas-offinder-2.4.1") {
        if (fields.length !== 6) fail("format", "Cas-OFFinder 2.4.1 requires exactly six TAB-separated columns without a header. Bulge/newer nine-column output is unsupported; use an ungapped export.");
        target = guide(fields[0], options.guide23);
        candidate = dna(fields[3], "Candidate");
        coordinates = locus(fields[1], fields[2], null, fields[4], false);
        const mismatch = integer(fields[5], "Mismatch count");
        if (mismatch > 23) fail("format", "Mismatch count exceeds the ungapped sequence length.");
        guideId = identifier(options.guideId ?? "", target);
        sourceId = `line-${number}`;
      } else {
        if (fields.length !== headers.length) fail("format", "Column count differs from the header. Check the delimiter and quoting.");
        const row: Record<string, string> = Object.fromEntries(headers.map((header, column) => [header, fields[column]]));
        if (options.format === "crispor-offtargets") {
          target = guide(row.guideSeq, options.guide23);
          candidate = dna(row.offtargetSeq, "Candidate");
          // Upstream iterOfftargetRows uses parsePos on start+1,end display coordinates.
          coordinates = locus(row.chrom, row.start, row.end, row.strand, true);
          guideId = identifier(row.seqId ? `${row.seqId}:${row.guideId}` : row.guideId, `guide-${number}`);
          sourceId = identifier(row.id || `line-${number}`, `line-${number}`);
        } else {
          if (headers.some((header) => /^MM[0-9]$/.test(header))) fail("format", "This is a CHOPCHOP guide ranking table with off-target counts, not individual candidate sequences. Export candidate loci and add their actual strands.");
          const candidateText = row["Target sequence"].trim();
          const pam = (row.PAM ?? "").trim();
          // A supplied PAM is only concatenated to a declared guide-oriented 20-mer.
          if (candidateText.length === 20 && pam && options.candidateOrientation !== "guide-oriented") fail("orientation", "A separate PAM can be joined only when the 20-nt candidate is explicitly guide-oriented.");
          candidate = dna(candidateText.length === 20 && pam ? candidateText + pam : candidateText, "Candidate");
          target = guide(row["Guide sequence"] ?? "", options.guide23);
          const match = /^([^:]+):(\d+)(?:-(\d+))?$/.exec(row["Genomic location"]);
          if (!match) fail("coordinates", "Genomic location must be chromosome:start or chromosome:start-end, spanning the full 23-nt site.");
          coordinates = locus(match[1], match[2], match[3] ?? null, row.Strand, options.coordinateSystem === "1-based inclusive");
          if (options.candidateOrientation === "forward-reference" && coordinates.strand === "-") candidate = reverseComplement(candidate);
          guideId = identifier(row.guide_id || options.guideId || "", target);
          sourceId = identifier(row.id || row.ID || `line-${number}`, `line-${number}`);
        }
      }
      result.rows.push({ id: identifier(`${toolNames[options.format]}:${number}`, `pair-${number}`), guide_id: guideId, target, off_target: candidate,
        source_tool: toolNames[options.format], source_format: options.format, source_id: sourceId, assembly: "GRCh38", ...coordinates,
        coordinate_system: COORDINATE_SYSTEM, coordinate_verification: VERIFIED });
    } catch (error) { issue(number, error); }
  });
  result.warnings.push("Imported coordinates are user-supplied, not reference-verified. Sequences are scored as supplied; annotations describe the declared locus.", "The source tool's search scope and filtering are retained conceptually: importing does not perform a new genome search or recover omitted candidates.");
  const gapRows = result.issues.filter((entry) => entry.code === "gaps").length;
  if (gapRows) result.warnings.push(`${gapRows} row(s) contain unsupported gaps or bulges. They block the import; no rows or bases have been removed.`);
  if (options.format === "chopchop-compatible") result.warnings.push("This adapter accepts an enriched candidate table, not native CHOPCHOP summary counts or strand-less .offtargets files.");
  if (result.rows.some((row) => !row.target.endsWith("GG"))) result.warnings.push("At least one guide PAM is not NGG, outside the guide PAMs in the supplied training set.");
  const keys = result.rows.map((row) => JSON.stringify([row.guide_id, row.target, row.off_target, row.chromosome, row.start, row.strand]));
  const duplicates = keys.length - new Set(keys).size;
  if (duplicates) result.warnings.push(`${duplicates} duplicate candidate row(s) are preserved, with separate input row identities.`);
  result.canApply = result.issues.length === 0 && result.rows.length > 0;
  if (result.canApply) result.csv = [outputFields.join(","), ...result.rows.map((row) => outputFields.map((field) => csvCell(row[field])).join(","))].join("\n") + "\n";
  if (result.csv && new TextEncoder().encode(result.csv).byteLength > MAX_BYTES) {
    issue(null, new ImportError("limit", "The normalized table exceeds 5 MiB after adding provenance. Split this export into smaller files."));
    result.canApply = false;
    result.csv = "";
  }
  return result;
}

export const SYNTHETIC_TOOL_IMPORTS: Record<ToolImportFormat, string> = {
  "cas-offinder-2.4.1": "AAAAAAAAAAAAAAAAAAAANNN\tchr1\t100\tAAAAAAAAAAAAAAAAAAAcAGG\t+\t1\n",
  "crispor-offtargets": "guideId\tguideSeq\tofftargetSeq\tchrom\tstart\tend\tstrand\nlaboratory-demo\tAAAAAAAAAAAAAAAAAAAAAGG\tAAAAAAAAAAAAAAAAAAACAGG\tchr1\t101\t123\t-\n",
  "chopchop-compatible": "id,Guide sequence,Target sequence,Genomic location,Strand\nsynthetic-site,AAAAAAAAAAAAAAAAAAAAAGG,AAAAAAAAAAAAAAAAAAACAGG,chr1:101-123,+\n",
};
