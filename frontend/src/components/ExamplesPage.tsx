import { useEffect, useRef, useState } from "react";
import type { Submission } from "../api";
import { demonstrationInput, demonstrationLoader } from "../features/demonstrations";
import type { Demonstration, DemonstrationManifest, LoadedDemonstration } from "../features/demonstrations";
import { AnalysisWorkspace } from "./AnalysisWorkspace";
import "./ExamplesPage.css";

export interface ExamplesPageProps {
  onUseInput?: (submission: Submission) => void;
  referenceContextAvailable?: boolean;
}

const loader = demonstrationLoader(import.meta.env.BASE_URL);

function SearchScope({ scenario }: { scenario: Demonstration }) {
  return <dl className="example-scope">
    <div><dt>Reference</dt><dd>{String(scenario.settings.assembly ?? "Supplied pairs")}</dd></div>
    <div><dt>PAM</dt><dd>{String(scenario.settings.pam ?? "Recorded in the input")}</dd></div>
    <div><dt>Spacer mismatches</dt><dd>{String(scenario.settings.max_mismatches ?? "Not searched")}</dd></div>
    <div><dt>Models</dt><dd>{scenario.input.models.map((model) => `k=${model}`).join(", ")}</dd></div>
  </dl>;
}

export function ExamplesPage({ onUseInput, referenceContextAvailable }: ExamplesPageProps) {
  const [manifest, setManifest] = useState<DemonstrationManifest | null>(null);
  const [manifestError, setManifestError] = useState("");
  const [manifestRetry, setManifestRetry] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loadedState, setLoaded] = useState<{ id: string; value: LoadedDemonstration } | null>(null);
  const [resultError, setResultError] = useState("");
  const [resultRetry, setResultRetry] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const selected = manifest?.scenarios.find((scenario) => scenario.id === selectedId);
  const loaded = loadedState?.id === selectedId ? loadedState.value : null;

  useEffect(() => {
    let active = true;
    setManifestError("");
    loader.manifest().then((value) => { if (active) setManifest(value); })
      .catch((error) => { if (active) setManifestError(error instanceof Error ? error.message : "Examples could not be loaded. Please retry."); });
    return () => { active = false; };
  }, [manifestRetry]);

  useEffect(() => {
    let active = true;
    setLoaded(null); setResultError("");
    if (selected?.kind === "result") {
      loader.document(selected).then((value) => { if (active) setLoaded({ id: selected.id, value }); })
        .catch((error) => { if (active) setResultError(error instanceof Error ? error.message : "This example could not be loaded. Please retry."); });
    }
    return () => { active = false; };
  }, [selected, resultRetry]);

  useEffect(() => { if (selectedId) heading.current?.focus(); }, [selectedId]);

  return <section className="examples-page" aria-labelledby="examples-title">
    <header className="examples-intro">
      <p className="eyebrow">Learn with worked examples</p>
      <h1 id="examples-title">Explore before you run</h1>
      <p>Open a completed analysis and try the filters, model comparisons and downloads. Examples are stored with this website and work when the prediction server is unavailable.</p>
      <p className="field-hint">The sequences come from a public reference or a stated synthetic query. These examples explain the workflow; they do not measure experimental cleavage.</p>
    </header>
    {!manifest && !manifestError && <p role="status">Loading the example library…</p>}
    {manifestError && <div className="notice error" role="alert"><p>{manifestError}</p><button type="button" className="button secondary" onClick={() => setManifestRetry((value) => value + 1)}>Retry example library</button></div>}
    {manifest && <ul className="example-cards" aria-label="Worked examples">{manifest.scenarios.map((scenario) => <li key={scenario.id} className={selectedId === scenario.id ? "example-card is-selected" : "example-card"}>
      <span className="example-kind">{scenario.kind === "validation" ? "Input correction" : `${scenario.completed_job?.result_count ?? 0} candidates · completed search`}</span>
      <h2>{scenario.title}</h2><p>{scenario.summary}</p>
      <p className="example-learning"><strong>Try:</strong> {scenario.tasks[0]}</p>
      <button type="button" className="button secondary" aria-pressed={selectedId === scenario.id} aria-controls="example-detail" onClick={() => setSelectedId(scenario.id)}>{scenario.kind === "validation" ? "Explore input correction" : "Explore results"}<span className="sr-only">: {scenario.title}</span></button>
    </li>)}</ul>}
    <div id="example-detail">
      {selected && <>
        <section className="example-detail" aria-labelledby="example-detail-title">
          <div className="example-detail-heading"><h2 id="example-detail-title" ref={heading} tabIndex={-1}>{selected.title}</h2><span className="example-frozen">Recorded example</span></div>
          <p>{selected.summary}</p>
          <SearchScope scenario={selected} />
          <div className="example-tasks"><div><h3>Try these steps</h3><ol>{selected.tasks.map((task) => <li key={task}>{task}</li>)}</ol></div><div><h3>What to look for</h3><ul>{selected.expected_observations.map((observation) => <li key={observation}>{observation}</li>)}</ul></div></div>
          <details className="example-input"><summary>Input and recorded settings</summary><pre tabIndex={0} role="region" aria-label="Example input">{selected.input.input}</pre><p>Assembly: {selected.input.assembly ?? "not applicable"}. Format: {selected.input.format}. {selected.input.intended_loci?.length ? "An explicitly selected reference locus is included in this input." : "No intended locus is selected."}</p><pre tabIndex={0} role="region" aria-label="Example settings JSON">{JSON.stringify(selected.input, null, 2)}</pre></details>
          {onUseInput && <div className="example-use"><button type="button" className="button secondary" onClick={() => onUseInput(demonstrationInput(selected))}>Use this input in a new analysis</button><p className="field-hint">Opens the prediction form with these settings. Review the input and submit when ready.{selected.kind === "validation" && " This example deliberately needs its missing PAM corrected before submission."}</p></div>}
          {selected.kind === "validation" && <div className="example-validation"><h3>Observed input error · HTTP {selected.expected_error?.http_status}</h3><p>{selected.expected_error?.detail}</p><p>No prediction job or score was created. Resolve the spacer against the reference or supply its actual three-base PAM.</p></div>}
          {selected.kind === "result" && !loaded && !resultError && <p role="status">Loading the recorded results…</p>}
          {resultError && <div className="notice error" role="alert"><p>{resultError}</p><button type="button" className="button secondary" onClick={() => setResultRetry((value) => value + 1)}>Retry example results</button></div>}
          {loaded && <p className="example-integrity">{loaded.integrity === "verified" ? "Recorded file checksum verified." : "File schema checked. Checksum verification is unavailable in this browser."}</p>}
        </section>
        {selected.kind === "result" && loaded && selected.completed_job && <AnalysisWorkspace key={selected.id} job={selected.completed_job} document={loaded.document} demonstration onPrepare={onUseInput} referenceContextAvailable={referenceContextAvailable} />}
      </>}
    </div>
  </section>;
}
