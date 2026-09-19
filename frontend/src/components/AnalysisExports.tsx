import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { AnalysisDocument, ResultRow } from "../api.ts";
import citation from "../../../CITATION.cff?raw";
import license from "../../../LICENSE?raw";
import notices from "../../../THIRD_PARTY_NOTICES.md?raw";
import {
  createAnalysisPackage,
  resultsCsvBlob,
} from "../features/analysisExports.ts";
import type { ExportJobSummary } from "../features/analysisExports.ts";
import { buildBed } from "../features/genomeLinks.ts";
import type { BedExport } from "../features/genomeLinks.ts";
import type { EvidenceState } from "../features/assayEvidence.ts";
import "./AnalysisExports.css";

export interface AnalysisExportsProps {
  document: AnalysisDocument;
  filteredRows: ResultRow[];
  selectedRows: ResultRow[];
  filters: unknown;
  selectionNotes?: Record<string, string[]>;
  experimentalEvidence?: EvidenceState | null;
  job?: ExportJobSummary;
}

function skipSummary(bed: BedExport) {
  const reasons = new Map<string, number>();
  for (const row of bed.skipped)
    reasons.set(row.reason, (reasons.get(row.reason) ?? 0) + 1);
  return [...reasons].map(([reason, count]) => ({ reason, count }));
}

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob),
    link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Keep the URL alive while the browser starts the download (including Firefox).
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function AnalysisExports({
  document,
  filteredRows,
  selectedRows,
  filters,
  selectionNotes,
  experimentalEvidence,
  job,
}: AnalysisExportsProps) {
  const id = useId(),
    abort = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState("");
  const fullBed = useMemo(() => buildBed(document.rows), [document.rows]);
  const selectedBed = useMemo(() => buildBed(selectedRows), [selectedRows]);
  useEffect(() => () => abort.current?.abort(), []);

  async function download(kind: "package" | "filtered" | "selected") {
    if (busy) return;
    const controller = new AbortController();
    abort.current = controller;
    setBusy(true);
    setError("");
    setMessage("Preparing the local download…");
    try {
      const stamp = new Date().toISOString().replaceAll(":", "-");
      const blob =
        kind === "package"
          ? await createAnalysisPackage(
              {
                document,
                filteredRows,
                selectedRows,
                filters,
                selectionNotes,
                experimentalEvidence,
                job,
                citation,
                license,
                notices,
              },
              { signal: controller.signal, onProgress: setMessage },
            )
          : await resultsCsvBlob(
              kind === "selected" ? selectedRows : filteredRows,
              {
                signal: controller.signal,
                selectionNotes:
                  kind === "selected" ? selectionNotes : undefined,
              },
            );
      saveBlob(
        blob,
        `offtargetpred-${kind}-${stamp}.${kind === "package" ? "zip" : "csv"}`,
      );
      setMessage(
        `Download prepared (${(blob.size / 1024 / 1024).toFixed(2)} MiB). Check your browser’s downloads.`,
      );
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError")
        setMessage("Export cancelled. Your analysis is unchanged.");
      else {
        setError(
          caught instanceof Error
            ? caught.message
            : "The browser could not prepare this download. Try a smaller filtered CSV.",
        );
        setMessage("");
      }
    } finally {
      setBusy(false);
      abort.current = null;
    }
  }

  return (
    <details className="analysis-exports">
      <summary>Download an analysis package or shortlist</summary>
      <section aria-labelledby={id} aria-busy={busy}>
        <h3 id={id}>Keep a reproducible copy</h3>
        <p>
          <strong>{document.rows.length.toLocaleString()}</strong> full results
          · <strong>{filteredRows.length.toLocaleString()}</strong> filtered
          rows · <strong>{selectedRows.length.toLocaleString()}</strong>{" "}
          explicitly selected rows.
        </p>
        <p>
          The ZIP contains full JSON and CSV, the filtered CSV, selected
          shortlist CSV, BED files, recorded settings and provenance, citation,
          licence and a readable HTML report. Scores retain their full stored
          precision. The report previews at most 200 filtered rows; the data
          files contain every row in each view.
        </p>
        {!selectedRows.length && (
          <p className="analysis-exports-note">
            No candidates selected. The package will contain an empty shortlist
            with column headings. Select table rows to build a shortlist.
          </p>
        )}
        {experimentalEvidence && <p className="analysis-exports-note">The package includes experimental-evidence.json with all imported observations, including ambiguous, unmatched and duplicate observations, and their result indices. This browser-local evidence is separate from predictions and is absent from the server’s CSV/JSON downloads.</p>}
        <div className="analysis-exports-bed">
          <h4>BED coordinate availability</h4>
          <p>
            Full analysis: {fullBed.exported.toLocaleString()} exportable,{" "}
            {fullBed.skipped.length.toLocaleString()} skipped. Selected
            shortlist: {selectedBed.exported.toLocaleString()} exportable,{" "}
            {selectedBed.skipped.length.toLocaleString()} skipped.
          </p>
          {fullBed.skipped.length > 0 && (
            <ul>
              {skipSummary(fullBed).map(({ reason, count }) => (
                <li key={reason}>
                  {count.toLocaleString()} full-result rows: {reason}
                </li>
              ))}
            </ul>
          )}
          {selectedBed.skipped.length > 0 && (
            <ul>
              {skipSummary(selectedBed).map(({ reason, count }) => (
                <li key={reason}>
                  {count.toLocaleString()} selected rows: {reason}
                </li>
              ))}
            </ul>
          )}
          <p>
            Every skipped row and reason is recorded in the ZIP. Those rows
            remain in JSON and CSV. BED checks declared GRCh38 contigs, bounds,
            strand and 0-based half-open 23-nt intervals including the PAM, with
            neutral score 0. It does not verify imported sequences against the reference.
          </p>
        </div>
        <p className="analysis-exports-note">
          Downloads are assembled in your browser and contain your sequences and
          analysis data. Private access credentials and private job links are
          excluded. Store and share these files deliberately.
        </p>
        <div className="analysis-exports-actions">
          <button
            type="button"
            onClick={() => void download("package")}
            disabled={busy}
          >
            Download full analysis ZIP
          </button>
          <button
            type="button"
            onClick={() => void download("filtered")}
            disabled={busy}
          >
            Download filtered CSV ({filteredRows.length.toLocaleString()})
          </button>
          <button
            type="button"
            onClick={() => void download("selected")}
            disabled={busy || selectedRows.length === 0}
          >
            Download selected CSV ({selectedRows.length.toLocaleString()})
          </button>
          {busy && (
            <button type="button" onClick={() => abort.current?.abort()}>
              Cancel export
            </button>
          )}
        </div>
        <p className="analysis-exports-status" role="status" aria-live="polite">
          {message}
        </p>
        {error && (
          <p className="analysis-exports-error" role="alert">
            {error}
          </p>
        )}
      </section>
    </details>
  );
}
