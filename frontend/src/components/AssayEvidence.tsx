import { useId, useRef, useState } from "react";
import type { ResultRow } from "../api";
import { EVIDENCE_MAX_BYTES, hashEvidenceBytes, hashEvidenceText, previewAssayEvidence, SYNTHETIC_ASSAY_EVIDENCE } from "../features/assayEvidence.ts";
import type { EvidenceMatchMode, EvidenceObservation, EvidenceOptions, EvidencePreview, EvidenceState } from "../features/assayEvidence.ts";
import "./AssayEvidence.css";

export interface AssayEvidenceProps {
  rows: ResultRow[];
  onEvidenceChange: (state: EvidenceState | null) => void;
}
const PAGE_SIZE = 25;
const matchLabels: Record<EvidenceObservation["status"], string> = {
  matched: "One matching prediction row", ambiguous: "Multiple possible matches", unmatched: "No matching prediction row",
};

function MatchList({ observation, rows }: { observation: EvidenceObservation; rows: ResultRow[] }) {
  const [page, setPage] = useState(0);
  const count = observation.match_result_indices.length;
  return <section aria-label={`Matches for ${observation.import_row_id}`} className="assay-match-list">
    <h4>Possible matches for {observation.source_id ?? observation.import_row_id}</h4>
    <p>{count.toLocaleString()} prediction rows. {count > 1 ? "Every possible match is retained; this observation is not assigned to one locus or guide." : count === 0 ? "No row in this result document matches the declared identity. This observation is retained in the export." : "The imported observation matches this prediction row; its biological interpretation depends on the assay context."}</p>
    <ol start={page * PAGE_SIZE + 1}>{observation.match_result_indices.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map((index) => {
      const row = rows[index];
      return <li key={index}><strong>Result row {index + 1}: {row.id}</strong>{row.guide_id && <> · guide {row.guide_id}</>}<br /><code>{row.target} → {row.off_target}</code>{row.chromosome && <> · {row.chromosome}:{row.start}–{row.end} ({row.strand}; {row.coordinate_system ?? "coordinate convention unknown"})</>}</li>;
    })}</ol>
    {count > PAGE_SIZE && <div className="assay-actions"><button type="button" className="secondary" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous matches</button><span>Match page {page + 1} of {Math.ceil(count / PAGE_SIZE)}</span><button type="button" className="secondary" disabled={(page + 1) * PAGE_SIZE >= count} onClick={() => setPage(page + 1)}>Next matches</button></div>}
  </section>;
}

