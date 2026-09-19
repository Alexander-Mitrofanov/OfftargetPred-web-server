import { useId, useMemo, useState } from "react";
import type { ResultRow, Submission } from "../api";
import { inspectSensitivity, prepareSensitivity, sensitivityCell, sensitivityEligibility, sensitivityScore, SENSITIVITY_BASES } from "../features/sensitivity";
import type { SensitivityModel } from "../features/sensitivity";
import "./SequenceSensitivity.css";

export interface SequenceSensitivityProps {
  rows: ResultRow[];
  selectedRows: ResultRow[];
  onPrepare?: (submission: Submission) => void;
}
const number = (value: number | null) => value === null ? "Unavailable" : value.toPrecision(5);
const delta = (value: number | null) => value === null ? "Unavailable" : `${value > 0 ? "+" : ""}${value.toPrecision(5)}`;

export function SequenceSensitivity({ rows, selectedRows, onPrepare }: SequenceSensitivityProps) {
  const id = useId(), [open, setOpen] = useState(false), [model, setModel] = useState<SensitivityModel>("k1"), [message, setMessage] = useState("");
  const inspection = useMemo(() => inspectSensitivity(open ? rows : []), [open, rows]);
  const source = selectedRows.length === 1 ? selectedRows[0] : null;
  const reason = source ? sensitivityEligibility(source) : "Select exactly one candidate in the results table to prepare a sensitivity panel.";
  const panel = inspection.status === "valid" ? inspection.panel : null;
  const chosenModel = panel?.models.includes(model) ? model : panel?.models[0] ?? "k1";
  function prepare() {
    if (!source || reason || !onPrepare) return;
    try { onPrepare(prepareSensitivity(source)); setMessage("Prepared 61 pairs in the prediction form. Review the input and selected models, then submit when ready."); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Could not prepare the sensitivity panel."); }
  }
  return <details className="sequence-sensitivity" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>Explore single-base sequence sensitivity</summary>
    {open && <section aria-labelledby={id}>
      <h3 id={id}>How does one candidate base change the model output?</h3>
      <p>Keep the guide and candidate PAM fixed. Rescore the original candidate and each of the 60 possible single-base substitutions at candidate protospacer positions 1–20. Each model is shown separately.</p>
      <p className="sensitivity-scope">This is a counterfactual model response. A score change does not establish molecular causality, a change in editing rate, or the existence of a sequence in a genome. These synthetic pairs have no genomic annotations.</p>
      {panel && <div className="sensitivity-result">
        <h4>Complete 61-pair panel</h4>
        <p>All sequence substitutions and their labels passed structural checks. This check does not authenticate externally edited scores.</p>
        <dl><dt>Fixed guide (20 nt + PAM)</dt><dd><code>{panel.target}</code></dd><dt>Original candidate (20 nt + PAM)</dt><dd><code>{panel.originalCandidate}</code></dd></dl>
        <div className="sensitivity-model"><label htmlFor={`${id}-model`}>Model</label><select id={`${id}-model`} value={chosenModel} disabled={!panel.models.length} onChange={event => setModel(event.target.value as SensitivityModel)}>{panel.models.map(value => <option key={value} value={value}>CRISPert {value}</option>)}</select></div>
        {!panel.models.length && <p>No finite CRISPert scores are available in this panel. The sequence structure is complete, but score changes cannot be displayed.</p>}
        <p>Original score: <strong>{number(sensitivityScore(panel.baseline, chosenModel))}</strong>. Each cell shows the substitution score minus this original score. “Original” cells reuse the same baseline. Missing scores remain unavailable.</p>
        <p>Positions run 5′ to 3′ in the submitted candidate; position 20 is adjacent to its unchanged PAM. Expand a cell for full values. Scroll the table sideways to see all four candidate bases.</p>
        <div className="sensitivity-table" role="region" tabIndex={0} aria-label="Single-base score changes; scroll horizontally">
          <table><caption>CRISPert {chosenModel}: score changes</caption>
            <thead><tr><th scope="col">Position<br />Original base</th>{SENSITIVITY_BASES.map(base => <th scope="col" key={base}>Candidate {base}</th>)}</tr></thead>
            <tbody>{Array.from({ length: 20 }, (_, index) => index + 1).map(position => <tr key={position}><th scope="row">{position} · {panel.originalCandidate[position - 1]}</th>{SENSITIVITY_BASES.map(base => {
              const cell = sensitivityCell(panel, position, base, chosenModel);
              return <td key={base} className={cell.original ? "sensitivity-original" : undefined}><details><summary aria-label={`Position ${position}, candidate ${base}: ${cell.original ? "original, " : ""}score change ${delta(cell.delta)}`}>{cell.original && <small>Original</small>}{delta(cell.delta)}</summary><span>Score: {cell.score === null ? "Unavailable" : String(cell.score)}<br />Original: {cell.baseline === null ? "Unavailable" : String(cell.baseline)}<br />Change: {cell.delta === null ? "Unavailable" : String(cell.delta)}</span></details></td>;
            })}</tr>)}</tbody>
          </table>
        </div>
      </div>}
      {inspection.status === "invalid" && <p role="alert">This result cannot be displayed as a sensitivity matrix: {inspection.reason}</p>}
      <h4>Prepare a new panel</h4>
      {source && <p>Selected candidate <strong>{source.id}</strong>, row {source.row_index ?? "not recorded"}: <code>{source.off_target}</code>.</p>}
      {reason && <p>{reason}</p>}
      <p>Download this analysis or keep its private recovery link before starting a new job. Preparing the panel fills the input form; review the 61 pairs and model choices before submitting. Browser-only selections and imported evidence are not restored by the recovery link.</p>
      <button type="button" className="button secondary compact" onClick={prepare} disabled={!source || !!reason || !onPrepare}>Prepare 61-pair sensitivity input</button>
      {!onPrepare && <p>Preparing a new job is unavailable in this view.</p>}
      <p role="status" aria-live="polite">{message}</p>
    </section>}
  </details>;
}
