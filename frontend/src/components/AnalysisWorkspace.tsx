import { useEffect, useMemo, useRef, useState } from "react";
import type { AnalysisDocument, Credentials, Job, ModelId, ResultRow, Submission } from "../api";
import { fetchAnalysis } from "../api";
import { candidateKey } from "../features/resultIdentity";
import { createOverviewFilters, filterOverviewRows, protospacerMismatches } from "../features/overview";
import { AnnotationDetails } from "./AnnotationDetails";
import { GuideOverview } from "./GuideOverview";
import { GenomicLinks } from "./GenomicLinks";
import { AnalysisExports } from "./AnalysisExports";
import type { RefObject } from "react";
import type { AnalysisActions } from "./AnalysisReplacement";
import type { AnalysisExportActions } from "./AnalysisExports";
import type { ImportedAnalysis } from "../features/analysisImports";
import type { WorkspaceViewState } from "../features/analysisExports";
import "./AnalysisWorkspace.css";

function Alignment({ row }: { row: ResultRow }) {
  const positions = [...row.off_target].flatMap((base, i) => i !== 20 && base !== row.target[i] ? [i + 1] : []);
  return <div className="analysis-alignment">
    <div><span>Guide</span><code role="img" aria-label={`Guide ${row.target}. PAM ${row.target.slice(20)}.`}>{[...row.target].map((base, i) => <span key={i} aria-hidden="true" className={i >= 20 ? "analysis-pam" : ""}>{base}</span>)}</code></div>
    <div><span>Site</span><code role="img" aria-label={`Candidate ${row.off_target}. PAM ${row.off_target.slice(20)}. Differing positions: ${positions.join(", ") || "none"}.`}>{[...row.off_target].map((base, i) => <span key={i} aria-hidden="true" className={`${i >= 20 ? "analysis-pam " : ""}${i !== 20 && base !== row.target[i] ? "analysis-mismatch" : ""}`}>{base}</span>)}</code></div>
    <small>{positions.length ? `Differing positions: ${positions.join(", ")}` : "No differences outside the first PAM base; intended locus not inferred"}{/[Nn]/.test(row.target + row.off_target) ? "; contains an unknown base" : ""}</small>
  </div>;
}

export interface AnalysisWorkspaceProps {
  restored?: ImportedAnalysis;
  sourceFilename?: string;
  actionsRef?: RefObject<AnalysisActions | null>;
  job: Job;
  credentials?: Credentials;
  document?: AnalysisDocument;
  demonstration?: boolean;
  onDelete?: () => void;
  onPrepare?: (submission: Submission) => void;
  referenceContextAvailable?: boolean;
  children?: React.ReactNode;
}