/** Mount with the result-document key: imported observations belong to that complete result only. */
export function AssayEvidence({ rows, onEvidenceChange }: AssayEvidenceProps) {
  const id = useId(), generation = useRef(0), fileInput = useRef<HTMLInputElement>(null), sourceBytes = useRef<ArrayBuffer | null>(null);
  const [options, setOptions] = useState<EvidenceOptions>({ assay: "", sampleContext: "", matchMode: "pair-sequence", valueKind: "read_count", assembly: "", coordinateSystem: "" });
  const [text, setText] = useState(""), [filename, setFilename] = useState("");
  const [preview, setPreview] = useState<EvidencePreview | null>(null), [applied, setApplied] = useState<EvidenceState | null>(null);
  const [error, setError] = useState(""), [busy, setBusy] = useState(false), [page, setPage] = useState(0), [issuePage, setIssuePage] = useState(0);
  const [inspected, setInspected] = useState<string | null>(null), [filter, setFilter] = useState("all");
  const invalidate = () => { generation.current++; setPreview(null); setError(""); setPage(0); setIssuePage(0); setInspected(null); };
  const changeOptions = (patch: Partial<EvidenceOptions>) => { setOptions((current) => ({ ...current, ...patch })); invalidate(); };
  const clearApplied = () => { setApplied(null); onEvidenceChange(null); };
  const state = preview?.state;
  const observations = state?.observations.filter((observation) => filter === "all" || observation.status === filter) ?? [];
  const inspectedObservation = state?.observations.find((observation) => observation.import_row_id === inspected);
  const apply = async () => {
    if (!preview?.canApply || !state) return;
    const ticket = generation.current;
    setBusy(true);
    const hashBasis = sourceBytes.current ? "original_file_bytes" : "UTF-8 text";
    const hash = sourceBytes.current ? await hashEvidenceBytes(sourceBytes.current) : await hashEvidenceText(text);
    if (ticket === generation.current) {
      const evidence: EvidenceState = { ...state, metadata: { ...state.metadata, ...(filename ? { source_filename: filename } : {}), source_sha256: hash, hash_basis: hashBasis, hash_status: hash ? "available" : "unavailable", imported_at: new Date().toISOString() } };
      setApplied(evidence); onEvidenceChange(evidence);
    }
    setBusy(false);
  };
  return <details className="assay-evidence">
    <summary>Compare with your experimental observations</summary>
    <p>Import a generic observation table from an assay such as GUIDE-seq or CIRCLE-seq. Your data stays in this browser; importing does not change predictions. Native assay formats require conversion to the columns below.</p>
    <p className="assay-note"><strong>Observed evidence is context dependent.</strong> A value above zero means reported evidence in this assay. Zero and missing observations are not confirmed negatives. No accuracy metric or combined model score is calculated.</p>
    {applied && <div className="assay-applied" role="status"><p><strong>{applied.summary.input_observations.toLocaleString()} observations applied</strong> from {applied.metadata.assay}. The applied import remains active while you edit or preview a replacement. Include experimental evidence in the analysis export to keep these observations.</p><button className="secondary" type="button" onClick={clearApplied}>Clear applied observations</button></div>}
    <div className="assay-fields">
      <label htmlFor={`${id}-assay`}>Assay name<input id={`${id}-assay`} maxLength={120} value={options.assay} placeholder="For example, GUIDE-seq" onChange={(event) => changeOptions({ assay: event.target.value })} /></label>
      <label htmlFor={`${id}-context`}>Sample context, optional<input id={`${id}-context`} maxLength={500} value={options.sampleContext} placeholder="Cell type, treatment or replicate" onChange={(event) => changeOptions({ sampleContext: event.target.value })} /></label>
      <label htmlFor={`${id}-mode`}>Match observations by<select id={`${id}-mode`} value={options.matchMode} onChange={(event) => changeOptions({ matchMode: event.target.value as EvidenceMatchMode })}><option value="pair-sequence">Guide + candidate sequences, both 23 nt</option><option value="candidate-sequence">Candidate sequence only — may match several guides or loci</option><option value="coordinates">GRCh38 interval + strand, exactly 23 bases</option></select></label>
      <label htmlFor={`${id}-value`}>Meaning of value column<select id={`${id}-value`} value={options.valueKind} onChange={(event) => changeOptions({ valueKind: event.target.value as EvidenceOptions["valueKind"] })}><option value="read_count">Observed read count (nonnegative integer)</option><option value="evidence_value">Observed evidence value (nonnegative number)</option></select></label>
    </div>
    {options.matchMode === "coordinates" ? <>
      <p>Required headers: <code>chromosome,start,end,strand,value</code>. Optional: <code>id,target</code>. Include the complete 23-base site and PAM; cleavage positions and assay peaks are not accepted. An optional actual 23-nt target narrows matches to its guide.</p>
      <div className="assay-fields"><label htmlFor={`${id}-assembly`}>Assembly<select id={`${id}-assembly`} value={options.assembly} onChange={(event) => changeOptions({ assembly: event.target.value as EvidenceOptions["assembly"] })}><option value="">Choose explicitly</option><option value="GRCh38">Human GRCh38</option></select></label><label htmlFor={`${id}-coordinate`}>Input coordinate convention<select id={`${id}-coordinate`} value={options.coordinateSystem} onChange={(event) => changeOptions({ coordinateSystem: event.target.value as EvidenceOptions["coordinateSystem"] })}><option value="">Choose explicitly</option><option value="0-based half-open">0-based half-open</option><option value="1-based inclusive">1-based inclusive</option></select></label></div>
    </> : <><p>Required headers: <code>{options.matchMode === "pair-sequence" ? "target,off_target,value" : "off_target,value"}</code>. Optional: <code>id</code>. Use actual 23-base DNA sequences including PAM, in guide orientation (5′ spacer → PAM 3′).</p>{options.matchMode === "candidate-sequence" && <p className="assay-note">Candidate-only matching may connect one observation to several guides or genomic loci. All possibilities remain explicitly ambiguous.</p>}</>}
    <label htmlFor={`${id}-file`}>Observation CSV or TSV file (up to 5 MiB and 10,000 rows)</label>
    <input ref={fileInput} id={`${id}-file`} type="file" accept=".csv,.tsv,.txt" onChange={async (event) => {
      const file = event.target.files?.[0]; invalidate(); const ticket = generation.current;
      setFilename(""); sourceBytes.current = null; setText("");
      if (!file) return;
      if (file.size > EVIDENCE_MAX_BYTES) { setError("Choose a file no larger than 5 MiB."); return; }
      try { const bytes = await file.arrayBuffer(); const content = new TextDecoder("utf-8", { fatal: true }).decode(bytes); if (ticket === generation.current) { setText(content); setFilename(file.name); sourceBytes.current = bytes; } }
      catch { if (ticket === generation.current) setError("The file could not be read as UTF-8. Save a UTF-8 CSV or TSV file, or paste its plain-text contents instead."); }
    }} />
    <label htmlFor={`${id}-text`}>Or paste the observation table</label>
    <textarea id={`${id}-text`} rows={5} value={text} spellCheck={false} onChange={(event) => { invalidate(); setText(event.target.value); setFilename(""); sourceBytes.current = null; if (fileInput.current) fileInput.current.value = ""; }} />
    <div className="assay-actions"><button type="button" className="secondary" onClick={() => { invalidate(); setPreview(previewAssayEvidence(text, options, rows)); setFilter("all"); }}>Preview observation matches</button><button type="button" className="secondary" onClick={() => { invalidate(); setText(SYNTHETIC_ASSAY_EVIDENCE[options.matchMode]); setFilename(""); sourceBytes.current = null; setOptions({ ...options, assay: "Synthetic format demonstration", sampleContext: "Invented observations; not experimental evidence", ...(options.matchMode === "coordinates" ? { assembly: "GRCh38", coordinateSystem: "0-based half-open" } as const : {}) }); if (fileInput.current) fileInput.current.value = ""; }}>Load synthetic format example</button><a href="https://github.com/Alexander-Mitrofanov/OfftargetPred-web-server/blob/main/docs/experimental-evidence.md" target="_blank" rel="noreferrer">Observation format help</a></div>
    {error && <p role="alert">{error}</p>}
    {preview && <section aria-label="Observation import preview">
      {preview.issues.length > 0 && <div className="assay-errors" role="alert"><p><strong>{preview.issues.length.toLocaleString()} import errors.</strong> Correct every error before applying; no rows are silently dropped.</p><ul>{preview.issues.slice(issuePage * PAGE_SIZE, (issuePage + 1) * PAGE_SIZE).map((issue, index) => <li key={`${issuePage}-${index}`}>{issue.row !== null ? `Data row ${issue.row}: ` : ""}{issue.message}</li>)}</ul>{preview.issues.length > PAGE_SIZE && <div className="assay-actions"><button type="button" disabled={issuePage === 0} onClick={() => setIssuePage(issuePage - 1)}>Previous errors</button><span>Error page {issuePage + 1} of {Math.ceil(preview.issues.length / PAGE_SIZE)}</span><button type="button" disabled={(issuePage + 1) * PAGE_SIZE >= preview.issues.length} onClick={() => setIssuePage(issuePage + 1)}>Next errors</button></div>}</div>}
      {state && <>
        <p role="status"><strong>{state.summary.input_observations.toLocaleString()} observations:</strong> {state.summary.matched_observations.toLocaleString()} match one row; {state.summary.ambiguous_observations.toLocaleString()} have multiple possible matches; {state.summary.unmatched_observations.toLocaleString()} have no match. {state.summary.prediction_rows_with_observations.toLocaleString()} of {rows.length.toLocaleString()} prediction rows have at least one possible observation match.</p>
        <p>{state.summary.duplicate_observations.toLocaleString()} duplicate matching-key/value observations retained separately. Values are never summed. {state.summary.positive_observations.toLocaleString()} input rows report values above zero; {state.summary.zero_observations.toLocaleString()} report zero. These counts include duplicates and unmatched observations.</p>
        <label htmlFor={`${id}-filter`}>Show observations<select id={`${id}-filter`} value={filter} onChange={(event) => { setFilter(event.target.value); setPage(0); }}><option value="all">All observations</option><option value="matched">One match</option><option value="ambiguous">Multiple possible matches</option><option value="unmatched">No match</option></select></label>
        <div className="assay-table" tabIndex={0} role="region" aria-label="Observation matches, scroll horizontally if needed"><table><caption>Observation preview: {observations.length.toLocaleString()} rows in this view</caption><thead><tr><th scope="col">Observation</th><th scope="col">Reported value</th><th scope="col">Match status</th><th scope="col">Inspect</th></tr></thead><tbody>{observations.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map((observation) => <tr key={observation.import_row_id}><th scope="row">{observation.source_id ?? observation.import_row_id}<small>Input data row {observation.input_record}{observation.duplicate_of ? `; duplicates ${observation.duplicate_of}` : ""}</small></th><td>{observation.value}<small>{observation.value > 0 ? "Reported observed evidence" : "Reported zero; not a confirmed negative"}</small></td><td>{matchLabels[observation.status]} ({observation.match_result_indices.length.toLocaleString()})</td><td><button type="button" className="secondary" onClick={() => setInspected(observation.import_row_id)} aria-label={`Inspect matches for observation ${observation.input_record}`}>Inspect matches</button></td></tr>)}</tbody></table></div>
        {observations.length === 0 && <p>No observations in this view.</p>}
        {observations.length > PAGE_SIZE && <div className="assay-actions"><button type="button" className="secondary" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous observations</button><span>Observation page {page + 1} of {Math.ceil(observations.length / PAGE_SIZE)}</span><button type="button" className="secondary" disabled={(page + 1) * PAGE_SIZE >= observations.length} onClick={() => setPage(page + 1)}>Next observations</button></div>}
        {inspectedObservation && <MatchList key={inspectedObservation.import_row_id} observation={inspectedObservation} rows={rows} />}
        <button type="button" disabled={!preview.canApply || busy} onClick={() => void apply()}>{busy ? "Preparing observations…" : `Apply ${state.summary.input_observations.toLocaleString()} observations`}</button>
      </>}
    </section>}
    <p className="assay-note">Imports live in memory for this result tab and are cleared on reload. The analysis export preserves applied observations and their matching declarations. Matching does not verify assay provenance or biological equivalence.</p>
  </details>;
}
