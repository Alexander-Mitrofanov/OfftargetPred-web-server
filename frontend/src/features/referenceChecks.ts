import type { ResultRow } from "../api.ts";
import { contextRequest, validateContextDocument, verifyContextHashes } from "./followup.ts";
import type { ContextDocument, ContextRecord, ContextRequest, ContextResult } from "./followup.ts";
import { candidateKey } from "./resultIdentity.ts";

export const MAX_REFERENCE_CHECK_BATCHES = 50;
export type ReferenceCheckStatus = "unchecked" | "match" | "mismatch" | "ineligible" | "unavailable";
export interface ReferenceCheckBinding {
  candidate_key: string;
  target: string;
  guide_id?: string;
  request: ContextRecord;
}
export interface ReferenceCheckBatch {
  id: string;
  /** Browser observation time, not a server timestamp or signature. */
  checked_at: string;
  origin: "current-session" | "saved-file";
  purpose: "check" | "flanks";
  bindings: ReferenceCheckBinding[];
  request: ContextRequest;
  document?: ContextDocument;
  unavailable_reason?: string;
}
export interface ReferenceCheckState { schema_version: "1.0"; batches: ReferenceCheckBatch[] }
export interface ReferenceCheckOutcome {
  status: ReferenceCheckStatus;
  label: string;
  reason?: string;
  checked_at?: string;
  origin?: ReferenceCheckBatch["origin"];
  reference_sha256?: string;
  batch_id?: string;
  record?: ContextResult;
}

export function emptyReferenceChecks(): ReferenceCheckState { return { schema_version: "1.0", batches: [] }; }
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const obj = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown, max: number) => typeof value === "string" && value.length > 0 && value.length <= max && !/[\x00-\x1f\x7f]/.test(value);
const only = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).every(key => keys.includes(key));
const fields = ["id", "row_index", "off_target", "chromosome", "start", "end", "strand", "assembly", "coordinate_system"] as const;
const sameRecord = (left: ContextRecord, right: ContextRecord) => fields.every(key => left[key] === right[key]);

export function referenceCheckBinding(row: ResultRow): ReferenceCheckBinding {
  return { candidate_key: candidateKey(row), target: row.target, ...(row.guide_id !== undefined ? { guide_id: row.guide_id } : {}), request: contextRequest([row], "0").records[0] };
}
function sameBinding(left: ReferenceCheckBinding, right: ReferenceCheckBinding) {
  return left.candidate_key === right.candidate_key && left.target === right.target && left.guide_id === right.guide_id && sameRecord(left.request, right.request);
}

function recordShape(value: unknown): value is ContextRecord {
  if (!obj(value) || !only(value, [...fields]) || !text(value.id, 200) || !text(value.off_target, 100)) return false;
  for (const key of ["row_index", "start", "end"]) {
    if (value[key] !== undefined && (!Number.isSafeInteger(value[key]) || (key === "row_index" && Number(value[key]) < 0))) return false;
  }
  for (const [key, max] of [["chromosome", 200], ["strand", 10], ["assembly", 30], ["coordinate_system", 100]] as const) {
    if (value[key] !== undefined && !text(value[key], max)) return false;
  }
  return true;
}

