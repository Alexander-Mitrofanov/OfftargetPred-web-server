import { validateInput } from "../input";
import type { Mode } from "../api";
import "./InputGuide.css";

export interface InputGuideProps {
  sequence: string;
  mode?: Mode;
}

/** Attach below a single guide input; the counter does not silently rewrite it. */
export function InputGuide({ sequence, mode = "pairs" }: InputGuideProps) {
  const normalized = sequence.trim().toUpperCase();
  const validation =
    mode === "genome"
      ? validateInput("genome", "single", "", "", "", normalized, null)
      : validateInput(
          "pairs",
          "single",
          normalized,
          "A".repeat(20) + "AGG",
          "",
          "",
          null,
        );
  return (
    <div className="input-guide" aria-live="polite" aria-atomic="true">
      <p>
        <strong>{normalized.length} / 23 characters</strong> · 20-nt spacer +
        its actual 3-nt PAM · DNA written 5′→3′
      </p>
      {normalized.length === 0 ? (
        <p>Paste the guide-associated target sequence, including its PAM.</p>
      ) : normalized.length === 20 && /^[ACGTN]+$/.test(normalized) ? (
        <p className="input-guide-action">
          This looks like a spacer without its PAM. Add the three bases observed
          at its target locus. Do not append a
          guessed PAM.
        </p>
      ) : (
        <>
          {validation.errors.map((message) => (
            <p className="input-guide-action" key={message}>
              {message}
            </p>
          ))}
          {validation.warnings.map((message) => (
            <p key={message}>{message}</p>
          ))}
          {validation.errors.length === 0 && (
            <p>
              Sequence format is valid. This check does not verify the target
              locus.
            </p>
          )}
        </>
      )}
    </div>
  );
}
