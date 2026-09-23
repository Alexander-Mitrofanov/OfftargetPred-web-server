import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, FormEvent, RefObject } from "react";
import { api, apiOrigin, rememberJob, restoreJob } from "./api";
import type {
  Capabilities,
  Credentials,
  Job,
  ModelId,
  Mode,
  Submission,
} from "./api";
import { OpenAnalysis } from "./components/OpenAnalysis";
import { AnalysisReplacement, useAnalysisReplacement } from "./components/AnalysisReplacement";
import type { AnalysisActions } from "./components/AnalysisReplacement";
import type { ImportedAnalysis } from "./features/analysisImports";
import { AnalysisWorkspace } from "./components/AnalysisWorkspace";
import { GuideDiscovery } from "./components/GuideDiscovery";
import { parseRecoveryFragment } from "./features/jobRecovery";
import type { ResolvedGuideLocus } from "./components/GuideResolver";
import { ColumnMapper } from "./components/ColumnMapper";
import { InputGuide } from "./components/InputGuide";
import { ToolImport } from "./components/ToolImport";
import { PrivateJobRecovery } from "./components/PrivateJobRecovery";
import {
  exampleFasta,
  exampleGuide,
  exampleSites,
  exampleTable,
  validateInput,
} from "./input";

type Page = "predict" | "help";
const pageFromHash = (): Page => {
  const value = window.location.hash.slice(1);
  return ["help", "about"].includes(value) ? "help" : "predict";
};

const initialCredentials = restoreJob();
const terminal = (status: string) =>
  ["complete", "completed", "failed", "cancelled"].includes(status);
const successful = (status?: string) =>
  status === "complete" || status === "completed";
const message = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "The request could not be completed.";
const date = (value?: string) =>
  value
    ? new Date(value).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "—";