/** Exact original-row joins are required; a saved status is never a fresh attestation. */
export function validateReferenceChecks(value: unknown, rows: ResultRow[]): ReferenceCheckState {
  const fail = (): never => { throw new Error("Saved reference checks are invalid or do not match the exact analysis rows."); };
  if (!obj(value) || !only(value, ["schema_version", "batches"]) || value.schema_version !== "1.0" || !Array.isArray(value.batches) || value.batches.length > MAX_REFERENCE_CHECK_BATCHES) return fail();
  const index = new Map<string, ReferenceCheckBinding[]>();
  for (const row of rows) {
    const binding = referenceCheckBinding(row);
    const existing = index.get(binding.candidate_key);
    if (existing) existing.push(binding); else index.set(binding.candidate_key, [binding]);
  }
  const ids = new Set<string>();
  const batches = value.batches.map((raw): ReferenceCheckBatch => {
    if (!obj(raw) || !only(raw, ["id", "checked_at", "origin", "purpose", "bindings", "request", "document", "unavailable_reason"])
      || !text(raw.id, 100) || ids.has(String(raw.id)) || typeof raw.checked_at !== "string"
      || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(raw.checked_at)
      || !Number.isFinite(Date.parse(raw.checked_at)) || new Date(raw.checked_at).toISOString() !== raw.checked_at
      || !["current-session", "saved-file"].includes(String(raw.origin)) || !["check", "flanks"].includes(String(raw.purpose))
      || !Array.isArray(raw.bindings) || raw.bindings.length < 1 || raw.bindings.length > 20
      || !obj(raw.request) || !only(raw.request, ["records", "flank_bases"]) || !Array.isArray(raw.request.records)
      || raw.request.records.length !== raw.bindings.length || !Number.isInteger(raw.request.flank_bases)
      || Number(raw.request.flank_bases) < 0 || Number(raw.request.flank_bases) > 1000
      || (raw.purpose === "check" && raw.request.flank_bases !== 0)) return fail();
    ids.add(String(raw.id));
    const selected = new Set<string>();
    raw.bindings.forEach((binding, position) => {
      if (!obj(binding) || !only(binding, ["candidate_key", "target", "guide_id", "request"])
        || !text(binding.candidate_key, 2000) || !text(binding.target, 100)
        || (binding.guide_id !== undefined && !text(binding.guide_id, 500)) || !recordShape(binding.request)
        || !recordShape((raw.request as unknown as ContextRequest).records[position])) return fail();
      const typed = binding as unknown as ReferenceCheckBinding;
      if (!sameRecord(typed.request, (raw.request as unknown as ContextRequest).records[position])
        || selected.has(typed.candidate_key) || (index.get(typed.candidate_key) || []).filter(item => sameBinding(item, typed)).length !== 1) return fail();
      selected.add(typed.candidate_key);
    });
    const batch = raw as unknown as ReferenceCheckBatch;
    if (raw.document !== undefined) {
      if (raw.unavailable_reason !== undefined || !obj(raw.document)) return fail();
      try { validateContextDocument(batch.document!, batch.request); } catch { return fail(); }
      // Reject unexpected payload fields so credentials/unrelated data cannot hide in an archive entry.
      if (!only(raw.document, ["schema_version", "complete", "flank_bases", "summary", "records", "fasta", "fasta_sha256", "reference", "coordinate_system", "sequence_orientation", "limitations"])) return fail();
      if (!obj(raw.document.reference) || !only(raw.document.reference, ["assembly", "sha256", "filename", "scope"])
        || !obj(raw.document.summary) || !only(raw.document.summary, ["selected", "ready", "skipped"])) return fail();
      for (const record of batch.document!.records) {
        if (!only(record as unknown as Record<string, unknown>, ["selection_index", "candidate", "status", "reason_code", "reason", "fasta_id", "context"])) return fail();
        if (record.context && !only(record.context as unknown as Record<string, unknown>, ["start", "end", "sequence", "sequence_sha256", "sequence_orientation", "coordinate_system", "target_start_offset", "target_end_offset", "left_bases", "right_bases", "left_clipped", "right_clipped", "ambiguous_bases"])) return fail();
      }
    } else if (!text(raw.unavailable_reason, 1000)) return fail();
    return { ...clone(batch), origin: "saved-file" };
  });
  return { schema_version: "1.0", batches };
}

/** Call after structural validation when opening an archive. No network or inference. */
export async function verifyReferenceChecksIntegrity(state: ReferenceCheckState): Promise<void> {
  for (const batch of state.batches) if (batch.document) await verifyContextHashes(batch.document);
}

export async function createReferenceCheckBatch(rows: ResultRow[], request: ContextRequest,
  options: { purpose: "check" | "flanks"; document?: ContextDocument; unavailableReason?: string; checkedAt?: string; id?: string }): Promise<ReferenceCheckBatch> {
  const batch: ReferenceCheckBatch = { id: options.id ?? crypto.randomUUID(), checked_at: options.checkedAt ?? new Date().toISOString(),
    origin: "current-session", purpose: options.purpose, bindings: rows.map(referenceCheckBinding), request: clone(request),
    ...(options.document ? { document: clone(options.document) } : { unavailable_reason: options.unavailableReason || "The reference check could not be completed. No agreement result is available." }) };
  const validated = validateReferenceChecks({ schema_version: "1.0", batches: [batch] }, rows);
  await verifyReferenceChecksIntegrity(validated);
  return { ...validated.batches[0], origin: "current-session" };
}

/** Keep all accepted batches until the explicit bound; never silently discard earlier provenance. */
export function appendReferenceCheck(state: ReferenceCheckState, batch: ReferenceCheckBatch): ReferenceCheckState {
  if (state.batches.length >= MAX_REFERENCE_CHECK_BATCHES) throw new Error("This analysis contains 50 reference-check batches. Save the analysis before starting a separate workspace.");
  if (state.batches.some(existing => existing.id === batch.id)) throw new Error("A reference-check batch with this identifier already exists.");
  return { schema_version: "1.0", batches: [...state.batches, clone(batch)] };
}

export function referenceCheckForRow(state: ReferenceCheckState | undefined, row: ResultRow): ReferenceCheckOutcome {
  const binding = referenceCheckBinding(row);
  for (const batch of [...(state?.batches || [])].reverse()) {
    const position = batch.bindings.findIndex(saved => sameBinding(saved, binding));
    if (position < 0) continue;
    const common = { checked_at: batch.checked_at, origin: batch.origin, batch_id: batch.id, reference_sha256: batch.document?.reference.sha256 };
    const record = batch.document?.records[position];
    if (!record) return { ...common, status: "unavailable", label: "Check unavailable", reason: batch.unavailable_reason };
    if (record.status === "ready") return { ...common, record, status: "match", label: batch.origin === "saved-file" ? "Recorded reference match" : "Reference match" };
    const mismatch = record.reason_code === "reference_sequence_mismatch";
    return { ...common, record, status: mismatch ? "mismatch" : "ineligible", label: `${batch.origin === "saved-file" ? "Recorded: " : ""}${mismatch ? "reference mismatch" : "ineligible for reference check"}`, reason: record.reason };
  }
  return { status: "unchecked", label: "Unchecked" };
}
