import { useEffect, useId, useRef, useState } from "react";
import { api } from "../api";
import type { ResolvedGuideLocus } from "./GuideResolver";
import { discoveryInterval, validateDiscoveryDocument, validateGeneDocument } from "../features/guideDiscovery";
import type { DiscoveryDocument, GeneDocument, GeneLocus } from "../features/guideDiscovery";
import "./GuideDiscovery.css";

interface Props {
  available: boolean;
  genesAvailable: boolean;
  onResolved: (guide23: string, locus: ResolvedGuideLocus) => void;
}

/** All remote calls are explicit; choosing a locus never submits a scoring job. */
export function GuideDiscovery({ available, genesAvailable, onResolved }: Props) {
  const id = useId();
  const [query, setQuery] = useState("");
  const [genes, setGenes] = useState<GeneDocument | null>(null);
  const [chromosome, setChromosome] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [result, setResult] = useState<DiscoveryDocument | null>(null);
  const [chosen, setChosen] = useState<number | null>(null);
  const [busy, setBusy] = useState<"gene" | "guides" | null>(null);
  const [error, setError] = useState("");
  const [applied, setApplied] = useState(false);
  const generation = useRef(0);
  useEffect(() => () => { generation.current += 1; }, []);
  useEffect(() => { generation.current += 1; setBusy(null); setResult(null); setChosen(null); }, [available, genesAvailable]);

  function invalidate() {
    generation.current += 1; setBusy(null); setResult(null); setChosen(null); setApplied(false); setError("");
  }
  async function lookup() {
    invalidate(); setGenes(null);
    if (!query.trim() || query.trim().length > 100) { setError("Enter an exact gene name or unversioned Ensembl gene/transcript identifier."); return; }
    const current = generation.current;
    setBusy("gene");
    try {
      const response = await api<GeneDocument>("/discover-genes", { method: "POST", body: JSON.stringify({ query: query.trim(), assembly: "GRCh38" }) });
      if (current === generation.current) setGenes(validateGeneDocument(response));
    } catch (failure) {
      if (current === generation.current) setError(failure instanceof Error ? failure.message : "Gene lookup failed. You can enter an interval below.");
    } finally { if (current === generation.current) setBusy(null); }
  }
  async function discover() {
    invalidate();
    const current = generation.current;
    try {
      const input = discoveryInterval(chromosome, start, end);
      setBusy("guides");
      const response = await api<DiscoveryDocument>("/discover-guides", { method: "POST", body: JSON.stringify(input) });
      if (current === generation.current) setResult(validateDiscoveryDocument(response));
    } catch (failure) {
      if (current === generation.current) setError(failure instanceof Error ? failure.message : "Guide discovery failed.");
    } finally { if (current === generation.current) setBusy(null); }
  }
  function selectLocus(locus: GeneLocus) {
    invalidate(); setChromosome(locus.chromosome); setStart(String(locus.start + 1)); setEnd(String(locus.end));
  }
  const selected = result && chosen !== null ? result.guides[chosen] : null;

  return <details className="guide-discovery">
    <summary>Start from a gene or genomic region</summary>
    <div className="guide-discovery-body">
      <p>Find eligible 20-nt spacers with their actual NGG PAM in the installed GRCh38 reference. Then choose a guide for an off-target search.</p>
      {!available && <p role="status">Reference guide discovery is currently unavailable. You can still enter a complete 23-nt guide.</p>}
      <fieldset disabled={!available || !genesAvailable} onKeyDown={(event) => {
        if (event.key === "Enter" && event.target instanceof HTMLInputElement) { event.preventDefault(); if (!busy) void lookup(); }
      }}>
        <legend>1. Optional: find a gene or transcript</legend>
        <label htmlFor={`${id}-query`}>Exact gene name or Ensembl identifier
          <input id={`${id}-query`} value={query} maxLength={100} autoComplete="off" placeholder="e.g. TP53 or ENSG00000141510"
            onChange={(event) => { invalidate(); setGenes(null); setQuery(event.target.value); }} />
        </label>
        <p className="guide-discovery-note">Case-sensitive names; unversioned gene or transcript IDs. Aliases are unsupported. No canonical transcript is chosen.</p>
        <button type="button" disabled={!!busy} onClick={() => { void lookup(); }}>{busy === "gene" ? "Finding annotation loci…" : "Find gene or transcript"}</button>
      </fieldset>
      {available && !genesAvailable && <p>Gene lookup is unavailable; use a reference interval below.</p>}
      {genes && <div className="guide-discovery-gene-results">
        <p role="status">{genes.matches.length === 0 ? "No exact annotation match. Check spelling/case, use an unversioned Ensembl ID, or enter coordinates below."
          : `${genes.matches.length} ${genes.matches.length > 1 ? "matching loci; choose the intended locus explicitly" : "matching locus; review and choose it below"}. ${genes.annotation.source} release ${genes.annotation.release}.`}</p>
        {genes.matches.map((locus, index) => <div className="guide-discovery-locus" key={`${locus.chromosome}-${locus.start}-${index}`}>
          <span><strong>{locus.gene_name}</strong> · {locus.transcript_id || locus.gene_id}<br />{locus.chromosome}:{(locus.start + 1).toLocaleString()}–{locus.end.toLocaleString()} ({locus.strand}) · {(locus.end - locus.start).toLocaleString()} bases</span>
          <button type="button" onClick={() => selectLocus(locus)}>Use this {locus.feature} interval</button>
          {locus.requires_narrowing && <span className="guide-discovery-note">This interval exceeds 20,000 bases; narrow it below before searching.</span>}
        </div>)}
        {genes.matches.length > 0 && <p className="guide-discovery-note">Gene and transcript spans include introns. Choosing a span does not select an exon or predict experimental suitability.</p>}
      </div>}
      <fieldset disabled={!available} onKeyDown={(event) => {
        if (event.key === "Enter" && event.target instanceof HTMLInputElement) { event.preventDefault(); if (!busy) void discover(); }
      }}>
        <legend>2. Choose a reference interval</legend>
        <div className="guide-discovery-coordinates">
          <label htmlFor={`${id}-chromosome`}>Chromosome<input id={`${id}-chromosome`} value={chromosome} maxLength={200} autoComplete="off" placeholder="e.g. chr17"
            onChange={(event) => { invalidate(); setChromosome(event.target.value); }} /></label>
          <label htmlFor={`${id}-start`}>Start · 1-based<input id={`${id}-start`} value={start} maxLength={12} inputMode="numeric" autoComplete="off" placeholder="First base"
            onChange={(event) => { invalidate(); setStart(event.target.value); }} /></label>
          <label htmlFor={`${id}-end`}>End · inclusive<input id={`${id}-end`} value={end} maxLength={12} inputMode="numeric" autoComplete="off" placeholder="Last base"
            onChange={(event) => { invalidate(); setEnd(event.target.value); }} /></label>
        </div>
        <p className="guide-discovery-note">23–20,000 bases; both strands. The complete spacer and PAM must lie inside this interval. If more than 200 sites occur, narrow the interval. Coordinates always refer to the forward reference.</p>
        <button type="button" disabled={!!busy} onClick={() => { void discover(); }}>{busy === "guides" ? "Finding reference guides…" : "Discover NGG guides"}</button>
      </fieldset>
      {error && <p role="alert" className="guide-discovery-error">{error}</p>}
      {result && <div className="guide-discovery-results">
        <p role="status">{result.guides.length === 0 ? "No unambiguous full 23-nt NGG sites occur inside this interval." : `${result.guides.length} eligible reference sites. Choose one to add to your genome-search input.`}</p>
        <p className="guide-discovery-note">Listed by reference position and strand. No on-target efficiency or off-target ranking has been calculated. {result.scope.ambiguous_windows_skipped > 0 && `${result.scope.ambiguous_windows_skipped.toLocaleString()} windows containing ambiguous reference bases were skipped.`}</p>
        {result.guides.length > 0 && <>
          <div className="guide-discovery-table" role="region" aria-label="Discovered reference guides" tabIndex={0}>
            <table><caption>GRCh38 · full 23-nt loci · 1-based inclusive coordinates</caption>
              <thead><tr><th scope="col">Choose</th><th scope="col">Reference locus</th><th scope="col">Strand</th><th scope="col">Spacer + PAM · 5′→3′</th></tr></thead>
              <tbody>{result.guides.map((guide, index) => <tr key={`${guide.start}-${guide.strand}`}>
                <td><input type="radio" name={`${id}-candidate`} checked={chosen === index} aria-label={`Choose ${guide.chromosome}:${guide.start + 1}–${guide.end} (${guide.strand})`}
                  onChange={() => { setChosen(index); setApplied(false); }} /></td>
                <td>{guide.chromosome}:{(guide.start + 1).toLocaleString()}–{guide.end.toLocaleString()}</td><td>{guide.strand}</td>
                <td><code>{guide.target23.slice(0, 20)}<strong>{guide.pam}</strong></code></td>
              </tr>)}</tbody></table>
          </div>
          <button type="button" disabled={!selected || !available} onClick={() => {
            if (selected && available) { onResolved(selected.target23, selected); setApplied(true); }
          }}>Use selected reference guide</button>
          {applied && <p role="status">Guide and intended reference locus added. Review the genome-search input before submitting.</p>}
        </>}
      </div>}
    </div>
  </details>;
}
