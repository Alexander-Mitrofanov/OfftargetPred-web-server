import { useEffect, useId, useMemo, useState } from "react";
import type { ResultRow } from "../api";
import { compareGuide, comparisonGuides, comparisonModelLabel, comparisonModels, comparisonScore, comparisonTableRows } from "../features/comparison";
import type { ComparisonModel, RankedCandidate } from "../features/comparison";
import "./ModelComparison.css";
import { RankPlot } from "./RankPlot";

export interface ModelComparisonProps {
  rows: ResultRow[];
  selectedGuideKey?: string;
  onGuideChange?: (key: string) => void;
  selectedRowKeys?: ReadonlySet<string>;
  onToggleRow?: (row: ResultRow) => void;
}

function Rank({ value }: { value: RankedCandidate | null }) {
  return value ? <span>{value.rank}{value.firstRank !== value.lastRank && <small>tie: positions {value.firstRank}–{value.lastRank}</small>}</span> : <span>Unavailable</span>;
}

function ComparisonBody({ rows, selectedGuideKey, onGuideChange, selectedRowKeys, onToggleRow }: ModelComparisonProps) {
  const id = useId();
  const [localGuide, setLocalGuide] = useState(selectedGuideKey ?? "");
  const [guideSearch, setGuideSearch] = useState("");
  const [includeCfd, setIncludeCfd] = useState(false);
  const [chosenA, setChosenA] = useState<ComparisonModel>("k1");
  const [chosenB, setChosenB] = useState<ComparisonModel>("k2");
  const [topN, setTopN] = useState(10);
  const [view, setView] = useState<"top" | "disagreement" | "all">("top");
  const [page, setPage] = useState(0);
  useEffect(() => { setLocalGuide(selectedGuideKey ?? ""); setPage(0); }, [selectedGuideKey]);
  const guide = onGuideChange ? selectedGuideKey ?? "" : localGuide;
  const guides = useMemo(() => comparisonGuides(rows), [rows]);
  const matchingGuides = useMemo(() => guides.filter(item => item.label.toLowerCase().includes(guideSearch.toLowerCase().trim())), [guides, guideSearch]);
  const options = matchingGuides.slice(0, 200);
  const chosenGuide = guides.find(item => item.key === guide);
  if (chosenGuide && !options.some(item => item.key === guide)) options.unshift(chosenGuide);
  const availableModels = useMemo(() => comparisonModels.filter(model => (includeCfd || model !== "cfd") && rows.some(row => comparisonScore(row, model) !== null)), [rows, includeCfd]);
  const a = availableModels.includes(chosenA) ? chosenA : availableModels[0];
  const b = availableModels.includes(chosenB) && chosenB !== a ? chosenB : availableModels.find(model => model !== a);
  const result = useMemo(() => a && b ? compareGuide(rows, guide, a, b, topN) : null, [rows, guide, a, b, topN]);
  const sorted = useMemo(() => comparisonTableRows(result?.candidates ?? [], view), [result, view]);
  const lastPage = Math.max(0, Math.ceil(sorted.length / 25) - 1), safePage = Math.min(page, lastPage);
  const visible = sorted.slice(safePage * 25, (safePage + 1) * 25);
  const selectGuide = (key: string) => { setLocalGuide(key); onGuideChange?.(key); setPage(0); };
  const setModelA = (model: ComparisonModel) => { if (model === b && a) setChosenB(a); setChosenA(model); setPage(0); };
  const setModelB = (model: ComparisonModel) => { if (model === a && b) setChosenA(b); setChosenB(model); setPage(0); };

  return <div className="model-comparison-body">
    <p>Compare candidate ranks for one guide. Each score is ranked separately; no scores are combined. The three CRISPert checkpoints also differ in pretraining, so this is not a controlled experiment on k-mer length.</p>
    <div className="model-comparison-controls">
      {guides.length > 200 && <label>Find a guide<input type="search" value={guideSearch} onChange={event => setGuideSearch(event.target.value)} placeholder="Guide ID or sequence" /></label>}
      <label>Guide<select value={guide} onChange={event => selectGuide(event.target.value)}><option value="">Choose one guide</option>{options.map(item => <option value={item.key} key={item.key}>{item.label} ({item.count.toLocaleString()} candidates)</option>)}</select></label>
      <label className="model-comparison-check"><input type="checkbox" checked={includeCfd} onChange={event => { setIncludeCfd(event.target.checked); setPage(0); }} />Include CFD as a comparison option</label>
    </div>
    {matchingGuides.length > 200 && <p className="field-hint">Showing the first 200 matching guides and the selected guide. Use Find a guide to narrow the list.</p>}
    {!rows.length && <p>No candidate rows are available to compare.</p>}
    {rows.length > 0 && availableModels.length < 2 && <p>Two scored models are needed. Choose additional CRISPert models in a new analysis, or include the separate CFD baseline when available.</p>}
    {availableModels.length >= 2 && <>
      <div className="model-comparison-controls">
        <label>First model<select value={a} onChange={event => setModelA(event.target.value as ComparisonModel)}>{availableModels.map(model => <option key={model} value={model}>{comparisonModelLabel[model]}</option>)}</select></label>
        <label>Second model<select value={b} onChange={event => setModelB(event.target.value as ComparisonModel)}>{availableModels.map(model => <option key={model} value={model}>{comparisonModelLabel[model]}</option>)}</select></label>
        <label>Top candidates per model<select value={topN} onChange={event => { setTopN(Number(event.target.value)); setPage(0); }}>{[5, 10, 20, 50, 100].map(number => <option key={number} value={number}>{number}</option>)}</select></label>
      </div>
      {!guide && <p>Choose a guide to compare its complete candidate set.</p>}
      {guide && !chosenGuide && <p>This guide has no candidate rows in this document.</p>}
      {chosenGuide && result && a && b && <>
        <p id={`${id}-scope`} className="model-comparison-scope">All {result.total.toLocaleString()} candidates for {chosenGuide.label}. Table filters, pagination and shortlist selection do not change these ranks.</p>
        <dl className="model-comparison-statistics">
          <div><dt>Top-{result.topN} intersection</dt><dd>{result.intersection.toLocaleString()} shared candidates<small>{result.topCountA.toLocaleString()} in {comparisonModelLabel[a]}; {result.topCountB.toLocaleString()} in {comparisonModelLabel[b]}. All cutoff ties included.</small></dd></div>
          <div><dt>Spearman rank correlation</dt><dd>{result.correlation.value === null ? "Unavailable" : result.correlation.value.toFixed(3)} <small>n = {result.correlation.n.toLocaleString()} jointly scored candidates</small>{result.correlation.reason && <small>{result.correlation.reason === "constant_ranks" ? "At least one model gives every jointly scored candidate the same score." : "At least three jointly scored candidates are required for this display."}</small>}{result.correlation.n >= 3 && result.correlation.n < 10 && <small>Small candidate set; descriptive comparison only.</small>}</dd></div>
        </dl>
        <p className="field-hint">Missing scores: {comparisonModelLabel[a]} {result.missingA.toLocaleString()}; {comparisonModelLabel[b]} {result.missingB.toLocaleString()}. Candidates in score ties: {result.tiedA.toLocaleString()} and {result.tiedB.toLocaleString()}, respectively.</p>
        <RankPlot candidates={result.candidates} firstLabel={comparisonModelLabel[a]} secondLabel={comparisonModelLabel[b]} />
        <details className="model-comparison-rules"><summary>How to read these comparisons</summary><ul>
          <li>Rank 1 has the largest score within this guide and model. Exactly equal scores share their average rank; stable row identity controls display order within ties.</li>
          <li>Top-N sets include every candidate tied at the Nth position, so a set can contain more than N candidates. Each model uses all its scored candidates; missing scores are not zero.</li>
          <li>The table shows independent ranks within each model’s full scored set. Rank differences can reflect unequal missing-score counts. Spearman instead reranks only the candidates scored by both models, with tied average ranks.</li>
          <li>Correlation and disagreement describe prediction order, not model accuracy, experimental evidence, calibrated cleavage probability or guide safety. No significance test is performed.</li>
        </ul></details>
        <label className="model-comparison-view">Rows to display<select value={view} onChange={event => { setView(event.target.value as typeof view); setPage(0); }}><option value="top">Top candidates from either model</option><option value="disagreement">All candidates, largest rank differences first</option><option value="all">All candidates, highest ranks first</option></select></label>
        <p role="status">{sorted.length.toLocaleString()} candidates in this comparison view. {visible.length ? `Showing ${safePage * 25 + 1}–${Math.min((safePage + 1) * 25, sorted.length)}.` : "No scored candidates in the top sets."}</p>
        <div className="model-comparison-table" tabIndex={0} role="region" aria-label="Model rank comparison; scroll horizontally" aria-describedby={`${id}-scope`}>
          <table><caption>Separate candidate ranks for {comparisonModelLabel[a]} and {comparisonModelLabel[b]}. Positive rank difference means a higher numeric rank in the first model.</caption><thead><tr>{onToggleRow && <th scope="col">Select</th>}<th scope="col">Candidate</th><th scope="col">{comparisonModelLabel[a]} rank</th><th scope="col">{comparisonModelLabel[b]} rank</th><th scope="col">Rank difference (first − second)</th><th scope="col">Top-{result.topN} membership</th></tr></thead><tbody>
            {visible.map(item => <tr key={item.key} className={selectedRowKeys?.has(item.key) ? "model-comparison-selected" : undefined}>{onToggleRow && <td><input type="checkbox" aria-label={`Select candidate ${item.row.id}, row ${item.row.row_index ?? "unknown"} from comparison`} checked={selectedRowKeys?.has(item.key) ?? false} onChange={() => onToggleRow(item.row)} /></td>}<th scope="row"><span>{item.row.id}</span><code>{item.row.off_target}</code>{item.row.chromosome && item.row.start !== undefined && <small>{item.row.chromosome}:{item.row.start + 1}–{item.row.end ?? "?"} ({item.row.strand ?? "?"}), 1-based inclusive</small>}<small>Row {item.row.row_index ?? "not recorded"}</small></th><td><Rank value={item.a} /></td><td><Rank value={item.b} /></td><td>{item.delta === null ? "Unavailable" : `${item.delta > 0 ? "+" : ""}${item.delta}`}</td><td>{item.topA && item.topB ? "Both models" : item.topA ? comparisonModelLabel[a] : item.topB ? comparisonModelLabel[b] : "Neither model"}</td></tr>)}
            {!visible.length && <tr><td colSpan={onToggleRow ? 6 : 5}>No candidates in this comparison view.</td></tr>}
          </tbody></table>
        </div>
        {sorted.length > 25 && <div className="model-comparison-pagination"><button type="button" className="button secondary compact" disabled={!safePage} onClick={() => setPage(safePage - 1)}>Previous comparison page</button><button type="button" className="button secondary compact" disabled={safePage >= lastPage} onClick={() => setPage(safePage + 1)}>Next comparison page</button></div>}
      </>}
    </>}
  </div>;
}

/** Mount costly full-document rank work only when the section is opened. */
export function ModelComparison(props: ModelComparisonProps) {
  const [open, setOpen] = useState(false);
  return <details className="model-comparison" onToggle={event => setOpen(event.currentTarget.open)}><summary>Compare model rankings</summary>{open && <ComparisonBody {...props} />}</details>;
}
