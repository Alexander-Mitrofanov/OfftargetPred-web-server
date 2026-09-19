import { useId, useState } from "react";
import { previewToolImport } from "../features/toolImports.ts";
import type { ToolImportFormat, ToolImportOptions, ToolImportPreview } from "../features/toolImports.ts";
import "./ToolImport.css";

export interface ToolImportProps {
  onApply: (csv: string, summary: ToolImportPreview) => void;
  onUseMapper?: (rawText: string) => void;
}

export function ToolImport({ onApply, onUseMapper }: ToolImportProps) {
  const id = useId();
  const [text, setText] = useState("");
  const [options, setOptions] = useState<ToolImportOptions>({ format: "cas-offinder-2.4.1", assembly: "" });
  const [preview, setPreview] = useState<ToolImportPreview | null>(null);
  const [fileError, setFileError] = useState("");
  const [applied, setApplied] = useState(false);
  const changed = () => { setPreview(null); setApplied(false); setFileError(""); };
  const changeOption = (patch: Partial<ToolImportOptions>) => { setOptions((current) => ({ ...current, ...patch })); changed(); };
  const chopchop = options.format === "chopchop-compatible";
  return <details className="tool-import" onKeyDown={event => {
    if (event.key === "Enter" && event.target instanceof HTMLInputElement && !["checkbox", "file"].includes(event.target.type)) {
      event.preventDefault();
      setPreview(previewToolImport(text, options)); setApplied(false);
    }
  }}>
    <summary>Import candidates from another tool</summary>
    <p>Convert a supported export into sequence pairs. Preview runs in your browser. Applying fills the input table; scoring starts only when you submit the job.</p>
    <label htmlFor={`${id}-format`}>Source format</label>
    <select id={`${id}-format`} value={options.format} onChange={(event) => changeOption({ format: event.target.value as ToolImportFormat })}>
      <option value="cas-offinder-2.4.1">Cas-OFFinder 2.4.1 — six-column TSV</option>
      <option value="crispor-offtargets">CRISPOR — bulk off-target TSV/CSV</option>
      <option value="chopchop-compatible">CHOPCHOP — enriched candidate table</option>
    </select>
    {options.format === "cas-offinder-2.4.1" && <p className="tool-import-note">Headerless columns: query, chromosome, 0-based start, candidate, strand, mismatches. If the query ends in NNN, provide the actual guide and PAM below. Nine-column bulge output is unsupported.</p>}
    {options.format === "crispor-offtargets" && <p className="tool-import-note">Required headers: guideId, guideSeq, offtargetSeq, chrom, start, end, strand. This adapter converts CRISPOR's 1-based inclusive bulk-export coordinates.</p>}
    {chopchop && <p className="tool-import-note">Use individual candidate rows with Target sequence, Genomic location and Strand columns. Native off-target exports omit candidate strand; add verified strand information first. Guide-ranking tables containing MM0–MM3 counts cannot supply candidate sequences.</p>}
    <label htmlFor={`${id}-file`}>Export file</label>
    <input id={`${id}-file`} type="file" accept=".csv,.tsv,.txt,.offtargets" onChange={async (event) => {
      const file = event.target.files?.[0];
      changed();
      if (!file) return;
      if (file.size > 5 * 1024 * 1024) { setFileError("Choose a file smaller than 5 MiB."); return; }
      try { setText(await file.text()); } catch { setFileError("The file could not be read. Paste its plain-text contents instead."); }
    }} />
    <label htmlFor={`${id}-text`}>Or paste the export</label>
    <textarea id={`${id}-text`} rows={5} value={text} spellCheck={false} onChange={(event) => { setText(event.target.value); changed(); }} />
    <div className="tool-import-fields">
      <label htmlFor={`${id}-guide`}>Actual 23-nt guide + PAM, if missing from the export
        <input id={`${id}-guide`} value={options.guide23 ?? ""} spellCheck={false} placeholder="20-nt spacer + actual 3-nt PAM" onChange={(event) => changeOption({ guide23: event.target.value })} />
      </label>
      <label htmlFor={`${id}-guide-id`}>Guide identifier, optional
        <input id={`${id}-guide-id`} maxLength={200} value={options.guideId ?? ""} onChange={(event) => changeOption({ guideId: event.target.value })} />
      </label>
    </div>
    <p className="tool-import-note">The fallback guide applies only to rows with that same spacer. Its PAM must be measured or reference-resolved. NNN and NGG are motifs, not actual PAM sequences.</p>
    {chopchop && <div className="tool-import-fields">
      <label htmlFor={`${id}-coords`}>Coordinate convention
        <select id={`${id}-coords`} value={options.coordinateSystem ?? ""} onChange={(event) => changeOption({ coordinateSystem: event.target.value as ToolImportOptions["coordinateSystem"] })}>
          <option value="">Choose explicitly</option><option value="1-based inclusive">1-based inclusive</option><option value="0-based half-open">0-based half-open</option>
        </select>
      </label>
      <label htmlFor={`${id}-orientation`}>Candidate sequence orientation
        <select id={`${id}-orientation`} value={options.candidateOrientation ?? ""} onChange={(event) => changeOption({ candidateOrientation: event.target.value as ToolImportOptions["candidateOrientation"] })}>
          <option value="">Choose explicitly</option><option value="guide-oriented">Guide-oriented, 5′ spacer → PAM 3′</option><option value="forward-reference">Forward reference strand</option>
        </select>
      </label>
    </div>}
    <label className="tool-import-confirm"><input type="checkbox" checked={options.assembly === "GRCh38"} onChange={(event) => changeOption({ assembly: event.target.checked ? "GRCh38" : "" })} />These candidate loci use the human GRCh38 assembly.</label>
    <div className="tool-import-actions">
      <button type="button" className="secondary" onClick={() => { setPreview(previewToolImport(text, options)); setApplied(false); }}>Preview import</button>
      {onUseMapper && <button type="button" className="secondary" onClick={() => onUseMapper(text)}>Use generic column mapper</button>}
      <a href="https://github.com/Alexander-Mitrofanov/OfftargetPred-web-server/blob/main/docs/import-formats.md" target="_blank" rel="noreferrer">Supported formats and examples</a>
    </div>
    {fileError && <p role="alert">{fileError}</p>}
    {preview && <section aria-label="Tool import preview" aria-live="polite">
      <p><strong>{preview.inputRows.toLocaleString()} source rows; {preview.rows.length.toLocaleString()} valid pairs; {new Set(preview.issues.flatMap((issue) => issue.row === null ? [] : [issue.row])).size.toLocaleString()} rows with errors.</strong> No rows are silently dropped.</p>
      {preview.issues.length > 0 && <div className="tool-import-errors" role="alert"><p>Resolve every error before applying the import.</p><ul>{preview.issues.slice(0, 12).map((issue, index) => <li key={index}>{issue.row !== null ? `Data row ${issue.row}: ` : ""}{issue.message}</li>)}</ul>{preview.issues.length > 12 && <p>{preview.issues.length - 12} additional errors. Correct the format and preview again.</p>}</div>}
      <ul>{preview.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
      {preview.rows.length > 0 && <div className="tool-import-table" tabIndex={0} role="region" aria-label="First five imported pairs, scroll horizontally if needed"><table><caption>First {Math.min(5, preview.rows.length)} valid rows, converted to 0-based half-open coordinates</caption><thead><tr><th>Source ID</th><th>Guide + PAM</th><th>Candidate + PAM</th><th>Locus</th></tr></thead><tbody>{preview.rows.slice(0, 5).map((row) => <tr key={row.id}><td>{row.source_id}</td><td><code>{row.target}</code></td><td><code>{row.off_target}</code></td><td>{row.chromosome}:{row.start}–{row.end} ({row.strand})</td></tr>)}</tbody></table></div>}
      <button type="button" disabled={!preview.canApply} onClick={() => { if (preview.canApply) { onApply(preview.csv, preview); setApplied(true); } }}>Apply {preview.rows.length.toLocaleString()} normalized pairs</button>
      {applied && <p role="status">The normalized pairs are in the input table. Review the input and submit when ready.</p>}
    </section>}
  </details>;
}