function Mark() {
  return (
    <svg viewBox="0 0 42 42" aria-hidden="true">
      <rect width="42" height="42" rx="9" fill="currentColor" />
      <g stroke="white" strokeWidth="2.5" strokeLinecap="round">
        <path d="M10 12h22M10 30h22M12 17v8M19 17v8M30 17v8" />
      </g>
      <path
        d="m23 17 4 8"
        stroke="#65d3c4"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  );
}
function Arrow({ down = false }: { down?: boolean }) {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path
        d={
          down ? "M10 3v10m-4-4 4 4 4-4M4 15v2h12v-2" : "M4 10h12m-5-5 5 5-5 5"
        }
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
function Documentation({ capabilities }: { capabilities: Capabilities | null }) {
  return (
    <div className="documentation">
      <div className="page-intro">
        <h1>Help &amp; About</h1>
        <p>The CRISPert web server scores CRISPR candidate sites with three sequence-only CRISPert models.</p>
        <a href="#predict">Back to prediction</a>
      </div>
      <section>
        <h2>Prepare your input</h2>
        <p>Use aligned, 23-base DNA sequences: a 20-base spacer followed by its actual 3-base PAM, written 5′ to 3′. Gaps and bulges are unsupported.</p>
        <p><strong>Candidate pairs:</strong> paste sites for one guide, or upload a CSV/TSV with <code>target</code> and <code>off_target</code> columns. Up to {(capabilities?.limits.pairs ?? 60_000).toLocaleString()} pairs per job; the request size limit also applies.</p>
        <p><strong>Genome search:</strong> enter up to {capabilities?.limits.guides ?? 10} guides with an NGG PAM. Search the installed human GRCh38 reference on both strands with up to six mismatches and no bulges.</p>
      </section>
      <section>
        <h2>Read and save results</h2>
        <p>Higher scores indicate stronger predicted activity. Compare candidates within each model; scores are not calibrated cleavage probabilities. k=1 is the default, with k=2 and k=3 available under Model options.</p>
        <p>Search and sort the candidate table, then download the complete results CSV. The private result link reopens the job until it expires after {capabilities?.retention_hours ?? 24} hours. You can delete it sooner.</p>
      </section>
      <section>
        <h2>About the method</h2>
        <p>Predictions use CRISPert-small sequence models and do not account for individual genome variants or cellular context. Experimental validation is still needed.</p>
        <p>Method: <a href="https://doi.org/10.1007/978-3-031-70368-3_6">CRISPert: A Transformer-Based Model for CRISPR-Cas Off-Target Prediction</a> (Jobson Pargeter, Backofen and Tran, 2024).</p>
      </section>
    </div>
  );
}

function ResultsPanel({ actionsRef, credentials, job, onDelete, onPrepare, referenceContextAvailable }: {
  actionsRef: RefObject<AnalysisActions | null>;
  credentials: Credentials;
  job: Job;
  onDelete: () => void;
  onPrepare: (submission: Submission) => void;
  referenceContextAvailable: boolean;
}) {
  return <AnalysisWorkspace actionsRef={actionsRef} job={job} credentials={credentials} onDelete={onDelete} onPrepare={onPrepare} referenceContextAvailable={referenceContextAvailable}>
    <PrivateJobRecovery credentials={credentials} expiresAt={job?.expires_at} />
  </AnalysisWorkspace>;
}

export default function App() {
  const replacement = useAnalysisReplacement();
  const { request: requestReplacement } = replacement;
  const [localAnalysis, setLocalAnalysis] = useState<{ analysis: ImportedAnalysis; filename: string; key: number; job: Job } | null>(null);
  const localSerial = useRef(0);
  const openAnalysis = (analysis: ImportedAnalysis, filename: string) => requestReplacement(() => {
    const serial = ++localSerial.current;
    const summary = analysis.job;
    const modelIds = ([1, 2, 3] as ModelId[]).filter(model => (Array.isArray(analysis.document.metadata.model_keys) && analysis.document.metadata.model_keys.includes(`k${model}`)) || analysis.document.rows.some(row => row.scores[`k${model}`] !== undefined));
    const localJob: Job = { ...summary, id: `local-${serial}`, status: "completed", mode: summary?.mode ?? (analysis.document.metadata.mode === "genome" ? "genome" : "pairs"), models: summary?.models?.length ? summary.models : modelIds.length ? modelIds : [1], name: summary?.name || filename, created_at: summary?.created_at ?? analysis.savedAt };
    setLocalAnalysis({ analysis, filename, key: serial, job: localJob });
  });
  const [page, setPage] = useState<Page>(pageFromHash);
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null);
  const [connection, setConnection] = useState<
    "connecting" | "connected" | "unavailable"
  >("connecting");
  const [connectionError, setConnectionError] = useState("");
  const [mode, setMode] = useState<Mode>("pairs");
  const [inputMode, setInputMode] = useState<"single" | "table">("single");
  const [guide, setGuide] = useState("");
  const [candidates, setCandidates] = useState("");
  const [table, setTable] = useState("");
  const [genome, setGenome] = useState("");
  const [intendedLoci, setIntendedLoci] = useState<NonNullable<Submission["intended_loci"]>>([]);
  const [assembly, setAssembly] = useState("GRCh38");
  const [maxMismatches, setMaxMismatches] = useState(3);
  const [models, setModels] = useState<ModelId[]>([1]);
  const [name, setName] = useState("");
  const [attempted, setAttempted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [fileName, setFileName] = useState("");
  const [credentials, setCredentials] = useState<Credentials | null>(
    initialCredentials,
  );
  const [job, setJob] = useState<Job | null>(null);
  const [jobError, setJobError] = useState("");
  const [pollVersion, setPollVersion] = useState(0);
  const [busyJob, setBusyJob] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const jobRef = useRef<HTMLDivElement>(null);
  const validation = useMemo(
    () =>
      validateInput(
        mode,
        inputMode,
        guide,
        candidates,
        table,
        genome,
        capabilities,
      ),
    [mode, inputMode, guide, candidates, table, genome, capabilities],
  );
  const hasInput =
    mode === "genome"
      ? Boolean(genome.trim())
      : inputMode === "single"
        ? Boolean(guide.trim() || candidates.trim())
        : Boolean(table.trim());
  const running = Boolean(job && !terminal(job.status));
  const available = Boolean(capabilities?.modes.includes(mode));

  const connect = useCallback(async () => {
    setConnection("connecting");
    setConnectionError("");
    try {
      const data = await api<Capabilities>("/capabilities");
      setCapabilities(data);
      setConnection("connected");
      if (data.genomes.length) setAssembly(data.genomes[0].id);
    } catch (error) {
      setConnection("unavailable");
      setConnectionError(message(error));
    }
  }, []);
  useEffect(() => {
    void connect();
  }, [connect]);
  useEffect(() => {
    const onHash = () => {
      const recovered = parseRecoveryFragment(window.location.hash);
      if (recovered) {
        window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}#predict`);
        requestReplacement(() => { rememberJob(recovered); setLocalAnalysis(null); setCredentials(recovered); setJob(null); setJobError(""); });
      }
      setPage(pageFromHash());
      window.scrollTo({ top: 0 });
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [requestReplacement]);
  useEffect(() => {
    if (!credentials) return;
    let current = true,
      timer = 0;
    const poll = async () => {
      try {
        const result = await api<Job>(
          `/jobs/${encodeURIComponent(credentials.id)}`,
          {},
          credentials.token,
        );
        if (!current) return;
        setJob(result);
        setJobError("");
        if (!terminal(result.status)) timer = window.setTimeout(poll, 2500);
      } catch (error) {
        if (current) setJobError(message(error));
      }
    };
    void poll();
    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [credentials, pollVersion]);
  useEffect(() => {
    if (attempted && (validation.errors.length || !models.length))
      errorRef.current?.focus();
  }, [attempted, validation.errors.length, models.length]);

  const readFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setError("");
    if (file.size > (capabilities?.limits.request_bytes ?? 5242880)) {
      setError(
        "This file exceeds the server’s request limit. Split it into smaller files.",
      );
      return;
    }
    try {
      const text = await file.text();
      setTable(text);
      setInputMode("table");
      setFileName(file.name);
      setAttempted(true);
    } catch {
      setError(
        "The file could not be read. Try pasting its contents into the table field.",
      );
    }
    event.target.value = "";
  };
  const loadExample = () => {
    setIntendedLoci([]);
    if (mode === "genome") setGenome(exampleFasta);
    else if (inputMode === "single") {
      setGuide(exampleGuide);
      setCandidates(exampleSites);
    } else setTable(exampleTable);
    setAttempted(false);
    setError("");
    setFileName("");
  };
  const prepareExample = (submission: Submission) => {
    setMode(submission.mode); setModels(submission.models); setName(submission.name);
    setIntendedLoci(submission.intended_loci ?? []);
    if (submission.mode === "genome") {
      setGenome(submission.input); setAssembly(submission.assembly ?? "GRCh38");
      setMaxMismatches(submission.max_mismatches ?? 3);
    } else { setInputMode("table"); setTable(submission.input); }
    setAttempted(false); setError(""); setFileName("");
    setPage("predict");
    window.location.hash = "predict";
    window.requestAnimationFrame(() => {
      document.getElementById("new-prediction")?.focus({ preventScroll: true });
      window.scrollTo({ top: 0 });
    });
  };
  const useResolvedGuide = (target: string, locus: ResolvedGuideLocus) => {
    if (mode === "pairs") { setGuide(target); setInputMode("single"); return; }
    // Append to either accepted format without turning line input into mixed FASTA.
    const label = `resolved-${locus.chromosome}-${locus.start + 1}-${locus.strand === "+" ? "plus" : "minus"}`;
    setGenome(previous => previous.trim().startsWith(">")
      ? `${previous.trim()}\n>${label}\n${target}`
      : `${previous.trim()}${previous.trim() ? "\n" : ""}${target}`);
    setIntendedLoci(previous => [...previous.filter(x => x.target !== target), {
      target, chromosome: locus.chromosome, start: locus.start, end: locus.end,
      strand: locus.strand, assembly: locus.assembly,
    }].slice(-10));
    setAttempted(false);
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setAttempted(true);
    setError("");
    if (
      validation.errors.length ||
      !models.length ||
      !capabilities ||
      !available ||
      capabilities.worker?.available === false ||
      submitting ||
      running
    )
      return;
    const payload: Submission = {
      mode,
      input: validation.normalized,
      format: validation.format,
      models,
      name: name.trim(),
      ...(mode === "genome" ? { assembly, max_mismatches: maxMismatches, intended_loci: intendedLoci } : {}),
    };
    const body = JSON.stringify(payload);
    if (
      new TextEncoder().encode(body).length > capabilities.limits.request_bytes
    ) {
      setError(
        "The request exceeds the server’s input-size limit. Split the input into smaller jobs.",
      );
      return;
    }
    requestReplacement(async () => {
    setSubmitting(true);
    try {
      const created = await api<Credentials & { status: Job["status"] }>(
        "/jobs",
        { method: "POST", body },
      );
      setLocalAnalysis(null);
      rememberJob({ id: created.id, token: created.token });
      setCredentials({ id: created.id, token: created.token });
      setJob({
        id: created.id,
        status: created.status,
        mode,
        models,
        name: payload.name,
        created_at: new Date().toISOString(),
      });
      setJobError("");
      window.setTimeout(
        () =>
          jobRef.current?.scrollIntoView({
            behavior: window.matchMedia("(prefers-reduced-motion: reduce)")
              .matches
              ? "auto"
              : "smooth",
            block: "start",
          }),
        100,
      );
    } catch (error) {
      setError(message(error));
    } finally {
      setSubmitting(false);
    }
    });
  };
  const cancelJob = async () => {
    if (!credentials) return;
    setBusyJob(true);
    try {
      await api(
        `/jobs/${encodeURIComponent(credentials.id)}/cancel`,
        { method: "POST" },
        credentials.token,
      );
      setPollVersion((value) => value + 1);
    } catch (error) {
      setJobError(message(error));
    } finally {
      setBusyJob(false);
    }
  };
  const deleteJob = async () => {
    if (
      !credentials ||
      !window.confirm(
        "Delete this job, its submitted sequences and its results from the server? Download any results you need first.",
      )
    )
      return;
    setBusyJob(true);
    try {
      await api(
        `/jobs/${encodeURIComponent(credentials.id)}`,
        { method: "DELETE" },
        credentials.token,
      );
      rememberJob(null);
      setCredentials(null);
      setJob(null);
      setJobError("");
    } catch (error) {
      setJobError(message(error));
    } finally {
      setBusyJob(false);
    }
  };
  const toggleModel = (model: ModelId) =>
    setModels((values) =>
      values.includes(model)
        ? values.filter((value) => value !== model)
        : ([...values, model].sort() as ModelId[]),
    );
  const progress =
    typeof job?.progress === "string"
      ? job.progress
      : job?.progress?.message || job?.progress?.stage;

  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="site-header">
        <div className="header-inner">
          <div className="brand" aria-label="CRISPert">
            <Mark />
            <span>
              CRISP<span className="brand-accent">ert</span>
            </span>
          </div>
        </div>
      </header>
      <main id="main" className="main-shell">
        <AnalysisReplacement controller={replacement} />
        {page === "help" && (
          <Documentation capabilities={capabilities} />
        )}
        <div hidden={page !== "predict"}>
            <header className="page-intro predict-intro">
              <div>
                <h1>
                  Assess CRISPR
                  <br className="desktop-break" /> off-target sites.
                </h1>
                <p>
                  Score CRISPR candidate sites with three sequence-only CRISPert
                  models, or search a reference genome for candidates.
                </p>
              </div>
              <div className={`connection-status ${connection}`} role="status">
                <span className="status-dot" />
                <span>
                  {connection === "connected"
                    ? "Prediction server connected"
                    : connection === "connecting"
                      ? "Connecting to prediction server"
                      : "Prediction server unavailable"}
                </span>
                {connection === "unavailable" && (
                  <button className="text-button" onClick={connect}>
                    Retry
                  </button>
                )}
              </div>
            </header>
            {connection === "unavailable" && (
              <div className="notice error connection-notice">
                <p>{connectionError}</p>
                <p>
                  You can prepare your input and read the documentation while
                  the server is unavailable.
                </p>
              </div>
            )}
            <>
              {capabilities?.worker?.available === false && (
                <div className="notice warning">
                  <strong>
                    The prediction worker is currently unavailable.
                  </strong>
                  <p>
                    You can prepare your input while it reconnects.{" "}
                    <button className="text-button" onClick={connect}>
                      Check availability
                    </button>
                  </p>
                </div>
              )}
            </>
            <OpenAnalysis onOpen={openAnalysis} active={page === "predict"} />
            <div className="workbench">
              <section className="input-panel" aria-labelledby="new-prediction">
                <div className="panel-title">
                  <h2 id="new-prediction" tabIndex={-1}>New prediction</h2>
                  <span className="subtle-label">Sequence only</span>
                </div>
                <div
                  className="mode-tabs"
                  role="group"
                  aria-label="Prediction mode"
                >
                  <button
                    type="button"
                    className={mode === "pairs" ? "active" : ""}
                    aria-pressed={mode === "pairs"}
                    onClick={() => {
                      setMode("pairs");
                      setAttempted(false);
                      setError("");
                    }}
                  >
                    <span>Candidate pairs</span>
                    <small>I have candidate sites</small>
                  </button>
                  <button
                    type="button"
                    className={mode === "genome" ? "active" : ""}
                    aria-pressed={mode === "genome"}
                    onClick={() => {
                      setMode("genome");
                      setAttempted(false);
                      setError("");
                    }}
                  >
                    <span>Genome search</span>
                    <small>Find sites for my guides</small>
                  </button>
                </div>
                <form onSubmit={submit} noValidate>
                  {mode === "pairs" ? (
                    <div className="form-section">
                      <div className="input-method-row">
                        <fieldset className="inline-radio">
                          <legend className="sr-only">
                            Candidate input format
                          </legend>
                          <label>
                            <input
                              type="radio"
                              name="input-method"
                              checked={inputMode === "single"}
                              onChange={() => {
                                setInputMode("single");
                                setAttempted(false);
                              }}
                            />{" "}
                            One guide
                          </label>
                          <label>
                            <input
                              type="radio"
                              name="input-method"
                              checked={inputMode === "table"}
                              onChange={() => {
                                setInputMode("table");
                                setAttempted(false);
                              }}
                            />{" "}
                            CSV / TSV table
                          </label>
                        </fieldset>
                        <button
                          type="button"
                          className="text-button"
                          onClick={loadExample}
                        >
                          Load example
                        </button>
                      </div>
                      {inputMode === "single" ? (
                        <>
                          <label className="field-label" htmlFor="guide">
                            Guide sequence <span>with PAM</span>
                          </label>
                          <input
                            id="guide"
                            className="sequence-input"
                            value={guide}
                            placeholder="GATGCTCTCCAGAATCACTGCGG"
                            spellCheck={false}
                            autoComplete="off"
                            onChange={(event) => setGuide(event.target.value)}
                            aria-describedby="guide-hint"
                          />
                          <div id="guide-hint"><InputGuide sequence={guide} mode="pairs" /></div>
                          <label className="field-label" htmlFor="candidates">
                            Candidate off-target sites
                          </label>
                          <textarea
                            id="candidates"
                            className="sequence-input"
                            rows={5}
                            value={candidates}
                            placeholder={
                              "One 23-base sequence per line\nGTTGCTCTTCAGAATCACTGAGG\nGCTGCCCTCCAGGATCACTGGGG"
                            }
                            spellCheck={false}
                            onChange={(event) =>
                              setCandidates(event.target.value)
                            }
                            aria-describedby="candidates-hint"
                          />
                          <p id="candidates-hint" className="field-hint">
                            Aligned with the guide. A, C, G, T and N are
                            accepted; gaps and bulges are not.
                          </p>
                        </>
                      ) : (
                        <>
                          <div className="field-heading">
                            <label className="field-label" htmlFor="pair-table">
                              Sequence pair table
                            </label>
                            <button
                              className="text-button upload-button"
                              type="button"
                              onClick={() => fileRef.current?.click()}
                            >
                              <Arrow down /> Upload file
                            </button>
                          </div>
                          <input
                            ref={fileRef}
                            className="sr-only"
                            type="file"
                            accept=".csv,.tsv,text/csv,text/tab-separated-values"
                            onChange={readFile}
                            tabIndex={-1}
                            aria-label="Upload CSV or TSV"
                          />
                          <textarea
                            id="pair-table"
                            className="sequence-input table-input"
                            rows={8}
                            value={table}
                            placeholder={
                              "ID,target,off_target\nsite-1,GATGCTCTCCAGAATCACTGCGG,GTTGCTCTTCAGAATCACTGAGG"
                            }
                            spellCheck={false}
                            onChange={(event) => {
                              setTable(event.target.value);
                              setFileName("");
                            }}
                            aria-describedby="table-hint"
                          />
                          <p id="table-hint" className="field-hint">
                            Required columns: <code>target</code> and{" "}
                            <code>off_target</code>.{" "}
                            <a href="#help">See accepted aliases</a>.
                            {fileName && (
                              <span className="file-name">
                                Loaded: {fileName}
                              </span>
                            )}
                          </p>
                          <ColumnMapper rawText={table} onApplyTable={csv => { setTable(csv); setFileName(""); setAttempted(false); }} maxRows={capabilities?.limits.pairs ?? 60_000} maxRequestBytes={capabilities?.limits.request_bytes ?? 5 * 1024 * 1024} />
                        </>
                      )}
                      <ToolImport onApply={csv => { setTable(csv); setInputMode("table"); setFileName(""); setAttempted(false); }} onUseMapper={rawText => { setTable(rawText); setInputMode("table"); setFileName(""); setAttempted(false); }} />
                    </div>
                  ) : (
                    <div className="form-section">
                      {capabilities && !available && (
                        <div className="notice warning">
                          <strong>
                            Genome search is not currently available.
                          </strong>
                          <p>
                            The server has no ready reference index. You can
                            still score existing candidate pairs.
                          </p>
                        </div>
                      )}
                      <div className="genome-settings">
                        <label>
                          Reference assembly
                          <select
                            value={assembly}
                            onChange={(event) =>
                              setAssembly(event.target.value)
                            }
                            disabled={!available}
                          >
                            {capabilities?.genomes.length ? (
                              capabilities.genomes.map((item) => (
                                <option key={item.id} value={item.id}>
                                  {item.label}
                                </option>
                              ))
                            ) : (
                              <option value="GRCh38">Human GRCh38</option>
                            )}
                          </select>
                        </label>
                        <label>
                          Maximum mismatches
                          <select
                            value={maxMismatches}
                            onChange={(event) =>
                              setMaxMismatches(Number(event.target.value))
                            }
                          >
                            {[0, 1, 2, 3, 4, 5, 6].map((n) => (
                              <option key={n} value={n}>
                                {n}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                      <div className="field-heading">
                        <label className="field-label" htmlFor="genome-guides">
                          Guide sequences <span>with PAM</span>
                        </label>
                        <button
                          type="button"
                          className="text-button"
                          onClick={loadExample}
                        >
                          Load example
                        </button>
                      </div>
                      <textarea
                        id="genome-guides"
                        className="sequence-input"
                        rows={6}
                        value={genome}
                        placeholder={">guide-name\nGATGCTCTCCAGAATCACTGCGG"}
                        spellCheck={false}
                        onChange={(event) => { setGenome(event.target.value); setIntendedLoci([]); }}
                        aria-describedby="genome-hint"
                      />
                      <p id="genome-hint" className="field-hint">
                        One 23-base guide per line, or FASTA. Up to{" "}
                        {capabilities?.limits.guides ?? 10} guides. Unambiguous
                        DNA with an NGG PAM.
                      </p>
                      <GuideDiscovery available={Boolean(capabilities?.features?.guide_discovery)} genesAvailable={Boolean(capabilities?.features?.gene_lookup)} onResolved={useResolvedGuide} />
                      {intendedLoci.length > 0 && <p className="field-hint">{intendedLoci.length} selected reference {intendedLoci.length === 1 ? "locus" : "loci"} will be marked in results. Editing the guide list clears these selections.</p>}
                      <p className="search-scope">
                        <strong>Search scope:</strong> NGG PAMs, both strands,
                        up to six protospacer mismatches, no bulges. Candidates
                        are scored with the models below.
                      </p>
                    </div>
                  )}
                  <details className="advanced-models">
                    <summary>Model options · {models.map(k => `k=${k}`).join(", ") || "none selected"}</summary>
                  <fieldset className="model-fieldset">
                    <legend>Choose models</legend>
                    <p>
                      Compare each model independently. k=1 is the recommended
                      starting point.
                    </p>
                    <div className="model-options">
                      {([1, 2, 3] as ModelId[]).map((model) => (
                        <label
                          key={model}
                          className={`model-option ${models.includes(model) ? "selected" : ""}`}
                        >
                          <input
                            type="checkbox"
                            checked={models.includes(model)}
                            onChange={() => toggleModel(model)}
                          />
                          <span>
                            <strong>k={model}</strong>
                            <small>
                              {model === 1
                                ? "Single-position tokens"
                                : `${model}-position tokens`}
                            </small>
                          </span>
                          {model === 1 && (
                            <span className="default-label">Default</span>
                          )}
                        </label>
                      ))}
                    </div>
                  </fieldset>
                  </details>
                  <div className="job-name-field">
                    <label className="field-label" htmlFor="job-name">
                      Job name <span>optional</span>
                    </label>
                    <input
                      id="job-name"
                      value={name}
                      maxLength={80}
                      placeholder="A label for this analysis"
                      onChange={(event) => setName(event.target.value)}
                    />
                  </div>
                  {attempted &&
                    (validation.errors.length > 0 || !models.length) && (
                      <div
                        className="notice error validation-errors"
                        role="alert"
                        tabIndex={-1}
                        ref={errorRef}
                      >
                        <strong>Check your input</strong>
                        <ul>
                          {!models.length && (
                            <li>Select at least one model.</li>
                          )}
                          {validation.errors.slice(0, 5).map((error, i) => (
                            <li key={i}>{error}</li>
                          ))}
                          {validation.errors.length > 5 && (
                            <li>
                              And {validation.errors.length - 5} more input
                              errors. Correct the table before submitting.
                            </li>
                          )}
                        </ul>
                      </div>
                    )}
                  {hasInput &&
                    validation.warnings.map((warning) => (
                      <div className="notice warning" key={warning}>
                        {warning}
                      </div>
                    ))}
                  {error && (
                    <div className="notice error" role="alert">
                      {error}
                    </div>
                  )}
                  <p className="field-hint">{mode === "pairs"
                    ? `Pair limit: ${(capabilities?.limits.pairs ?? 60_000).toLocaleString()} per job.`
                    : `Candidate limit: ${(capabilities?.limits.candidates ?? 50_000).toLocaleString()} per job.`}</p>
                  <div className="submit-area">
                    <div className="input-summary" aria-live="polite">
                      {hasInput && !validation.errors.length ? (
                        <>
                          <span className="valid-dot" />{" "}
                          {validation.rows.toLocaleString()}{" "}
                          {mode === "pairs"
                            ? validation.rows === 1
                              ? "pair"
                              : "pairs"
                            : validation.rows === 1
                              ? "guide"
                              : "guides"}{" "}
                          ready
                          {mode === "pairs" && (
                            <>
                              {" "}
                              across {validation.guideCount}{" "}
                              {validation.guideCount === 1 ? "guide" : "guides"}
                            </>
                          )}
                        </>
                      ) : (
                        <>Your input stays in this form until submitted.</>
                      )}
                    </div>
                    <button
                      className="button primary submit-button"
                      type="submit"
                      disabled={
                        submitting ||
                        running ||
                        !available ||
                        capabilities?.worker?.available === false
                      }
                    >
                      {submitting
                        ? "Submitting…"
                        : running
                          ? "A job is running"
                          : mode === "genome"
                            ? "Find and score candidates"
                            : "Score candidates"}
                      <Arrow />
                    </button>
                    <p className="privacy-note">
                      {capabilities
                        ? `Submitted sequences and results are kept for ${capabilities.retention_hours} hours. You can delete them sooner.`
                        : "Connect to the prediction server to submit your sequences."}{" "}
                      No email required.
                    </p>
                  </div>
                </form>
              </section>

            </div>
            {localAnalysis && <AnalysisWorkspace key={`saved-${localAnalysis.key}`} job={localAnalysis.job} document={localAnalysis.analysis.document} restored={localAnalysis.analysis} sourceFilename={localAnalysis.filename} actionsRef={replacement.actions} onPrepare={prepareExample} referenceContextAvailable={Boolean(capabilities?.features?.reference_context)} >
              <button type="button" className="text-button" onClick={() => requestReplacement(() => setLocalAnalysis(null))}>Close saved analysis</button>
            </AnalysisWorkspace>}
            {credentials && (
              <div ref={jobRef} className="job-section" aria-live="polite">
                {jobError && (
                  <div className="notice error">
                    <p>{jobError}</p>
                    <div className="inline-actions">
                      <button
                        className="text-button"
                        onClick={() => setPollVersion((value) => value + 1)}
                      >
                        Retry job status
                      </button>
                      <button
                        className="text-button"
                        onClick={() => {
                          rememberJob(null);
                          setCredentials(null);
                          setJob(null);
                          setJobError("");
                        }}
                      >
                        Forget saved access in this tab
                      </button>
                    </div>
                  </div>
                )}
                {job && !successful(job.status) && (
                  <section className="job-status-panel">
                    <div className="section-heading">
                      <div>
                        <div className="status-label">
                          <span
                            className={`status-dot ${running ? "busy" : ""}`}
                          />
                          {job.status === "queued"
                            ? "Queued for prediction"
                            : job.status === "running"
                              ? "Analysis in progress"
                              : job.status === "failed"
                                ? "Job could not finish"
                                : job.status === "cancelling"
                                  ? "Cancelling job"
                                  : "Job cancelled"}
                        </div>
                        <h2>
                          {job.name ||
                            (job.mode === "genome"
                              ? "Genome candidate search"
                              : "Candidate scoring")}
                        </h2>
                      </div>
                      {running && (
                        <button
                          className="button secondary compact"
                          onClick={cancelJob}
                          disabled={busyJob}
                        >
                          Cancel job
                        </button>
                      )}
                    </div>
                    {running && (
                      <div className="activity-line" aria-hidden="true" />
                    )}
                    <p role="status" aria-live="polite">
                      {typeof job.error === "string"
                        ? job.error
                        : job.error?.message ||
                          job.error?.detail ||
                          progress ||
                          (job.status === "queued"
                            ? "Your sequences are waiting for an available worker. This page updates automatically."
                            : job.status === "running"
                              ? "The server is processing your input. This page updates automatically."
                              : "Your input is still in the form above. Review it before starting a new job.")}
                    </p>
                    {typeof job.progress === "object" && <p className="field-hint">{Number.isFinite(job.progress.queue_seconds) && <>Time in queue: {Math.round(job.progress.queue_seconds!)} s. </>}{Number.isFinite(job.progress.elapsed_seconds) && <>Processing elapsed: {Math.round(job.progress.elapsed_seconds!)} s. </>}Stage timings describe work already performed; they are not an estimate of time remaining.</p>}
                    {job.warnings?.map((warning) => (
                      <p className="notice warning" key={warning}>
                        {warning}
                      </p>
                    ))}
                    <PrivateJobRecovery credentials={credentials} expiresAt={job?.expires_at} />
                    <p className="job-identification">
                      Job {job.id}. Created {date(job.created_at)}
                    </p>
                    {!running && (
                      <button
                        className="text-button danger"
                        onClick={deleteJob}
                        disabled={busyJob}
                      >
                        Delete job and data
                      </button>
                    )}
                  </section>
                )}
                {job && successful(job.status) && !localAnalysis && (
                  <ResultsPanel
                    actionsRef={replacement.actions}
                    key={job.id}
                    credentials={credentials}
                    job={job}
                    onDelete={deleteJob}
                    onPrepare={prepareExample}
                    referenceContextAvailable={Boolean(capabilities?.features?.reference_context)}
                  />
                )}
              </div>
            )}
        </div>
      </main>
      <footer className="site-footer">
        <div>
          <span className="footer-brand">CRISPert</span>
          <span>Sequence-only predictions with CRISPert</span>
        </div>
        <div>
          <a href="#help">Help &amp; About</a>
          <a href={`${import.meta.env.BASE_URL}license.txt`}>MIT licence</a>
          <span title={apiOrigin || "Same-origin development API"}>
            de.NBI compute
          </span>
        </div>
      </footer>
    </>
  );
}
