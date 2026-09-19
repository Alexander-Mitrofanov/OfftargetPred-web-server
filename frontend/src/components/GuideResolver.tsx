import { useEffect, useId, useRef, useState } from "react";
import { api } from "../api";
import "./GuideResolver.css";

export interface ResolvedGuideLocus {
  chromosome: string;
  start: number;
  end: number;
  spacer_start: number;
  spacer_end: number;
  strand: "+" | "-";
  target23: string;
  pam: string;
  assembly: "GRCh38";
  coordinate_system: string;
  reference_sha256: string;
}

interface ResolverDocument {
  spacer: string;
  matches: ResolvedGuideLocus[];
  reference_sha256: string;
  scope: { chromosome: string; start: number; end: number; complete: boolean };
}

interface GuideResolverProps {
  available: boolean;
  onResolved: (guide23: string, locus: ResolvedGuideLocus) => void;
}

const PAGE_SIZE = 50;

/** Optional helper: no callback fires until the user chooses and confirms a site. */
export function GuideResolver({ available, onResolved }: GuideResolverProps) {
  const id = useId();
  const [spacer, setSpacer] = useState("");
  const [chromosome, setChromosome] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [result, setResult] = useState<ResolverDocument | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [applied, setApplied] = useState(false);
  const request = useRef(0);

  useEffect(() => {
    return () => { request.current += 1; };
  }, []);
  useEffect(() => {
    if (!available) {
      request.current += 1;
      setResult(null);
      setSelected(null);
      setBusy(false);
    }
  }, [available]);

  function invalidate() {
    request.current += 1;
    setResult(null);
    setSelected(null);
    setPage(0);
    setBusy(false);
    setError("");
    setApplied(false);
  }

  async function resolve() {
    invalidate();
    if (!available) return;
    if (!/^[ACGT]{20}$/i.test(spacer.trim())) {
      setError("Enter exactly 20 DNA bases: A, C, G and T. RNA U and ambiguous bases are unsupported.");
      return;
    }
    const first = Number(start), last = Number(end);
    if (!/^\d+$/.test(start) || !/^\d+$/.test(end) || !Number.isSafeInteger(first) || !Number.isSafeInteger(last)
        || first < 1 || last - first + 1 < 20 || last - first + 1 > 10_000) {
      setError("Enter a 1-based, inclusive interval containing 20 to 10,000 bases. For an exact spacer locus, enter its 20-base interval.");
      return;
    }
    if (!chromosome.trim()) {
      setError("Enter a GRCh38 chromosome, for example 1 or chr1.");
      return;
    }
    const current = request.current;
    setBusy(true);
    try {
      const document = await api<ResolverDocument>("/resolve-guide", {
        method: "POST",
        body: JSON.stringify({ spacer: spacer.trim().toUpperCase(), chromosome: chromosome.trim(),
          start: first - 1, end: last, assembly: "GRCh38" }),
      });
      if (current !== request.current) return;
      if (!document.scope?.complete || !Array.isArray(document.matches)) {
        throw new Error("The resolver did not return a complete interval search. Please retry.");
      }
      setResult(document);
    } catch (failure) {
      if (current === request.current) setError(failure instanceof Error ? failure.message : "The spacer could not be resolved.");
    } finally {
      if (current === request.current) setBusy(false);
    }
  }

  const chosen = result && selected !== null ? result.matches[selected] : null;
  const visible = result?.matches.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE) || [];

  return (
    <details className="guide-resolver">
      <summary>Have a 20-nt spacer? Find its reference PAM</summary>
      <div className="guide-resolver-body">
        <p>Supply a GRCh38 interval or the exact 20-base spacer locus. Both strands are searched for an exact spacer followed by a reference NGG PAM.</p>
        {!available && <p role="status" className="guide-resolver-unavailable">The local reference resolver is unavailable. You can still paste a complete 23-nt sequence in the guide input.</p>}
        <fieldset disabled={!available} aria-describedby={`${id}-coordinates`} onKeyDown={(event) => {
          if (event.key === "Enter" && event.target instanceof HTMLInputElement && event.target.type !== "radio") {
            event.preventDefault();
            if (!busy) void resolve();
          }
        }}>
          <legend className="sr-only">Resolve a spacer in GRCh38</legend>
          <label htmlFor={`${id}-spacer`}>Spacer · 20 DNA bases
            <input id={`${id}-spacer`} value={spacer} spellCheck={false} autoComplete="off" autoCapitalize="characters"
              maxLength={100} placeholder="20 bases, without PAM" className="guide-resolver-sequence"
              onChange={(event) => { invalidate(); setSpacer(event.target.value); }} />
          </label>
          <div className="guide-resolver-coordinates">
            <label htmlFor={`${id}-chromosome`}>Chromosome
              <input id={`${id}-chromosome`} value={chromosome} autoComplete="off" maxLength={200} placeholder="e.g. chr1"
                onChange={(event) => { invalidate(); setChromosome(event.target.value); }} />
            </label>
            <label htmlFor={`${id}-start`}>Start · 1-based
              <input id={`${id}-start`} value={start} inputMode="numeric" autoComplete="off" maxLength={12} placeholder="First base"
                onChange={(event) => { invalidate(); setStart(event.target.value); }} />
            </label>
            <label htmlFor={`${id}-end`}>End · inclusive
              <input id={`${id}-end`} value={end} inputMode="numeric" autoComplete="off" maxLength={12} placeholder="Last base"
                onChange={(event) => { invalidate(); setEnd(event.target.value); }} />
            </label>
          </div>
          <p id={`${id}-coordinates`} className="guide-resolver-note">20–10,000 bases. The complete spacer must be inside this interval; its PAM may extend by 3 bases. Coordinates always refer to the forward reference, including for minus-strand matches.</p>
          <button type="button" className="guide-resolver-button" disabled={busy} onClick={() => { void resolve(); }}>
            {busy ? "Finding reference matches…" : "Find spacer and PAM"}
          </button>
        </fieldset>
        {error && <p role="alert" className="guide-resolver-error">{error}</p>}
        {result && (
          <div className="guide-resolver-results">
            <p role="status">{result.matches.length === 0
              ? "No exact spacer with an unambiguous NGG PAM was found in this interval. Check the locus, assembly and spacer."
              : `${result.matches.length.toLocaleString()} reference ${result.matches.length === 1 ? "match" : "matches"} found. Choose a site to use its observed PAM.`}</p>
            {result.matches.length > 0 && <>
              <div className="guide-resolver-table" role="region" aria-label="Reference spacer matches" tabIndex={0}>
                <table>
                  <caption>Full 23-base sites, including PAM · GRCh38 · 1-based inclusive display</caption>
                  <thead><tr><th scope="col">Choose</th><th scope="col">Reference locus</th><th scope="col">Strand</th><th scope="col">Spacer + PAM · 5′→3′</th></tr></thead>
                  <tbody>{visible.map((match, index) => {
                    const absolute = page * PAGE_SIZE + index;
                    const label = `${match.chromosome}:${(match.start + 1).toLocaleString()}–${match.end.toLocaleString()} (${match.strand})`;
                    return <tr key={`${match.chromosome}-${match.start}-${match.strand}`}>
                      <td><input type="radio" name={`${id}-match`} aria-label={`Choose ${label}`} checked={selected === absolute}
                        onChange={() => { setSelected(absolute); setApplied(false); }} /></td>
                      <td>{match.chromosome}:{(match.start + 1).toLocaleString()}–{match.end.toLocaleString()}</td>
                      <td>{match.strand}</td>
                      <td><code>{match.target23.slice(0, 20)}<strong>{match.target23.slice(20)}</strong></code></td>
                    </tr>;
                  })}</tbody>
                </table>
              </div>
              {result.matches.length > PAGE_SIZE && <div className="guide-resolver-pagination">
                <button type="button" className="guide-resolver-button" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous matches</button>
                <span>{page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, result.matches.length)} of {result.matches.length.toLocaleString()}</span>
                <button type="button" className="guide-resolver-button" disabled={(page + 1) * PAGE_SIZE >= result.matches.length} onClick={() => setPage(page + 1)}>Next matches</button>
              </div>}
              {chosen && <p>Selected: {chosen.chromosome}:{(chosen.start + 1).toLocaleString()}–{chosen.end.toLocaleString()} ({chosen.strand}), PAM <code>{chosen.pam}</code>.</p>}
              <button type="button" className="guide-resolver-button" disabled={!chosen || !available} onClick={() => {
                if (chosen && available) { onResolved(chosen.target23, chosen); setApplied(true); }
              }}>Use selected 23-nt guide</button>
              {applied && <p role="status">The selected spacer and reference PAM have been added to the guide input.</p>}
            </>}
            <p className="guide-resolver-note">Search scope: {result.scope.chromosome}:{(result.scope.start + 1).toLocaleString()}–{result.scope.end.toLocaleString()} only. Matches elsewhere and individual genetic variants are not assessed.</p>
          </div>
        )}
      </div>
    </details>
  );
}
