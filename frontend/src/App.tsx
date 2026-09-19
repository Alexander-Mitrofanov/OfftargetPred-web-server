import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { api, apiOrigin, rememberJob, restoreJob } from "./api";
import type {
  Capabilities,
  Credentials,
  Job,
  ModelId,
  Mode,
  Submission,
} from "./api";
import { AnalysisWorkspace } from "./components/AnalysisWorkspace";
import { GuideResolver } from "./components/GuideResolver";
import { GuideDiscovery } from "./components/GuideDiscovery";
import { parseRecoveryFragment } from "./features/jobRecovery";
import type { ResolvedGuideLocus } from "./components/GuideResolver";
import { ServiceInformation } from "./components/ServiceInformation";
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

const ExamplesPage = lazy(() => import("./components/ExamplesPage").then(module => ({ default: module.ExamplesPage })));
const EvidencePage = lazy(() => import("./components/EvidencePage").then(module => ({ default: module.EvidencePage })));
type Page = "predict" | "help" | "about" | "examples" | "evidence";
const pageFromHash = (): Page => {
  const value = window.location.hash.slice(1);
  return ["help", "about", "examples", "evidence"].includes(value) ? value as Page : "predict";
};

const repository =
  "https://github.com/Alexander-Mitrofanov/OfftargetPred-web-server";
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
function Sequence({
  sequence,
  guide,
  label,
}: {
  sequence: string;
  guide?: string;
  label?: string;
}) {
  return (
    <code
      role="img"
      className="sequence"
      aria-label={`${label ? label + ": " : ""}${sequence}`}
    >
      {sequence.split("").map((base, i) => (
        <span
          key={i}
          aria-hidden="true"
          className={`${i === 20 ? "pam-start " : ""}${i >= 20 ? "pam " : ""}${base === "N" ? "unknown " : guide && guide[i] !== base && guide[i] !== "N" ? "mismatch" : ""}`}
        >
          {base}
        </span>
      ))}
    </code>
  );
}
function AlignmentExample() {
  return (
    <div className="alignment-example">
      <div className="alignment-legend">
        <span>20-base protospacer</span>
        <span>PAM</span>
      </div>
      <div className="alignment-row">
        <span className="sequence-label">Guide</span>
        <Sequence sequence={exampleGuide} />
      </div>
      <div className="alignment-row">
        <span className="sequence-label">Site</span>
        <Sequence sequence="GTTGCTCTTCAGAATCACTGAGG" guide={exampleGuide} />
      </div>
      <p>
        <span className="mismatch-swatch" /> Highlighted bases differ from the
        guide.
      </p>
    </div>
  );
}

