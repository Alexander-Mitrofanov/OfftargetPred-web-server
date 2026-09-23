import { useEffect, useId, useRef, useState } from "react";
import type { RefObject } from "react";
import type { AnalysisDocument } from "../api";
import { resultsCsvBlob } from "../features/analysisExports";
import "./AnalysisExports.css";

export interface AnalysisExportActions { save: () => Promise<boolean> }

export interface AnalysisExportsProps {
  actionsRef?: RefObject<AnalysisExportActions | null>;
  document: AnalysisDocument;
}

export function AnalysisExports({ actionsRef, document: analysis }: AnalysisExportsProps) {
  const id = useId();
  const abort = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  useEffect(() => () => abort.current?.abort(), []);

  async function download() {
    if (abort.current) return false;
    const controller = new AbortController();
    abort.current = controller;
    setBusy(true);
    setError("");
    setMessage("Preparing results CSV…");
    try {
      // Older jobs and saved files may still annotate the variable NGG base.
      const rows = analysis.rows.map(row => ({
        ...row,
        mismatch_positions: row.mismatch_positions?.filter(position => position !== 21),
        pam_mismatches: row.pam_mismatches === undefined ? undefined :
          Array.from(row.target.slice(21)).filter((base, index) => base !== row.off_target[index + 21] && base !== "N" && row.off_target[index + 21] !== "N").length,
      }));
      const blob = await resultsCsvBlob(rows, { signal: controller.signal });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "crispert-results.csv";
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setMessage("Results CSV prepared. Check your browser’s downloads.");
      return true;
    } catch (caught) {
      if (!controller.signal.aborted) {
        setError(caught instanceof Error ? caught.message : "The results CSV could not be prepared. Try again.");
        setMessage("");
      }
      return false;
    } finally {
      setBusy(false);
      abort.current = null;
    }
  }

  useEffect(() => {
    if (actionsRef) actionsRef.current = { save: download };
    return () => { if (actionsRef) actionsRef.current = null; };
  });

  return <section className="analysis-exports results-download" aria-labelledby={id} aria-busy={busy}>
    <h3 id={id}>Download results</h3>
    <p>Download all {analysis.rows.length.toLocaleString()} candidate results as a CSV file, including rows outside the current search or page.</p>
    <button type="button" className="button" disabled={busy} onClick={() => void download()}>{busy ? "Preparing CSV…" : "Download results CSV"}</button>
    {message && <p role="status">{message}</p>}
    {error && <p className="analysis-exports-error" role="alert">{error}</p>}
  </section>;
}
