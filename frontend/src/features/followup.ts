import type { ResultRow } from "../api.ts";

export interface ContextRecord {
  id: string; row_index?: number; off_target: string; chromosome?: string;
  start?: number; end?: number; strand?: string; assembly?: string; coordinate_system?: string;
  requested_chromosome?: string;
}
export interface ContextRequest { records: ContextRecord[]; flank_bases: number }
export interface ReferenceContext {
  start: number; end: number; sequence: string; sequence_sha256: string;
  sequence_orientation: "forward reference"; coordinate_system: "0-based half-open";
  target_start_offset: number; target_end_offset: number;
  left_bases: number; right_bases: number; left_clipped: boolean; right_clipped: boolean;
  ambiguous_bases: number;
}
export interface ContextResult {
  selection_index: number; candidate: ContextRecord;
  status: "ready" | "skipped"; reason_code?: string; reason?: string;
  fasta_id?: string; context?: ReferenceContext;
}
export interface ContextDocument {
  schema_version: "1.0"; complete: true; flank_bases: number;
  summary: { selected: number; ready: number; skipped: number };
  records: ContextResult[]; fasta: string; fasta_sha256: string;
  reference: { assembly: "GRCh38"; sha256: string; filename: string; scope: string };
  coordinate_system: "0-based half-open"; sequence_orientation: "forward reference";
  limitations: string[];
}

/** Send only declared sequence and locus fields, never scores or job credentials. */
export function contextRequest(rows: ResultRow[], flank: string): ContextRequest {
  if (rows.length < 1 || rows.length > 20) throw new Error("Select between 1 and 20 candidate rows in the results table.");
  if (!/^\d+$/.test(flank) || Number(flank) > 1000) throw new Error("Choose an integer flank length from 0 to 1,000 bases per side.");
  return {
    flank_bases: Number(flank),
    records: rows.map((row) => ({
      id: String(row.id), ...(row.row_index !== undefined ? { row_index: row.row_index } : {}),
      off_target: row.off_target, chromosome: row.chromosome,
      start: row.start, end: row.end, strand: row.strand, assembly: row.assembly,
      coordinate_system: row.coordinate_system,
    })),
  };
}

const hash = /^[a-f0-9]{64}$/;
const reverse = (sequence: string) => [...sequence].reverse().map((base) => ({ A: "T", C: "G", G: "C", T: "A" })[base]).join("");
const recordFields = ["id", "row_index", "off_target", "chromosome", "start", "end", "strand", "assembly", "coordinate_system"] as const;
export const contextSkipCodes = new Set(["unsupported_assembly", "unsupported_coordinates", "missing_coordinates", "invalid_locus", "invalid_candidate_sequence", "unknown_contig", "out_of_bounds", "reference_sequence_mismatch"]);
const alias = (name: string | undefined) => name === "chrM" ? "MT" : /^(?:chr)?(?:[1-9]|1[0-9]|2[0-2]|X|Y)$/.test(name || "") ? name!.replace(/^chr/, "") : name;
const boundedText = (value: unknown, limit: number) => typeof value === "string" && value.length > 0 && value.length <= limit && !/[\x00-\x1f\x7f]/.test(value);

/** Candidate declarations are exact; only the server's documented canonical aliases may change. */
function candidateMatches(candidate: ContextRecord, submitted: ContextRecord, ready: boolean): boolean {
  if (Object.keys(candidate).some(key => ![...recordFields, "requested_chromosome"].includes(key as typeof recordFields[number]))) return false;
  return recordFields.every(key => {
    if (ready && key === "off_target") return candidate[key] === submitted[key].toUpperCase();
    if (ready && key === "chromosome") return alias(candidate[key]) === alias(submitted[key]);
    if (ready && key === "coordinate_system") return candidate[key] === "0-based half-open" && ["0-based half-open", "0-based half-open, forward-reference coordinates"].includes(submitted[key] || "");
    return candidate[key] === submitted[key];
  }) && (candidate.requested_chromosome === undefined || (ready && candidate.requested_chromosome === submitted.chromosome));
}