function Documentation({
  page,
  capabilities,
}: {
  page: "help" | "about";
  capabilities: Capabilities | null;
}) {
  return (
    <div className="documentation">
      <header className="page-intro">
        <h1>
          {page === "help"
            ? "From sequences to scores"
            : "The models behind the scores"}
        </h1>
        <p>
          {page === "help"
            ? "Input formats, search boundaries and practical guidance for reading your results."
            : "OfftargetPred runs three sequence-only CRISPert models for candidate off-target assessment."}
        </p>
      </header>
      {page === "help" ? (
        <>
          <section>
            <h2>Choose your starting point</h2>
            <p>
              <strong>Candidate pairs:</strong> bring sites from your own search
              or experiment. Score one guide against a list of sites, or upload
              pairs for multiple guides. No genome search is performed in this
              mode.
            </p>
            <p>
              <strong>Genome search:</strong> find NGG-PAM candidates for up to{" "}
              {capabilities?.limits.guides ?? 10} guides in the installed human
              GRCh38 reference, then score those candidates. Search supports up
              to four substitutions in the 20-base protospacer, both strands,
              and no bulges. Availability is shown in the form.
            </p>
            <p>
              Genome search covers the installed reference assembly; individual
              variants and uninstalled alternate sequences are outside its
              scope. A search exceeding the candidate limit fails with an
              explanation instead of returning an undisclosed truncated list.
            </p>
          </section>
          <section>
            <h2>Two aligned sequences, 23 bases each</h2>
            <p>
              This service uses the supplied CRISPert-small checkpoints for
              aligned SpCas9-style sequence pairs.{" "}
              Provide guide and candidate DNA in the same 5′ to 3′ orientation.
              Each sequence must contain a 20-base protospacer followed by its
              3-base PAM. Use the actual guide-side PAM, not a 20-base RNA guide
              alone. The server does not reverse-complement or realign your
              input.
            </p>
            <AlignmentExample />
            <p>
              Candidate-pair scoring accepts A, C, G, T and N, regardless of
              case. N produces unknown tokens and is flagged. Gaps, bulges, U
              and other ambiguity codes are unsupported. Genome-search guides
              require unambiguous A/C/G/T bases and an NGG PAM. Candidate-pair
              scoring accepts other candidate PAMs; acceptance does not
              establish their experimental validity.
            </p>
          </section>
          <section>
            <h2>CSV or TSV input</h2>
            <p>
              The simplest table has <code>target</code> and{" "}
              <code>off_target</code> columns. An optional <code>ID</code>{" "}
              identifies each pair. Do not include experimental labels unless
              you need them as metadata; labels are not required to predict.
            </p>
            <pre>
              <code>{exampleTable}</code>
            </pre>
            <a
              href={`${import.meta.env.BASE_URL}examples/candidate-pairs.csv`}
              download
            >
              Download the example CSV
            </a>
            <div className="table-scroll">
              <table className="help-table">
                <thead>
                  <tr>
                    <th>Meaning</th>
                    <th>Accepted column names</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Guide + PAM</td>
                    <td>
                      <code>target</code>, <code>sgRNA</code>,{" "}
                      <code>Guide_sequence</code>, <code>AlignedTarget</code>
                    </td>
                  </tr>
                  <tr>
                    <td>Candidate + PAM</td>
                    <td>
                      <code>off_target</code>, <code>offtarget</code>,{" "}
                      <code>Target_sequence</code>, <code>AlignedText</code>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p>
              Names are case-sensitive. Choose one alias for each sequence
              column. In the CRISPROfft convention, <code>Target_sequence</code>{" "}
              is the genomic candidate, while <code>Guide_sequence</code> is the
              guide. Invalid rows are reported; they are not silently removed.
            </p>
            <p>If your headings differ, use <strong>Map columns</strong> to preview and confirm their meaning. The tool-import panel accepts supported Cas-OFFinder and CRISPOR exports, plus explicitly enriched CHOPCHOP tables. It reports missing PAMs, strand information and coordinate declarations before submission. <a href={`${repository}/blob/main/docs/import-formats.md`}>Supported formats and examples</a>.</p>
          </section>
          <section>
            <h2>Genome-search input</h2>
            <p>
              Paste one 23-base guide per line, or FASTA with a unique
              identifier for each guide. To begin with a region, open
              <strong> Start from a gene or genomic region</strong>, look up an
              exact gene name or Ensembl ID, narrow the interval and explicitly
              choose a reference-derived guide. This helper lists eligible NGG
              sites; it does not predict on-target efficiency.
            </p>
            <pre>
              <code>{exampleFasta}</code>
            </pre>
            <p>
              Search results include reference positions and strands. Exact
              protospacer matches are kept and labeled: an exact match alone
              does not establish that a genomic locus is your intended target.
              Mismatch counts exclude the PAM. Reference provenance and
              coordinate convention are included with the server’s result
              metadata.
            </p>
          </section>
          <section>
            <h2>Read a CRISPert score</h2>
            <p>
              Each score is the model’s positive-class softmax output, between 0
              and 1. Larger values indicate stronger model support for an
              off-target signal. These values are{" "}
              <strong>
                not calibrated cleavage probabilities or predicted editing
                percentages
              </strong>
              . There is no validated universal safe/unsafe threshold.
            </p>
            <p>
              Compare candidate rankings within each k=1, k=2 and k=3 model.
              Equal numeric scores from different models need not have the same
              meaning. No ensemble average is computed. Model disagreement is
              useful context, and no model
              wins on every supplied evaluation dataset. Scores do not measure guide-level
              genome-wide specificity, particularly when scoring an incomplete
              list of candidates.
            </p>
          </section>
          <section>
            <h2>Explore and keep your results</h2>
            <p>The guide summary and filters operate on every returned candidate. Select rows manually or use a stated shortlist rule. Compare model ranks on the same candidates, inspect the local genomic annotations, and open external genome-browser links only when you choose to.</p>
            <p>The optional CFD column is a separate published baseline. Missing CFD values mean unsupported inputs; they are not zero scores. Gene overlap describes location and does not measure biological harm.</p>
            <p>You can import your own experimental observation table into the browser and inspect exact, ambiguous and unmatched observations. Missing or zero observations are not confirmed negatives. This evidence stays separate from predictions.</p>
            <p>Download the full analysis ZIP to preserve full results, filtered results, selected candidates, selection notes, imported evidence, settings and citations. Server CSV/JSON downloads contain prediction results; browser-only selections and evidence are kept in the ZIP. Refreshing clears browser-only analysis edits.</p>
            <p><a href="#examples">Try complete interactive examples</a> or <a href="#evidence">inspect the checkpoint diagnostics</a>.</p>
          </section>
          <section>
            <h2>Jobs and data</h2>
            <p>
              {capabilities
                ? `The current server accepts up to ${capabilities.limits.pairs.toLocaleString()} pairs per scoring job, ${capabilities.limits.guides} guides per search, and ${capabilities.limits.candidates.toLocaleString()} search candidates. Inputs and results expire after ${capabilities.retention_hours} hours.`
                : "The form reads current input limits and result-retention settings from the prediction server when connected."}{" "}
              Download the full CSV for analysis, or the JSON export for results
              and provenance.
            </p>
            <p>
              One job can wait or run per client IP address. People sharing an
              institutional network may share this limit; retry after the
              current job finishes.
            </p>
            <p>
              Your browser tab keeps a private job-access token in session
              storage. It is not sent in URLs to the server. Use Copy private
              result link to reopen completed results in another browser. That
              link grants access to anyone who has it; its access token is read
              from the link fragment and removed from the address bar. The job
              ID alone cannot recover private results. Download results before
              they expire. You can delete a job and its submitted data from the
              results panel. No email is required.
            </p>
          </section>
        </>
      ) : (
        <>
          <section>
            <h2>Sequence-only CRISPert</h2>
            <p>
              The guide and candidate are aligned position by position. Each
              pair of bases is encoded in a 16-symbol pair alphabet, preserving
              both the matched bases and the direction of each mismatch.
              Overlapping k-mers group one, two or three aligned positions per
              token.
            </p>
            <p>
              All three supplied checkpoints use four BERT layers, a hidden size
              of 128, four attention heads and a feed-forward size of 256.
              Scoring uses sequence alone; chromatin, epigenetic and CasKAS
              features are not used.
            </p>
            <div className="table-scroll">
              <table className="help-table">
                <thead>
                  <tr>
                    <th>Model</th>
                    <th>Positions / token</th>
                    <th>Parameters</th>
                    <th>Pretraining</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>
                      k=1 <span className="small-tag">Default</span>
                    </td>
                    <td>1</td>
                    <td>552,962</td>
                    <td>From scratch</td>
                  </tr>
                  <tr>
                    <td>k=2</td>
                    <td>2</td>
                    <td>583,554</td>
                    <td>Synthetic pair masking</td>
                  </tr>
                  <tr>
                    <td>k=3</td>
                    <td>3</td>
                    <td>1,074,946</td>
                    <td>Synthetic pair masking</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
          <section>
            <h2>What these checkpoints were trained on</h2>
            <p>
              The supplied documentation describes training on a 17-guide
              T-cell GUIDE-seq corpus. Exact training and validation row
              membership is not available. The bundle reports run seed 0, while
              checkpoint configuration stores 42; training code passes a run
              seed separately, so the actual run seed remains unverified.
            </p>
            <p>
              k=1 remains the starting model described in the supplied package.
              The full K562 evaluation shares one guide and 981 sequence pairs
              with the reported training corpus. Reproducing its scores does
              not establish fully guide-independent performance. The supplied
              iPSC file contains three guides, two with observed positive sites.
              These small evaluations should not establish a universal best model.
            </p>
          </section>
          <section>
            <h2>Method and manuscript provenance</h2>
            <p>
              The manuscript included with the supplied model package describes
              the broader CRISPert work, including a larger architecture and
              CasKAS experiments. This server uses the packaged four-layer,
              sequence-only checkpoints described in the package README.
              Manuscript performance numbers must not be attributed to these
              checkpoints without a matching evaluation.
            </p>
            <p>
              Each completed run records model and reference metadata with its
              results. Keep the JSON export alongside your CSV when preparing a
              reproducible analysis.
            </p>
          </section>
          <section>
            <h2>Scope and interpretation</h2>
            <p>
              OfftargetPred ranks candidate sites. It does not estimate
              therapeutic safety, on-target editing efficiency, chromatin
              accessibility, or cell-specific cleavage. Reference search and
              candidate scoring are separate steps, and a candidate list depends
              on the chosen reference, PAM and mismatch limit.
            </p>
            <p>
              Cas12, high-fidelity Cas9 variants, base editors and prime editors
              are outside the established scope of these checkpoints. A 23-base
              input alone does not establish support.
            </p>
            <p>
              The interface is inspired by the focused research workflow of{" "}
              <a
                href="https://rth.dk/resources/crispr/crisproff/"
                target="_blank"
                rel="noreferrer"
              >
                CRISPRoff
              </a>
              . CRISPRoff uses its own energy-based scoring and specificity
              model; OfftargetPred does not reproduce those scores.
            </p>
          </section>
          <ServiceInformation />
          <section>
            <h2>Software and documentation</h2>
            <p>
              <a href={repository} target="_blank" rel="noreferrer">
                Source code, deployment instructions and model documentation
              </a>
            </p>
            <p>
              The frontend is hosted on GitHub Pages; prediction jobs run on the
              project’s de.NBI backend. No model execution or genome search
              takes place on GitHub Pages.
            </p>
          </section>
        </>
      )}
    </div>
  );
}

