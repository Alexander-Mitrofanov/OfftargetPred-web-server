import { useCallback, useEffect, useId, useRef, useState } from "react";

export interface AnalysisActions {
  hasChanges: boolean;
  save: () => Promise<boolean>;
}

/** Each independently retained workspace has its own replacement boundary. */
export function useAnalysisReplacement() {
  const actions = useRef<AnalysisActions | null>(null);
  const [pending, setPending] = useState<(() => void | Promise<void>) | null>(null);
  const request = useCallback((action: () => void | Promise<void>) => {
    if (actions.current?.hasChanges) setPending(() => action);
    else void action();
  }, []);
  return { actions, request, pending, setPending };
}

export function AnalysisReplacement({ controller }: { controller: ReturnType<typeof useAnalysisReplacement> }) {
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const { pending, setPending, actions } = controller;
  useEffect(() => {
    if (pending) { setError(""); dialog.current?.showModal(); }
    else dialog.current?.close();
  }, [pending]);
  async function proceed(save: boolean) {
    if (!pending || busy) return;
    setBusy(true); setError("");
    try {
      if (save && !(await actions.current?.save())) {
        setError("The download could not be prepared. Keep this analysis and try Save analysis again.");
        return;
      }
      const action = pending;
      setPending(null);
      await action();
    } finally { setBusy(false); }
  }
  return <dialog ref={dialog} className="analysis-replacement" aria-labelledby={id} onCancel={event => {
    event.preventDefault(); if (!busy) setPending(null);
  }}>
    <h2 id={id}>Keep your analysis changes</h2>
    <p>Your current selection, settings or observations have changed since the last prepared download. Save them before replacing this analysis.</p>
    <p className="field-hint">Save and continue prepares a local ZIP. Check your browser’s downloads to confirm the file was saved.</p>
    {error && <p role="alert">{error}</p>}
    <div className="analysis-replacement-actions">
      <button type="button" className="button" disabled={busy} onClick={() => void proceed(true)}>{busy ? "Preparing…" : "Save and continue"}</button>
      <button type="button" className="button secondary" disabled={busy} onClick={() => void proceed(false)}>Discard changes and continue</button>
      <button type="button" className="text-button" disabled={busy} onClick={() => setPending(null)}>Keep current analysis</button>
    </div>
  </dialog>;
}
