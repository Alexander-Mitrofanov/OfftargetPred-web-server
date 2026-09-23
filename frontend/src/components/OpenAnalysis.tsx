import { useEffect, useRef, useState } from "react";
import { importAnalysisPackage, MAX_ANALYSIS_IMPORT_BYTES, MAX_ANALYSIS_JSON_BYTES } from "../features/analysisImports";
import type { ImportedAnalysis } from "../features/analysisImports";

export function OpenAnalysis({ onOpen, active = true }: { onOpen: (analysis: ImportedAnalysis, filename: string) => void; active?: boolean }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [progress, setProgress] = useState("");
  const generation = useRef(0);
  const abort = useRef<AbortController | null>(null);
  const cancel = () => { generation.current++; abort.current?.abort(); setBusy(false); setProgress(""); };
  useEffect(() => { if (!active) cancel(); }, [active]);
  useEffect(() => () => { generation.current++; abort.current?.abort(); }, []);
  return <section className="open-analysis" aria-label="Open a saved analysis" aria-busy={busy}>
    <label>Open saved analysis<input type="file" accept=".zip,application/zip" disabled={busy} onChange={async event => {
      const file = event.target.files?.[0]; event.target.value = "";
      if (!file) return;
      abort.current?.abort();
      const controller = new AbortController(); abort.current = controller;
      const ticket = ++generation.current;
      setBusy(true); setError(""); setProgress("Checking the saved analysis…");
      try {
        const imported = await importAnalysisPackage(file, { signal: controller.signal, onProgress: setProgress });
        if (ticket === generation.current) onOpen(imported, file.name);
      } catch (failure) {
        if (ticket === generation.current) setError(failure instanceof Error ? failure.message : "This saved analysis could not be opened.");
      } finally { if (ticket === generation.current) setBusy(false); }
    }} /></label>
    <p className="field-hint">Choose a complete OfftargetPred ZIP to continue locally. Opening the file uploads nothing and creates no prediction job. Limit: {MAX_ANALYSIS_IMPORT_BYTES / 1024 / 1024} MiB per ZIP, {MAX_ANALYSIS_JSON_BYTES / 1024 / 1024} MiB per JSON file and 60,000 result rows.</p>
    {busy && <><p role="status">{progress}</p><button type="button" className="text-button" onClick={cancel}>Cancel opening</button></>}
    {error && <p className="notice error" role="alert">{error} Your current analysis is unchanged.</p>}
  </section>;
}