/** One complete result document feeds every analytical view, never one page. */
export function AnalysisWorkspace({ restored, sourceFilename, actionsRef, job, credentials, document: supplied, demonstration = false, onDelete, children }: AnalysisWorkspaceProps) {
  const [document, setDocument] = useState<AnalysisDocument | null>(supplied ?? null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(!supplied);
  const [filters, setFilters] = useState(() => ({ ...createOverviewFilters(), guideKey: restored?.state.filters.guideKey ?? "", query: restored?.state.filters.query ?? "" }));
  const [sort, setSort] = useState<WorkspaceViewState["sort"]>(restored?.state.sort && restored.state.sort !== "cfd" ? restored.state.sort : `k${job.models[0] ?? 1}`);
  const [ascending, setAscending] = useState(restored?.state.ascending ?? false);
  const [page, setPage] = useState(0);
  const exportActions = useRef<AnalysisExportActions | null>(null);
  // Searching and sorting do not change the results saved in the CSV.
  useEffect(() => {
    if (actionsRef) actionsRef.current = { hasChanges: false, save: () => exportActions.current?.save() ?? Promise.resolve(false) };
    return () => { if (actionsRef) actionsRef.current = null; };
  }, [actionsRef]);
  const [retry, setRetry] = useState(0);
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (restored) { headingRef.current?.focus({ preventScroll: true }); headingRef.current?.scrollIntoView({ block: "start" }); }
  }, [restored]);
  const pageSize = 25;

  useEffect(() => {
    if (supplied) { setDocument(supplied); setLoading(false); return; }
    if (!credentials) return;
    let active = true;
    setLoading(true); setError("");
    fetchAnalysis(credentials).then(value => {
      if (!Array.isArray(value.rows) || value.rows.length > 60_000) throw new Error("The result document exceeds the supported size or is invalid.");
      if (active) setDocument(value);
    }).catch(reason => { if (active) setError(reason instanceof Error ? reason.message : "Results could not be loaded."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [credentials?.id, credentials?.token, supplied, retry]);

  const rows = document?.rows ?? [];
  const filtered = useMemo(() => filterOverviewRows(rows, filters), [rows, filters]);
  const sorted = useMemo(() => {
    const list = [...filtered];
    if (sort === "input") return ascending ? list : list.reverse();
    const value = (row: ResultRow) => sort === "mismatches" ? protospacerMismatches(row) : row.scores[sort as `k${ModelId}`];
    return list.sort((a, b) => {
      const x = value(a), y = value(b);
      if (x == null) return y == null ? 0 : 1;
      if (y == null) return -1;
      return ascending ? x - y : y - x;
    });
  }, [filtered, sort, ascending]);
  useEffect(() => { setPage(0); }, [filters, sort, ascending]);
  const displayed = sorted.slice(page * pageSize, (page + 1) * pageSize);

  return <section className="analysis-workspace" aria-labelledby={`analysis-title-${job.id}`} aria-busy={loading}>
    <header className="analysis-heading">
      <div><h2 ref={headingRef} tabIndex={-1} id={`analysis-title-${job.id}`}>{restored ? "Saved analysis" : demonstration ? "Explore example results" : "Your analysis"}</h2><p>{job.name || "CRISPert candidate assessment"}</p></div>
    </header>
    {restored && <div className="notice"><p>Local copy: {sourceFilename || "saved analysis"}. Saved {new Date(restored.savedAt).toLocaleString()}.</p>{restored.source.warnings.length > 0 && <ul>{restored.source.warnings.map((warning, i) => <li key={i}>{warning}</li>)}</ul>}</div>}
    {demonstration && <p className="notice">Demonstration snapshot. These results are stored with the website; exploring them creates no prediction job.</p>}
    {loading && <p role="status">Loading the complete analysis for consistent summaries and exports…</p>}
    {error && <div className="notice error" role="alert"><p>{error}</p>{credentials && <button className="button secondary" onClick={() => setRetry(x => x + 1)}>Retry results</button>}</div>}
    {document && <>
      {rows.some(row => row.sensitivity_schema) && <p className="notice">This input carries sequence-sensitivity labels. Its substituted sequences are synthetic model probes, not enumerated genomic sites. Interpret these scores as synthetic sequence comparisons.</p>}
      <p className="analysis-scope">{String(document.metadata.candidate_scope ?? (job.mode === "genome" ? "Candidates within the recorded reference, PAM and mismatch limits." : "Supplied candidate list; genomic completeness is unknown."))}</p>
      <p className="score-note"><strong>Scores support comparison within the stated candidate set.</strong> They are not calibrated cleavage probabilities or a guide safety assessment. <a href="#help">Interpretation guide</a></p>
      <GuideOverview rows={rows} mode={job.mode} metadata={document.metadata} filters={filters} onChange={setFilters} />
      <div className="analysis-controls">
        <label>Sort by<select value={sort} onChange={e => setSort(e.target.value as WorkspaceViewState["sort"])}><option value="input">Input order</option>{job.models.map(k => <option value={`k${k}`} key={k}>k={k} score</option>)}<option value="mismatches">Protospacer mismatches</option></select></label>
        <label>Order<select value={ascending ? "asc" : "desc"} onChange={e => setAscending(e.target.value === "asc")}><option value="desc">Descending</option><option value="asc">Ascending</option></select></label>
      </div>
      <p className="analysis-count" role="status">{filtered.length.toLocaleString()} of {rows.length.toLocaleString()} candidates shown.</p>
      <div className="analysis-table-scroll" tabIndex={0} role="region" aria-label="Candidate results, scroll horizontally for all columns">
        <table className="analysis-table"><caption className="sr-only">Complete candidate analysis with separate model scores, sequence alignments and genomic context.</caption>
          <thead><tr><th scope="col">Candidate and alignment</th><th scope="col">Mismatches</th>{job.models.map(k => <th scope="col" key={k}>k={k}</th>)}<th scope="col">Genomic context</th></tr></thead>
          <tbody>{displayed.map(row => <tr key={candidateKey(row)}>
            <td><strong className="analysis-row-id">{row.id}</strong>{row.guide_id && <small>{row.guide_id}</small>}<Alignment row={row} />{row.user_selected_locus && <small className="analysis-locus-note">Your selected reference locus</small>}{!!row.warnings?.length && <details><summary>Input notes</summary><ul>{row.warnings.map((warning, i) => <li key={i}>{warning}</li>)}</ul></details>}</td>
            <td>{protospacerMismatches(row) ?? "Unknown"}</td>
            {job.models.map(k => <td key={k}><span className="analysis-score" title={String(row.scores[`k${k}`] ?? "Unavailable")}>{row.scores[`k${k}`]?.toPrecision(5) ?? "—"}</span></td>)}
            <td>{row.chromosome || row.start !== undefined ? <GenomicLinks row={row} /> : <small>Coordinates were not supplied for this pair.</small>}{row.coordinate_verification && <small>Coordinates: {row.coordinate_verification}.</small>}<AnnotationDetails annotations={row.annotations} /></td>
          </tr>)}{!displayed.length && <tr><td colSpan={3 + job.models.length}>{rows.length ? "No candidates match these filters. Change or reset the filters." : "No sites were returned within this analysis scope. This does not establish absence of off-target activity."}</td></tr>}</tbody>
        </table>
      </div>
      <div className="pagination"><p>{sorted.length ? `${page * pageSize + 1}–${Math.min((page + 1) * pageSize, sorted.length)} of ${sorted.length.toLocaleString()}` : "0 candidates"}</p><div><button className="button secondary compact" disabled={!page} onClick={() => setPage(p => Math.max(0, p - 1))}>Previous</button><button className="button secondary compact" disabled={(page + 1) * pageSize >= sorted.length} onClick={() => setPage(p => p + 1)}>Next</button></div></div>
      <AnalysisExports actionsRef={exportActions} document={document} />
    </>}
    {children}
    {!demonstration && !restored && <footer className="job-footer"><p>{job.expires_at ? `Results expire ${new Date(job.expires_at).toLocaleString()}. Download your analysis before then.` : "Download your analysis before its private job expires."}</p>{onDelete && <button className="text-button danger" onClick={onDelete}>Delete job and data</button>}</footer>}
  </section>;
}