function ResultsPanel({ credentials, job, onDelete, onPrepare, referenceContextAvailable }: {
  credentials: Credentials;
  job: Job;
  onDelete: () => void;
  onPrepare: (submission: Submission) => void;
  referenceContextAvailable: boolean;
}) {
  return <AnalysisWorkspace job={job} credentials={credentials} onDelete={onDelete} onPrepare={onPrepare} referenceContextAvailable={referenceContextAvailable}>
    <PrivateJobRecovery credentials={credentials} expiresAt={job?.expires_at} />
  </AnalysisWorkspace>;
}

export default function App() {
  const [page, setPage] = useState<Page>(pageFromHash);
  const [examplesOpened, setExamplesOpened] = useState(page === "examples");
  useEffect(() => { if (page === "examples") setExamplesOpened(true); }, [page]);
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
      if (parseRecoveryFragment(window.location.hash)) {
        const recovered = restoreJob();
        if (recovered) { setCredentials(recovered); setJob(null); setJobError(""); }
      }
      setPage(pageFromHash());
      window.scrollTo({ top: 0 });
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
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
    setSubmitting(true);
    try {
      const created = await api<Credentials & { status: Job["status"] }>(
        "/jobs",
        { method: "POST", body },
      );
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
          <a className="brand" href="#predict" aria-label="OfftargetPred home">
            <Mark />
            <span>
              Offtarget<span className="brand-accent">Pred</span>
            </span>
          </a>
          <nav aria-label="Main navigation">
            <a
              href="#predict"
              aria-current={page === "predict" ? "page" : undefined}
            >
              Predict
            </a>
            <a href="#examples" aria-current={page === "examples" ? "page" : undefined}>Examples</a>
            <a href="#evidence" aria-current={page === "evidence" ? "page" : undefined}>Evidence</a>
            <a href="#help" aria-current={page === "help" ? "page" : undefined}>
              Help
            </a>
            <a
              href="#about"
              aria-current={page === "about" ? "page" : undefined}
            >
              About
            </a>
            <a
              className="source-link"
              href={repository}
              target="_blank"
              rel="noreferrer"
            >
              Source code <span aria-hidden="true">↗</span>
            </a>
          </nav>
        </div>
      </header>
      <main id="main" className="main-shell">
        <div hidden={page !== "examples"}>
          {examplesOpened && <Suspense fallback={<p role="status">Loading examples…</p>}><ExamplesPage onUseInput={prepareExample} referenceContextAvailable={Boolean(capabilities?.features?.reference_context)} /></Suspense>}
        </div>
        {page === "evidence" && (
          <Suspense fallback={<p role="status">Loading evidence…</p>}><EvidencePage /></Suspense>
        )}
        {(page === "help" || page === "about") && (
          <Documentation page={page} capabilities={capabilities} />
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
                <a className="text-button" href="#examples">Explore interactive example results →</a>
                <p className="field-hint"><a href={`${repository}/blob/main/docs/API.md`}>API reference</a> · <a href={`${repository}/blob/main/client/README.md`}>Python client and runnable example</a></p>
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
                          <GuideResolver available={Boolean(capabilities?.features?.guide_resolver)} onResolved={useResolvedGuide} />
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
                          <ColumnMapper rawText={table} onApplyTable={csv => { setTable(csv); setFileName(""); setAttempted(false); }} maxRows={capabilities?.limits.pairs ?? 10_000} maxRequestBytes={capabilities?.limits.request_bytes ?? 5 * 1024 * 1024} />
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
                            {[0, 1, 2, 3, 4].map((n) => (
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
                      <GuideResolver available={Boolean(capabilities?.features?.guide_resolver)} onResolved={useResolvedGuide} />
                      <GuideDiscovery available={Boolean(capabilities?.features?.guide_discovery)} genesAvailable={Boolean(capabilities?.features?.gene_lookup)} onResolved={useResolvedGuide} />
                      {intendedLoci.length > 0 && <p className="field-hint">{intendedLoci.length} selected reference {intendedLoci.length === 1 ? "locus" : "loci"} will be marked in results. Editing the guide list clears these selections.</p>}
                      <p className="search-scope">
                        <strong>Search scope:</strong> NGG PAMs, both strands,
                        up to four protospacer mismatches, no bulges. Candidates
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
              <aside className="guide-panel" aria-label="Input guidance">
                <h2>Read the mismatch pattern.</h2>
                <p>
                  The models read a guide and candidate site together, learning
                  from the pattern of matches and mismatches.
                </p>
                <AlignmentExample />
                <div className="guide-note">
                  <h3>
                    {mode === "genome"
                      ? "Search the reference. Compare sites."
                      : "Bring sites. Compare models."}
                  </h3>
                  <p>
                    {mode === "genome"
                      ? "Genome mode finds NGG-PAM sites in the human GRCh38 reference, then scores each candidate with your selected models."
                      : "Candidate mode scores the sites you provide. It does not search a genome or measure the overall specificity of a guide."}
                  </p>
                </div>
                <div className="guide-note">
                  <h3>Three views of the same sequence</h3>
                  <p>
                    k=1, k=2 and k=3 read increasingly wider groups of aligned
                    positions. Their scores stay separate so you can compare
                    them directly.
                  </p>
                  <a href="#about">
                    Read about the models <span aria-hidden="true">↗</span>
                  </a>
                </div>
                <div className="quick-facts">
                  <div>
                    <span>Input length</span>
                    <strong>23 bases, including PAM</strong>
                  </div>
                  <div>
                    <span>Scoring features</span>
                    <strong>DNA sequence only</strong>
                  </div>
                  <div>
                    <span>Score range</span>
                    <strong>0–1, uncalibrated</strong>
                  </div>
                  {capabilities && (
                    <div>
                      <span>{mode === "genome" ? "Guide limit" : "Pair limit"}</span>
                      <strong>
                        {(mode === "genome"
                          ? capabilities.limits.guides
                          : capabilities.limits.pairs
                        ).toLocaleString()} per job
                      </strong>
                    </div>
                  )}
                  {capabilities && mode === "genome" && (
                    <div>
                      <span>Candidate limit</span>
                      <strong>{capabilities.limits.candidates.toLocaleString()} per job</strong>
                    </div>
                  )}
                </div>
                <a className="help-link" href="#help">
                  Input format and interpretation guide
                </a>
              </aside>
            </div>
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
                {job && successful(job.status) && (
                  <ResultsPanel
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
          <span className="footer-brand">OfftargetPred</span>
          <span>Sequence-only predictions with CRISPert</span>
        </div>
        <div>
          <a href="#help">Documentation</a>
          <a href={`${import.meta.env.BASE_URL}license.txt`}>MIT licence</a>
          <a href={repository} target="_blank" rel="noreferrer">
            GitHub
          </a>
          <span title={apiOrigin || "Same-origin development API"}>
            de.NBI compute
          </span>
        </div>
      </footer>
    </>
  );
}
