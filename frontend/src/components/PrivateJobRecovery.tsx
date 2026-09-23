import { useId, useMemo, useRef, useState } from "react";
import type { Credentials } from "../api";
import { copyRecoveryLink, privateJobLink } from "../features/jobRecovery";
import "./PrivateJobRecovery.css";

export function PrivateJobRecovery({ credentials, expiresAt }: { credentials: Credentials; expiresAt?: string }) {
  const id = useId();
  const input = useRef<HTMLTextAreaElement>(null);
  const [state, setState] = useState<"idle" | "copied" | "manual">("idle");
  const link = useMemo(() => privateJobLink(window.location.href, credentials), [credentials.id, credentials.token]);
  const expiry = expiresAt ? new Date(expiresAt) : null;
  const hasExpiry = expiry && !Number.isNaN(expiry.getTime());

  const select = () => { input.current?.focus(); input.current?.select(); };
  const copy = async () => {
    const copied = await copyRecoveryLink(link, navigator.clipboard);
    setState(copied ? "copied" : "manual");
    if (!copied) select();
  };

  return <section className="private-job-recovery" aria-labelledby={`${id}-title`}>
    <h3 id={`${id}-title`}>Return to this analysis</h3>
    <p id={`${id}-privacy`}>Anyone with this private link can view, download or delete this job until it expires. Keep it private.</p>
    <label htmlFor={`${id}-link`}>Private result link</label>
    <textarea id={`${id}-link`} ref={input} value={link} readOnly rows={3} spellCheck={false} autoComplete="off" aria-describedby={`${id}-privacy ${id}-copy-help`} />
    <div className="private-job-recovery-actions">
      <button type="button" className="button secondary" onClick={() => void copy()}>Copy private result link</button>
      <button type="button" className="text-button" onClick={select}>Select link for manual copy</button>
    </div>
    <p id={`${id}-copy-help`} role="status" aria-live="polite">{state === "copied" ? "Private link copied. Store it somewhere private." : state === "manual" ? "Automatic copy is unavailable. The link is selected: use your browser’s Copy command, Ctrl+C or Command+C." : "You can also select the link and copy it manually."}</p>
    <p>{hasExpiry ? <>Server results expire <time dateTime={expiry.toISOString()}>{expiry.toLocaleString()}</time>.</> : "Private server jobs expire after 24 hours."} Download your analysis before it expires or you delete the job.</p>
    <p className="private-job-recovery-local"><strong>This link restores server results.</strong> The candidate search and sorting choices are kept only in this page. Use Download results CSV to keep all results before the job expires.</p>
  </section>;
}
