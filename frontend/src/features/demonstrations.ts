import type { AnalysisDocument, Job, ResultRow, Submission } from "../api.ts";

export interface Demonstration {
  id: string;
  kind: "result" | "validation";
  title: string;
  summary: string;
  tasks: string[];
  input: Submission;
  settings: Record<string, unknown>;
  expected_observations: string[];
  provenance: Record<string, unknown>;
  document_filename: string | null;
  document_sha256: string | null;
  completed_job: Job | null;
  expected_error?: { http_status: number; detail: string };
}

export interface DemonstrationManifest {
  schema_version: 1;
  generated_at: string;
  note: string;
  scenarios: Demonstration[];
}

export interface LoadedDemonstration {
  document: AnalysisDocument;
  integrity: "verified" | "unavailable";
}

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const strings = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");
const models = (value: unknown) =>
  Array.isArray(value) && value.length > 0 && value.length <= 3 &&
  new Set(value).size === value.length && value.every((item) => [1, 2, 3].includes(item));
const fileName = /^[a-z0-9][a-z0-9-]*\.json$/;

function invalid(part: string): never {
  throw new Error(`This example has an unsupported or inconsistent ${part}. Reload the page and retry.`);
}

export function validateManifest(value: unknown): DemonstrationManifest {
  if (!record(value) || value.schema_version !== 1 || typeof value.generated_at !== "string" ||
      !Number.isFinite(Date.parse(value.generated_at)) || typeof value.note !== "string" ||
      !Array.isArray(value.scenarios) || !value.scenarios.length || value.scenarios.length > 20) invalid("manifest");
  const ids = new Set<string>();
  for (const scenario of value.scenarios) {
    if (!record(scenario) || typeof scenario.id !== "string" || !/^[a-z0-9-]+$/.test(scenario.id) ||
        ids.has(scenario.id) || !["result", "validation"].includes(String(scenario.kind)) ||
        typeof scenario.title !== "string" || typeof scenario.summary !== "string" ||
        !strings(scenario.tasks) || !strings(scenario.expected_observations) ||
        !record(scenario.settings) || !record(scenario.provenance) || !record(scenario.input)) invalid("scenario");
    ids.add(scenario.id);
    const input = scenario.input;
    if (!["pairs", "genome"].includes(String(input.mode)) || typeof input.input !== "string" ||
        typeof input.name !== "string" || !["csv", "tsv", "text", "fasta"].includes(String(input.format)) || !models(input.models)) invalid("input");
    if (input.mode === "genome" && (input.assembly !== "GRCh38" || !Number.isInteger(input.max_mismatches) ||
        Number(input.max_mismatches) < 0 || Number(input.max_mismatches) > 4)) invalid("search scope");
    if (input.intended_loci !== undefined && (!Array.isArray(input.intended_loci) || input.intended_loci.some((locus) =>
      !record(locus) || typeof locus.target !== "string" || !/^[ACGT]{23}$/.test(locus.target) ||
      typeof locus.chromosome !== "string" || !Number.isInteger(locus.start) || Number(locus.start) < 0 ||
      !Number.isInteger(locus.end) || Number(locus.end) - Number(locus.start) !== 23 ||
      !["+", "-"].includes(String(locus.strand)) || locus.assembly !== "GRCh38"))) invalid("selected locus");
    if (scenario.kind === "result") {
      const job = scenario.completed_job;
      if (typeof scenario.document_filename !== "string" || !fileName.test(scenario.document_filename) ||
          typeof scenario.document_sha256 !== "string" || !/^[a-f0-9]{64}$/.test(scenario.document_sha256) ||
          !record(job) || job.id !== `demonstration-${scenario.id}` || job.status !== "completed" ||
          job.mode !== input.mode || !models(job.models) || JSON.stringify(job.models) !== JSON.stringify(input.models) ||
          !Number.isInteger(job.result_count) || Number(job.result_count) < 0 || Number(job.result_count) > 100 ||
          typeof job.created_at !== "string" || scenario.provenance.complete_result !== true) invalid("recorded result");
    } else if (scenario.document_filename !== null || scenario.document_sha256 !== null || scenario.completed_job !== null ||
        !record(scenario.expected_error) || scenario.expected_error.http_status !== 422 ||
        typeof scenario.expected_error.detail !== "string") invalid("validation example");
  }
  return value as unknown as DemonstrationManifest;
}