/** Fail closed if a response loses a selection or misstates coordinate geometry. */
export function validateContextDocument(document: ContextDocument, request: ContextRequest): ContextDocument {
  const invalid = () => { throw new Error("The server returned incomplete or incompatible reference context. Please retry."); };
  if (!document || document.schema_version !== "1.0" || !document.complete
      || document.flank_bases !== request.flank_bases || document.reference?.assembly !== "GRCh38"
      || !hash.test(document.reference.sha256) || !hash.test(document.fasta_sha256)
      || document.coordinate_system !== "0-based half-open" || document.sequence_orientation !== "forward reference"
      || !Array.isArray(document.records) || document.records.length !== request.records.length
      || document.summary?.selected !== request.records.length || typeof document.fasta !== "string"
      || document.fasta.length > 50_000 || !boundedText(document.reference.filename, 200) || !boundedText(document.reference.scope, 500)
      || !Array.isArray(document.limitations) || document.limitations.length > 20 || document.limitations.some(text => !boundedText(text, 1000))) return invalid();
  let ready = 0;
  document.records.forEach((entry, index) => {
    const submitted = request.records[index];
    if (!entry || entry.selection_index !== index || !entry.candidate || entry.candidate.id !== submitted.id
        || entry.candidate.row_index !== submitted.row_index || !candidateMatches(entry.candidate, submitted, entry.status === "ready")) return invalid();
    if (entry.status === "skipped") {
      if (!boundedText(entry.reason, 1000) || !contextSkipCodes.has(entry.reason_code || "")
          || entry.context !== undefined || entry.fasta_id !== undefined) return invalid();
      return;
    }
    if (entry.status !== "ready" || entry.fasta_id !== `candidate_${index + 1}`) return invalid();
    const context = entry.context, candidate = entry.candidate;
    if (!context || candidate.assembly !== "GRCh38" || !["+", "-"].includes(candidate.strand || "")
        || candidate.coordinate_system !== "0-based half-open" || candidate.start !== submitted.start || candidate.end !== submitted.end
        || candidate.strand !== submitted.strand || candidate.off_target !== submitted.off_target.toUpperCase()
        || !Number.isSafeInteger(context.start) || !Number.isSafeInteger(context.end) || context.start < 0
        || context.end - context.start < 23 || context.end - context.start > 2023
        || !/^[ACGTRYSWKMBDHVN]+$/.test(context.sequence) || context.sequence.length !== context.end - context.start
        || !hash.test(context.sequence_sha256) || context.sequence_orientation !== "forward reference"
        || context.coordinate_system !== "0-based half-open"
        || !Number.isSafeInteger(context.target_start_offset) || !Number.isSafeInteger(context.target_end_offset)
        || context.target_start_offset < 0 || context.target_end_offset > context.sequence.length
        || context.target_end_offset - context.target_start_offset !== 23
        || context.start + context.target_start_offset !== candidate.start || context.start + context.target_end_offset !== candidate.end
        || context.left_bases !== context.target_start_offset || context.right_bases !== context.sequence.length - context.target_end_offset
        || context.left_bases > request.flank_bases || context.right_bases > request.flank_bases
        || context.left_clipped !== (context.left_bases < request.flank_bases)
        || context.right_clipped !== (context.right_bases < request.flank_bases)
        || context.ambiguous_bases !== [...context.sequence].filter((base) => !"ACGT".includes(base)).length) return invalid();
    const site = context.sequence.slice(context.target_start_offset, context.target_end_offset);
    if ((candidate.strand === "+" ? site : reverse(site)) !== candidate.off_target) return invalid();
    ready += 1;
  });
  if (document.summary.ready !== ready || document.summary.skipped !== request.records.length - ready
      || (document.fasta.match(/^>/gm) || []).length !== ready) return invalid();
  // Match every FASTA record to its validated context, not just the number of headers.
  const blocks = document.fasta ? document.fasta.trimEnd().split(/\n(?=>)/) : [];
  const prepared = document.records.filter(entry => entry.status === "ready");
  if (blocks.length !== prepared.length || blocks.some((block, index) => {
    const lines = block.split("\n");
    return !lines[0].startsWith(`>${prepared[index].fasta_id}`) || lines[0].split(/\s/, 1)[0] !== `>${prepared[index].fasta_id}`
      || lines.slice(1).join("") !== prepared[index].context!.sequence;
  })) return invalid();
  return document;
}

/** SHA-256 checks detect corrupt exports/responses; they are not server signatures. */
export async function verifyContextHashes(document: ContextDocument): Promise<void> {
  const digest = async (text: string) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)))].map(byte => byte.toString(16).padStart(2, "0")).join("");
  if (await digest(document.fasta) !== document.fasta_sha256) throw new Error("Reference FASTA checksum does not match its recorded data.");
  for (const entry of document.records) {
    if (entry.context && await digest(entry.context.sequence) !== entry.context.sequence_sha256) throw new Error("A reference sequence checksum does not match its recorded data.");
  }
}

export function contextMetadata(document: ContextDocument): string {
  const { fasta: _fasta, ...metadata } = document;
  return JSON.stringify(metadata, null, 2) + "\n";
}
