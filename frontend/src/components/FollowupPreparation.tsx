import { useEffect, useId, useRef, useState } from "react";
import { api } from "../api";
import type { ResultRow } from "../api";
import { contextMetadata, contextRequest, validateContextDocument } from "../features/followup";
import type { ContextDocument } from "../features/followup";
import "./FollowupPreparation.css";

function download(text: string, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function FollowupPreparation({ selectedRows, available = false }: { selectedRows: ResultRow[]; available?: boolean }) {
  const id = useId();
  const [flank, setFlank] = useState("250");
  const [result, setResult] = useState<ContextDocument | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const requestNumber = useRef(0);
  // Compare the selected data rather than array identity across parent renders.
  const selectionKey = selectedRows.length <= 20 ? JSON.stringify(selectedRows.map((row) => [row.id, row.row_index,
    row.off_target, row.chromosome, row.start, row.end, row.strand, row.assembly, row.coordinate_system])) : String(selectedRows.length);
  useEffect(() => {
    requestNumber.current += 1;
    setResult(null); setBusy(false); setError("");
  }, [selectionKey, flank, available]);
  useEffect(() => () => { requestNumber.current += 1; }, []);

  async function prepare() {
    setError(""); setResult(null);
    if (!available) return;
    const current = ++requestNumber.current;
    try {
      const request = contextRequest(selectedRows, flank);
      setBusy(true);
      const response = await api<ContextDocument>("/reference-context", { method: "POST", body: JSON.stringify(request) });
      if (current === requestNumber.current) setResult(validateContextDocument(response, request));
    } catch (failure) {
      if (current === requestNumber.current) setError(failure instanceof Error ? failure.message : "Reference context could not be prepared.");
    } finally {
      if (current === requestNumber.current) setBusy(false);
    }
  }

  return <details className="followup-preparation">
    <summary>Prepare reference flanks for selected candidates</summary>
    <div className="followup-preparation-body">
      <p>Select up to 20 rows in the results table. Each candidate sequence is checked against GRCh38 before its flanks can be downloaded.</p>
      <p className="followup-preparation-note">These sequences support downstream assay planning. They are not validated primers or amplicons; genetic variants and primer specificity are not assessed.</p>
      {!available && <p role="status">Verified reference context is currently unavailable from the backend.</p>}
      <div className="followup-preparation-controls">
        <label htmlFor={`${id}-flank`}>Flank length per side · bases
          <input id={`${id}-flank`} value={flank} inputMode="numeric" maxLength={4} disabled={!available}
            onChange={(event) => setFlank(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); if (!busy) void prepare(); } }} />
        </label>
        <button type="button" className="button secondary" disabled={!available || busy || selectedRows.length < 1 || selectedRows.length > 20}
          onClick={() => { void prepare(); }}>{busy ? "Checking reference sequences…" : "Prepare selected reference flanks"}</button>
      </div>
      <p className="followup-preparation-note">{selectedRows.length.toLocaleString()} rows selected · 0–1,000 bases per side. Coordinates and strands must already be declared; sequence-only rows are skipped.</p>
      {selectedRows.length > 20 && <p role="status">Reduce the selection to 20 rows or fewer before preparing flanks.</p>}
      {error && <p role="alert" className="followup-preparation-error">{error}</p>}
      {result && <div className="followup-preparation-results">
        <p role="status">{result.summary.ready} reference-verified {result.summary.ready === 1 ? "sequence" : "sequences"} prepared; {result.summary.skipped} selected {result.summary.skipped === 1 ? "row" : "rows"} skipped.</p>
        <p className="followup-preparation-note">FASTA sequences always follow the forward reference, including minus-strand candidates. Headers and JSON use 0-based half-open coordinates; the table below displays 1-based inclusive loci. Save the JSON with the FASTA to retain sequence hashes, target offsets and skip reasons.</p>
        <div className="followup-preparation-downloads">
          <button type="button" className="button secondary" disabled={result.summary.ready === 0}
            onClick={() => download(result.fasta, "offtargetpred-reference-flanks.fasta", "text/plain;charset=utf-8")}>Download reference FASTA</button>
          <button type="button" className="button secondary"
            onClick={() => download(contextMetadata(result), "offtargetpred-reference-flanks.json", "application/json")}>Download flank metadata JSON</button>
        </div>
        <div className="followup-preparation-table" role="region" aria-label="Reference flank outcomes" tabIndex={0}>
          <table><caption>Every selected row is retained in the metadata</caption>
            <thead><tr><th scope="col">Candidate</th><th scope="col">Reference locus</th><th scope="col">Outcome</th></tr></thead>
            <tbody>{result.records.map((entry) => <tr key={entry.selection_index}>
              <th scope="row">{entry.candidate.id}</th>
              <td>{entry.context ? `${entry.candidate.chromosome}:${(entry.candidate.start! + 1).toLocaleString()}–${entry.candidate.end!.toLocaleString()} (${entry.candidate.strand})` : "—"}</td>
              <td>{entry.context ? <>{entry.context.left_bases} left + 23 candidate + {entry.context.right_bases} right bases
                {(entry.context.left_clipped || entry.context.right_clipped) && <span> · clipped at contig boundary</span>}
                {entry.context.ambiguous_bases > 0 && <span> · {entry.context.ambiguous_bases} ambiguous reference bases</span>}</> : entry.reason}</td>
            </tr>)}</tbody>
          </table>
        </div>
      </div>}
    </div>
  </details>;
}