function validRow(row: unknown): row is ResultRow {
  if (!record(row) || !["string", "number"].includes(typeof row.id) || !Number.isInteger(row.row_index) ||
      typeof row.target !== "string" || !/^[ACGTN]{23}$/.test(row.target) ||
      typeof row.off_target !== "string" || !/^[ACGTN]{23}$/.test(row.off_target) || !record(row.scores) ||
      Object.entries(row.scores).some(([key, score]) => !/^k[123]$/.test(key) || typeof score !== "number" || !Number.isFinite(score))) return false;
  if (row.annotations !== undefined) {
    const annotation = row.annotations;
    if (!record(annotation) || !["annotated", "unavailable", "no_coordinates"].includes(String(annotation.status)) ||
        !strings(annotation.categories) || !Array.isArray(annotation.features) || annotation.features.some((feature) =>
          !record(feature) || typeof feature.gene_id !== "string" || typeof feature.gene_name !== "string" ||
          typeof feature.feature !== "string" || !Number.isInteger(feature.start) || !Number.isInteger(feature.end) ||
          typeof feature.strand !== "string")) return false;
  }
  if (row.warnings !== undefined && !strings(row.warnings)) return false;
  if (row.baselines !== undefined && (!record(row.baselines) || (row.baselines.cfd !== undefined &&
      (!record(row.baselines.cfd) || typeof row.baselines.cfd.version !== "string" ||
      (row.baselines.cfd.score !== null && (typeof row.baselines.cfd.score !== "number" || !Number.isFinite(row.baselines.cfd.score))))))) return false;
  return true;
}

export function validateDemonstrationDocument(value: unknown, scenario: Demonstration): AnalysisDocument {
  if (scenario.kind !== "result" || !record(value) || !Array.isArray(value.rows) || value.rows.length > 100 ||
      value.rows.length !== scenario.completed_job?.result_count || !value.rows.every(validRow) ||
      !record(value.metadata) || value.metadata.schema_version !== "2.0" ||
      value.metadata.mode !== scenario.input.mode || value.metadata.candidate_count !== value.rows.length ||
      !record(value.metadata.demonstration)) invalid("result document");
  if (new Set(value.rows.map((row) => row.row_index)).size !== value.rows.length) invalid("row identity");
  return value as unknown as AnalysisDocument;
}

/** A fresh copy prevents form edits from changing a cached example. */
export function demonstrationInput(scenario: Demonstration): Submission {
  return JSON.parse(JSON.stringify(scenario.input)) as Submission;
}

export function demonstrationAsset(baseUrl: string, filename: string): string {
  if (!fileName.test(filename)) invalid("asset filename");
  return `${baseUrl.replace(/\/?$/, "/")}demonstrations/${filename}`;
}

type LoaderOptions = {
  fetcher?: typeof fetch;
  crypto?: Pick<Crypto, "subtle"> | null;
};

/** Public website assets only. No credentials, API requests, or prediction jobs. */
export function createDemonstrationLoader(baseUrl: string, options: LoaderOptions = {}) {
  const fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis);
  const crypto = options.crypto === undefined ? globalThis.crypto : options.crypto;
  let manifestPromise: Promise<DemonstrationManifest> | undefined;
  const documents = new Map<string, Promise<LoadedDemonstration>>();

  async function read(filename: string): Promise<ArrayBuffer> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetcher(demonstrationAsset(baseUrl, filename), {
        method: "GET", credentials: "omit", referrerPolicy: "no-referrer", signal: controller.signal,
      });
      if (!response.ok) throw new Error(`Example file could not be loaded (HTTP ${response.status}). Check your connection and retry.`);
      const bytes = await response.arrayBuffer();
      if (bytes.byteLength > 2 * 1024 * 1024) invalid("asset size");
      return bytes;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") throw new Error("The example file took too long to load. Check your connection and retry.");
      if (error instanceof TypeError) throw new Error("The example file could not be reached. Check your connection and retry.");
      throw error;
    } finally { clearTimeout(timeout); }
  }

  function parse(bytes: ArrayBuffer): unknown {
    try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
    catch { return invalid("JSON file"); }
  }

  return {
    manifest(): Promise<DemonstrationManifest> {
      manifestPromise ??= read("manifest.json").then((bytes) => validateManifest(parse(bytes))).catch((error) => {
        manifestPromise = undefined;
        throw error;
      });
      return manifestPromise;
    },
    document(scenario: Demonstration): Promise<LoadedDemonstration> {
      if (scenario.kind !== "result" || !scenario.document_filename || !scenario.document_sha256) return Promise.reject(new Error("This validation example has no prediction result."));
      const key = `${scenario.document_filename}:${scenario.document_sha256}`;
      const cached = documents.get(key);
      if (cached) return cached;
      const pending = read(scenario.document_filename).then(async (bytes) => {
        const integrity = crypto?.subtle ? "verified" : "unavailable";
        if (crypto?.subtle) {
          const digest = await crypto.subtle.digest("SHA-256", bytes);
          const hash = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
          if (hash !== scenario.document_sha256) throw new Error("The example file does not match its recorded checksum. Reload the page and retry.");
        }
        return { document: validateDemonstrationDocument(parse(bytes), scenario), integrity } as LoadedDemonstration;
      }).catch((error) => { documents.delete(key); throw error; });
      documents.set(key, pending);
      return pending;
    },
  };
}

const loaders = new Map<string, ReturnType<typeof createDemonstrationLoader>>();
export function demonstrationLoader(baseUrl: string) {
  let loader = loaders.get(baseUrl);
  if (!loader) { loader = createDemonstrationLoader(baseUrl); loaders.set(baseUrl, loader); }
  return loader;
}
