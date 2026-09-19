import { parseRecoveryFragment, validateRecoveryCredentials } from "./features/jobRecovery";
export type ModelId = 1 | 2 | 3;
export type Mode = "pairs" | "genome";
export type Status =
  | "queued"
  | "running"
  | "complete"
  | "completed"
  | "failed"
  | "cancelled"
  | "cancelling";
export interface Capabilities {
  modes: Mode[];
  models: { id: ModelId; key: string; label: string; default?: boolean }[];
  default_models: ModelId[];
  limits: {
    request_bytes: number;
    pairs: number;
    guides: number;
    candidates: number;
    queued: number;
  };
  retention_hours: number;
  genomes: { id: string; label: string }[];
  score_label: string;
  calibrated: boolean;
  annotations?: { available: boolean; source?: string; release?: string; assembly?: string };
  features?: Record<string, boolean>;
  baselines?: Record<string, unknown>;
  worker?: { available: boolean; last_heartbeat?: string };
}
export interface Job {
  id: string;
  status: Status;
  mode: Mode;
  name?: string;
  models: ModelId[];
  created_at: string;
  finished_at?: string;
  expires_at?: string;
  error?: string | { message?: string; detail?: string };
  progress?:
    | string
    | { stage?: string; completed?: number; total?: number; message?: string; queue_seconds?: number; elapsed_seconds?: number; phase_seconds?: Record<string, number> };
  result_count?: number;
  warnings?: string[];
}
export interface ResultRow {
  id: string | number;
  row_index?: number;
  target: string;
  off_target: string;
  scores: Partial<Record<`k${ModelId}`, number>>;
  guide_id?: string;
  chromosome?: string;
  position?: number;
  start?: number;
  end?: number;
  coordinate_system?: string;
  strand?: string;
  assembly?: string;
  mismatches?: number;
  warnings?: string[];
  annotations?: AnnotationResult;
  baselines?: { cfd?: { score: number | null; reason?: string; version: string } };
  mismatch_positions?: number[];
  pam_mismatches?: number;
  exact_match?: boolean;
  protospacer_match?: boolean;
  user_selected_locus?: boolean;
  coordinate_verification?: string;
  source_tool?: string;
  source_format?: string;
  source_id?: string;
  source_chromosome?: string;
  sensitivity_schema?: string;
  sensitivity_panel?: string;
  sensitivity_original_candidate?: string;
  sensitivity_position?: string;
  sensitivity_base?: string;
  sensitivity_original_base?: string;
  sensitivity_source_id?: string;
  sensitivity_source_row?: string;
}
export interface AnnotationFeature {
  gene_id: string;
  gene_name: string;
  transcript_id?: string;
  feature: string;
  start: number;
  end: number;
  strand: string;
}
export interface AnnotationResult {
  status: "annotated" | "unavailable" | "no_coordinates";
  features: AnnotationFeature[];
  categories: string[];
  source?: string;
  release?: string;
  reason?: string;
  transcript_count?: number;
  ambiguous_transcripts?: boolean;
}
export interface AnalysisDocument {
  rows: ResultRow[];
  metadata: Record<string, unknown>;
}
export interface Results {
  total: number;
  offset: number;
  limit: number;
  rows: ResultRow[];
  unfiltered_total?: number;
  metadata?: Record<string, unknown>;
}
export interface Credentials {
  id: string;
  token: string;
}
export interface Submission {
  mode: Mode;
  input: string;
  format: "csv" | "tsv" | "text" | "fasta";
  models: ModelId[];
  name: string;
  assembly?: string;
  max_mismatches?: number;
  intended_loci?: { target: string; chromosome: string; start: number; end: number; strand: string; assembly: string }[];
}
export const apiOrigin =
  (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/+$/, "") ||
  "";
const base = `${apiOrigin}/api/v1`;
const storageKey = `offtargetpred-job:${apiOrigin || window.location.origin}`;

export function restoreJob(): Credentials | null {
  try {
    const credentials = parseRecoveryFragment(window.location.hash);
    if (credentials) {
      rememberJob(credentials);
      window.history.replaceState(
        null,
        "",
        `${window.location.pathname}${window.location.search}#predict`,
      );
      return credentials;
    }
    const data = JSON.parse(sessionStorage.getItem(storageKey) || "null");
    return validateRecoveryCredentials(data);
  } catch {
    return null;
  }
}
export function rememberJob(credentials: Credentials | null) {
  try {
    if (credentials)
      sessionStorage.setItem(storageKey, JSON.stringify(credentials));
    else sessionStorage.removeItem(storageKey);
  } catch {
    /* Scoring still works when session storage is disabled. */
  }
}
function errorText(data: unknown): string {
  if (typeof data === "string") return data;
  if (!data || typeof data !== "object")
    return "The server could not complete this request.";
  const detail =
    (data as Record<string, unknown>).detail ??
    (data as Record<string, unknown>).error ??
    (data as Record<string, unknown>).message;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail))
    return detail
      .map((item) =>
        typeof item === "string"
          ? item
          : item.msg || item.message || "Invalid input",
      )
      .join(" ");
  if (detail && typeof detail === "object") return errorText(detail);
  return "The server could not complete this request.";
}

export class ApiError extends Error {
  status: number;
  retryAfterSeconds?: number;
  constructor(message: string, status: number, retryAfterSeconds?: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export async function api<T>(
  path: string,
  options: RequestInit = {},
  token?: string,
): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 45000);
  try {
    const response = await fetch(`${base}${path}`, {
      ...options,
      signal: options.signal || controller.signal,
      headers: {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers,
      },
      referrerPolicy: "no-referrer",
    });
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      const header = response.headers.get("Retry-After");
      const seconds = header && /^\d+$/.test(header) ? Number(header) : undefined;
      const retry = seconds !== undefined && Number.isSafeInteger(seconds) && seconds <= 3600 ? seconds : undefined;
      const detail = body
          ? errorText(body)
          : `The server returned HTTP ${response.status}. Please retry.`;
      throw new ApiError(
        `${detail}${retry !== undefined ? ` Wait at least ${retry} seconds before retrying.` : ""}`,
        response.status, retry,
      );
    }
    if (response.status === 204) return undefined as T;
    return response.json();
  } catch (error) {
    if (error instanceof TypeError)
      throw new Error(
        "The prediction server could not be reached. Your input is still here. Check your connection and retry.",
      );
    if (error instanceof DOMException && error.name === "AbortError")
      throw new Error(
        "The request timed out. Check the job status before submitting again.",
      );
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}
export async function downloadResult(
  credentials: Credentials,
  format: "csv" | "json",
) {
  const response = await fetch(
    `${base}/jobs/${encodeURIComponent(credentials.id)}/download?format=${format}`,
    {
      headers: { Authorization: `Bearer ${credentials.token}` },
      referrerPolicy: "no-referrer",
    },
  );
  if (!response.ok)
    throw new Error(errorText(await response.json().catch(() => null)));
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `offtargetpred-${credentials.id}.${format}`;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Fetch the complete bounded document before deriving guide-wide summaries. */
export async function fetchAnalysis(credentials: Credentials): Promise<AnalysisDocument> {
  return api<AnalysisDocument>(
    `/jobs/${encodeURIComponent(credentials.id)}/download?format=json`,
    {},
    credentials.token,
  );
}
