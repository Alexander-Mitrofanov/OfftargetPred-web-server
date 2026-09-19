import { useEffect, useId, useMemo, useState } from "react";
import type { ResultRow } from "../api";
import { comparisonGuides, comparisonModelLabel, comparisonModels, comparisonScore } from "../features/comparison";
import type { ComparisonModel } from "../features/comparison";
import { applyShortlist, defaultShortlistRule, MAX_AUTOMATIC_SHORTLIST, planShortlist, reconcileSelectionNotes, shortlistGuideSummary } from "../features/shortlist";
import type { SelectionNotes, ShortlistRule } from "../features/shortlist";
import { candidateKey } from "../features/resultIdentity";
import "./ShortlistBuilder.css";

export interface ShortlistBuilderProps {
  rows: ResultRow[];
  selectedKeys: ReadonlySet<string>;
  onSelectionChange: (keys: Set<string>) => void;
  metadata?: Record<string, unknown>;
  onNotesChange?: (notes: SelectionNotes) => void;
}

export function ShortlistBuilder({ rows, selectedKeys, onSelectionChange, onNotesChange }: ShortlistBuilderProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [rule, setRule] = useState(defaultShortlistRule), [includeCfd, setIncludeCfd] = useState(false);
  const [guideSearch, setGuideSearch] = useState(""), [message, setMessage] = useState("");
  const [notes, setNotes] = useState<SelectionNotes>({}), [page, setPage] = useState(0), [summaryPage, setSummaryPage] = useState(0);
  const guides = useMemo(() => comparisonGuides(rows), [rows]);
  const models = useMemo(() => comparisonModels.filter(model => (model !== "cfd" || includeCfd) && rows.some(row => comparisonScore(row, model) !== null)), [rows, includeCfd]);
  const effectiveRule = useMemo(() => ({ ...rule, model: models.includes(rule.model) ? rule.model : models[0] ?? "k1" }), [rule, models]);
  const plan = useMemo(() => planShortlist(open ? rows : [], effectiveRule), [rows, effectiveRule, open]);
  const selectedRows = useMemo(() => rows.filter(row => selectedKeys.has(candidateKey(row))), [rows, selectedKeys]);
  const summaries = useMemo(() => shortlistGuideSummary(open ? rows : [], selectedKeys), [rows, selectedKeys, open]);
  const currentNotes = useMemo(() => reconcileSelectionNotes(selectedKeys, notes), [selectedKeys, notes]);
  // Synchronize external table changes, removing stale reasons after deselection.
  useEffect(() => { setNotes(current => reconcileSelectionNotes(selectedKeys, current)); }, [selectedKeys]);
  useEffect(() => { onNotesChange?.(currentNotes); }, [currentNotes, onNotesChange]);
  const matchingGuides = guides.filter(guide => guide.label.toLowerCase().includes(guideSearch.toLowerCase().trim()));
  const guideOptions = matchingGuides.slice(0, 200), selectedGuide = guides.find(guide => guide.key === rule.guide);
  if (selectedGuide && !guideOptions.some(guide => guide.key === rule.guide)) guideOptions.unshift(selectedGuide);
  const pageMax = Math.max(0, Math.ceil(selectedRows.length / 25) - 1), safePage = Math.min(page, pageMax);
  const summaryMax = Math.max(0, Math.ceil(summaries.length / 25) - 1), safeSummaryPage = Math.min(summaryPage, summaryMax);
  function changeRule<K extends keyof ShortlistRule>(key: K, value: ShortlistRule[K]) { setRule(current => ({ ...current, [key]: value })); setMessage(""); }
  function apply(action: "add" | "replace") {
    const next = applyShortlist(selectedKeys, plan, action);
    setNotes(reconcileSelectionNotes(next, action === "replace" ? {} : currentNotes, plan.notes));
    onSelectionChange(next); setPage(0);
    setMessage(`${action === "replace" ? "Replaced the shortlist" : "Added the proposal to the shortlist"}. ${next.size.toLocaleString()} candidates selected.`);
  }
  function clear() { onSelectionChange(new Set()); setNotes({}); setPage(0); setMessage("Cleared the shortlist. No candidates selected."); }
  function remove(row: ResultRow) { const next = new Set(selectedKeys); next.delete(candidateKey(row)); onSelectionChange(next); setMessage(`Removed candidate ${row.id} from the shortlist.`); }

  return <details className="shortlist-builder" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>Build an experimental validation shortlist ({selectedRows.length.toLocaleString()} selected)</summary>
    {open && <section aria-labelledby={id}>
      <h3 id={id}>Choose candidates for follow-up</h3>
      <p>Use one model’s ranking to propose candidates, then review your choices. This is a planning list, not experimental validation evidence. Scores are uncalibrated and do not establish guide safety.</p>
      <p className="shortlist-scope">Rules use the complete result document, independently of table filters and pagination. Changing a rule only changes the preview; your current choices remain until you use a selection action.</p>
      <div className="shortlist-controls">
        {guides.length > 200 && <label>Find guide for shortlist<input type="search" value={guideSearch} onChange={event => setGuideSearch(event.target.value)} placeholder="Guide ID or sequence" /></label>}
        <label>Guide scope<select value={rule.guide} onChange={event => changeRule("guide", event.target.value)}><option value="">Every guide, ranked separately</option>{guideOptions.map(guide => <option key={guide.key} value={guide.key}>{guide.label}</option>)}</select></label>
        <label>Ranking model<select value={effectiveRule.model} disabled={!models.length} onChange={event => changeRule("model", event.target.value as ComparisonModel)}>{models.map(model => <option key={model} value={model}>{comparisonModelLabel[model]}</option>)}</select></label>
        <label>Number per group<select value={rule.perGroup} onChange={event => changeRule("perGroup", Number(event.target.value))}>{[1, 3, 5, 10, 20, 50, 100].map(n => <option key={n} value={n}>{n}</option>)}</select></label>
        <label>Grouping within each guide<select value={rule.stratify} onChange={event => changeRule("stratify", event.target.value as ShortlistRule["stratify"])}><option value="none">One group: all candidates</option><option value="mismatches">Separate protospacer mismatch counts</option><option value="annotation">Separate genomic annotation categories</option></select></label>
      </div>
      {matchingGuides.length > 200 && <p className="field-hint">Showing the first 200 matching guides and the selected guide. Use Find guide to narrow this list.</p>}
      <div className="shortlist-checks">
        <label><input type="checkbox" checked={includeCfd} onChange={event => { setIncludeCfd(event.target.checked); setMessage(""); }} />Offer CFD as a separate ranking option</label>
        <label><input type="checkbox" checked={rule.includeTies} onChange={event => changeRule("includeTies", event.target.checked)} />Include all candidates tied at the cutoff</label>
        <label><input type="checkbox" checked={rule.excludeIntended} onChange={event => changeRule("excludeIntended", event.target.checked)} />Exclude user-designated intended target loci before ranking</label>
      </div>
      <p className="field-hint">A full sequence match alone does not identify an intended target locus. {rule.excludeIntended ? "Only rows explicitly designated by the user are excluded." : "Intended loci and other exact sequence matches remain eligible."} {rule.includeTies ? "Ties can make a group larger than N." : "Equal scores at the cutoff are ordered by stable row identity; this is an arbitrary tie break, not evidence of a biological difference."}</p>
      {rule.stratify === "mismatches" && <p className="field-hint">Each mismatch count (0–20) is a separate group, plus an unknown-count group when needed. Mismatches refer to the 20-base protospacer, excluding the PAM.</p>}
      {rule.stratify === "annotation" && <p className="field-hint">Candidates can belong to multiple annotation categories and are selected only once. Unavailable annotations and missing coordinates are separate groups; neither is labelled intergenic.</p>}
      <div className="shortlist-preview">
        <h4>Rule preview</h4>
        <p><strong>{plan.keys.size.toLocaleString()} distinct candidates proposed</strong> from {plan.considered.toLocaleString()} rows in the chosen guide scope, across {plan.groups.length.toLocaleString()} scored groups. {plan.missingScores.toLocaleString()} rows lack a finite {comparisonModelLabel[effectiveRule.model]} score; {plan.excludedIntended.toLocaleString()} designated intended loci excluded.</p>
        {!models.length && <p>No model has a usable score in this document. You can still select candidates manually.</p>}
        {plan.groups.some(group => group.boundaryTie > 0) && <p>{plan.groups.filter(group => group.boundaryTie > 0).length.toLocaleString()} groups have tied scores spanning the cutoff.</p>}
        {plan.blocked && <p role="alert">This proposal exceeds the {MAX_AUTOMATIC_SHORTLIST.toLocaleString()}-candidate limit for automatic selection. Choose one guide, reduce N or change the grouping. No cutoff ties are silently removed.</p>}
        <ol>{plan.rows.slice(0, 10).map(row => <li key={candidateKey(row)}><strong>{row.id}</strong> · {row.guide_id ?? row.target} · row {row.row_index ?? "not recorded"} · {comparisonModelLabel[effectiveRule.model]} {comparisonScore(row, effectiveRule.model)}{row.user_selected_locus && <span> · user-designated intended locus</span>}</li>)}</ol>
        {plan.rows.length > 10 && <p className="field-hint">Showing the first 10 proposed candidates in original result order. Applying the rule includes all {plan.keys.size.toLocaleString()} proposed candidates.</p>}
        <div className="shortlist-actions">
          <button type="button" className="button secondary compact" disabled={!plan.keys.size || plan.blocked || !models.length} onClick={() => apply("add")}>Add proposal to existing selection</button>
          <button type="button" className="button secondary compact" disabled={!plan.keys.size || plan.blocked || !models.length} onClick={() => apply("replace")}>Replace selection with proposal</button>
          <button type="button" className="button secondary compact" disabled={!selectedKeys.size} onClick={clear}>Clear all selected candidates</button>
        </div>
        <p role="status" aria-live="polite">{message}</p>
      </div>
      <h4>Current selection: {selectedRows.length.toLocaleString()} candidates</h4>
      <p>Manual choices are retained when you add a proposal. “Replace selection” discards earlier choices and records the new rule. Selection reasons travel with the downloadable analysis package when exports are available.</p>
      {summaries.length > 0 && <div className="shortlist-table" tabIndex={0} role="region" aria-label="Selected candidates per guide; scroll horizontally"><table><caption>Selection by guide; counts include rows hidden by current table filters.</caption><thead><tr><th scope="col">Guide</th><th scope="col">Selected</th><th scope="col">Available</th></tr></thead><tbody>{summaries.slice(safeSummaryPage * 25, (safeSummaryPage + 1) * 25).map(guide => <tr key={guide.key}><th scope="row">{guide.label}</th><td>{guide.selected.toLocaleString()}</td><td>{guide.available.toLocaleString()}</td></tr>)}</tbody></table></div>}
      {summaries.length > 25 && <div className="shortlist-actions"><span>Guide summary page {safeSummaryPage + 1} of {summaryMax + 1}</span><button type="button" disabled={!safeSummaryPage} onClick={() => setSummaryPage(safeSummaryPage - 1)}>Previous guide summary</button><button type="button" disabled={safeSummaryPage >= summaryMax} onClick={() => setSummaryPage(safeSummaryPage + 1)}>Next guide summary</button></div>}
      {!selectedRows.length ? <p>No candidates selected. Use the result-table checkboxes or add a rule proposal.</p> : <div className="shortlist-table" tabIndex={0} role="region" aria-label="Current experimental shortlist; scroll horizontally"><table><caption>Selected candidates in original result order, with selection reasons.</caption><thead><tr><th scope="col">Candidate</th><th scope="col">Guide</th><th scope="col">Selection reasons</th><th scope="col">Action</th></tr></thead><tbody>{selectedRows.slice(safePage * 25, (safePage + 1) * 25).map(row => <tr key={candidateKey(row)}><th scope="row">{row.id}<code>{row.off_target}</code><small>Row {row.row_index ?? "not recorded"}{row.user_selected_locus ? " · user-designated intended locus" : ""}</small></th><td>{row.guide_id ?? row.target}</td><td><ul>{currentNotes[candidateKey(row)]?.map(reason => <li key={reason}>{reason}</li>)}</ul></td><td><button type="button" aria-label={`Remove candidate ${row.id}, row ${row.row_index ?? "unknown"}, from shortlist`} onClick={() => remove(row)}>Remove</button></td></tr>)}</tbody></table></div>}
      {selectedRows.length > 25 && <div className="shortlist-actions"><span>Shortlist page {safePage + 1} of {pageMax + 1}</span><button type="button" disabled={!safePage} onClick={() => setPage(safePage - 1)}>Previous shortlist page</button><button type="button" disabled={safePage >= pageMax} onClick={() => setPage(safePage + 1)}>Next shortlist page</button></div>}
    </section>}
  </details>;
}
