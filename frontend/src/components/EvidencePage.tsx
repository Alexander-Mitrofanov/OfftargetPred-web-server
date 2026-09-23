import { useId, useState } from "react";
import {
  evidenceJsonDownload,
  evidenceMethodLabels,
  evidenceMethods,
  evidenceMetric,
  evidencePartitions,
  evidenceProvenance,
  evidenceReason,
  evidenceReport,
  macroReason,
  selectEvidence,
} from "../features/evidence";
import type { EvidencePartitionId } from "../features/evidence";
import "./EvidencePage.css";

const integer = (value: number) => value.toLocaleString("en-US");
const aggregateDownload = evidenceJsonDownload(evidenceReport);
const provenanceDownload = evidenceJsonDownload(evidenceProvenance());

function Metric({
  value,
  reason,
}: {
  value: number | null;
  reason?: string | null;
}) {
  return (
    <>
      <span
        className="evidence-value"
        title={value === null ? undefined : String(value)}
      >
        {evidenceMetric(value)}
      </span>
      {value === null && (
        <small className="evidence-cell-note">
          {reason || evidenceReason(null)}
        </small>
      )}
    </>
  );
}

export function EvidencePage() {
  const headingId = useId();
  const scopeId = useId();
  const [datasetId, setDatasetId] = useState(evidenceReport.datasets[0].id);
  const [partitionId, setPartitionId] = useState<EvidencePartitionId>("full");
  const { dataset, partition, guides } = selectEvidence(datasetId, partitionId);

  return (
    <section className="evidence-page" aria-labelledby={headingId}>
      <header className="evidence-introduction">
        <h2 id={headingId}>Evidence for the served models</h2>
        <p>
          The CRISPert web server makes the published CRISPert method easier to
          use. These diagnostics document numerical reproduction of its three supplied,
          sequence-only CRISPert-small checkpoints on the supplied evaluation
          files. They do not establish a new method or a performance ranking
          across future experiments.
        </p>
        <p className="evidence-citation">
          Jobson Pargeter, Backofen and Tran (2024).{" "}
          <a href="https://doi.org/10.1007/978-3-031-70368-3_6">
            CRISPert: A Transformer-Based Model for CRISPR-Cas Off-Target
            Prediction
          </a>
          . ECML PKDD, pp. 92–104. The paper’s results do not automatically
          describe these exact checkpoints.
        </p>
      </header>

      <div className="evidence-selection">
        <label>
          Supplied dataset
          <select
            value={datasetId}
            onChange={(event) => setDatasetId(event.target.value)}
          >
            {evidenceReport.datasets.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.display_name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Guide partition
          <select
            value={partitionId}
            onChange={(event) =>
              setPartitionId(event.target.value as EvidencePartitionId)
            }
          >
            {evidencePartitions.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.label}
              </option>
            ))}
          </select>
        </label>
        <p className="evidence-partition-help">
          Overlap refers to the same 20 nt guide in the bundle-reported T-cell
          corpus. Excluding those guides does not establish independent testing:
          actual training, validation and model-selection exposure remain
          unknown.
        </p>
      </div>

      <div
        className="evidence-scope"
        id={scopeId}
        role="status"
        aria-live="polite"
      >
        <p>
          <strong>{integer(partition.rows)} candidate rows</strong>,{" "}
          {integer(partition.guides)} guides, {integer(partition.positives)}{" "}
          positive labels and {integer(partition.label_zero_rows)} label-zero
          rows in this selection.
        </p>
        {partition.rows === 0 ? (
          <p>
            No supplied guides belong to this partition. Choose another guide
            partition to view scores.
          </p>
        ) : (
          <p>
            {dataset.candidate_scope} No genome search was run; these numbers do
            not measure candidate-retrieval recall.
          </p>
        )}
      </div>

      <p className="evidence-scroll-hint">
        Scroll tables sideways to see every column.
      </p>
      <div
        className="evidence-table-scroll"
        tabIndex={0}
        role="region"
        aria-label="Average precision comparison"
        aria-describedby={scopeId}
      >
        <table className="evidence-table">
          <caption>
            Average precision (AP) for the selected candidate rows
          </caption>
          <thead>
            <tr>
              <th scope="col">Method</th>
              <th scope="col">
                Macro AP <small>Each eligible guide has equal weight</small>
              </th>
              <th scope="col">Guides used in macro AP</th>
              <th scope="col">
                Pooled AP <small>All scored rows together</small>
              </th>
            </tr>
          </thead>
          <tbody>
            {evidenceMethods.map((method) => {
              const metrics = partition.methods[method];
              return (
                <tr
                  key={method}
                  className={method === "cfd" ? "evidence-baseline" : undefined}
                >
                  <th scope="row">
                    {evidenceMethodLabels[method]}
                    {method === "cfd" && (
                      <small>Separate sequence-only baseline</small>
                    )}
                  </th>
                  <td>
                    <Metric
                      value={metrics.macro_average_precision}
                      reason={macroReason(partition, method)}
                    />
                  </td>
                  <td>
                    {metrics.macro_evaluated_guides} / {partition.guides}
                    <small>{metrics.macro_excluded_guides} excluded</small>
                  </td>
                  <td>
                    <Metric
                      value={metrics.pooled_average_precision}
                      reason={
                        partition.rows === 0
                          ? "No rows in this partition."
                          : evidenceReason(metrics.pooled_reason)
                      }
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="evidence-reading-note">
        AP describes ranking against the supplied labels. It is not a cleavage
        probability. Values are displayed to four decimal places; downloads
        retain full precision. Each method is evaluated separately.
      </p>
      {partition.zero_positive_guides > 0 && (
        <p className="evidence-zero-note">
          <strong>
            {partition.zero_positive_guides} guide
            {partition.zero_positive_guides === 1 ? " has" : "s have"} no
            positive labels.
          </strong>{" "}
          Its AP is not defined and it is excluded from macro AP. Its candidate
          rows remain included in pooled AP.
        </p>
      )}

      <details className="evidence-details">
        <summary>See results for each guide ({guides.length})</summary>
        <p>
          Guide numbers stay the same within each dataset when the partition
          changes. Variation between these few guides is not a confidence
          interval.
        </p>
        {guides.length === 0 ? (
          <p>No guides in this partition.</p>
        ) : (
          <div
            className="evidence-table-scroll"
            tabIndex={0}
            role="region"
            aria-label="Per-guide average precision"
          >
            <table className="evidence-table evidence-guide-table">
              <caption>{dataset.display_name}: per-guide AP</caption>
              <thead>
                <tr>
                  <th scope="col">Guide</th>
                  <th scope="col">Rows</th>
                  <th scope="col">Positive labels</th>
                  {evidenceMethods.map((method) => (
                    <th scope="col" key={method}>
                      {method === "cfd" ? "CFD" : method} AP
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {guides.map((guide) => (
                  <tr key={guide.guide_23nt_sha256}>
                    <th scope="row">
                      {guide.label}
                      <small>
                        {guide.reported_training_guide_overlap
                          ? "Reported T-cell overlap"
                          : "No reported T-cell overlap"}
                      </small>
                    </th>
                    <td>{integer(guide.rows)}</td>
                    <td>{integer(guide.positives)}</td>
                    {evidenceMethods.map((method) => (
                      <td key={method}>
                        <Metric
                          value={guide.methods[method].average_precision}
                          reason={evidenceReason(guide.methods[method].reason)}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <details className="evidence-nested-details">
          <summary>Guide identity fingerprints</summary>
          <p>
            SHA-256 fingerprints identify the supplied guide records; they are
            not anonymization.
          </p>
          <dl className="evidence-fingerprints">
            {guides.map((guide) => (
              <div key={guide.guide_23nt_sha256}>
                <dt>{guide.label}: 23 nt guide SHA-256</dt>
                <dd>
                  <code>{guide.guide_23nt_sha256}</code>
                </dd>
                <dt>20 nt partition-group SHA-256</dt>
                <dd>
                  <code>{guide.split_group_20nt_sha256}</code>
                </dd>
              </div>
            ))}
          </dl>
        </details>
      </details>

      <section
        className="evidence-limitations"
        aria-label="Interpretation limits"
      >
        <h3>Keep the scope in view</h3>
        <ul>
          <li>
            These supplied files are not a verified untouched test. Guides and
            some candidate pairs recur across datasets; dataset results are not
            independent replications.
          </li>
          <li>
            Label-zero rows are not established biological negatives. None of
            the model outputs quantifies cleavage probability or biological
            safety.
          </li>
          <li>
            Scoring the supplied candidate files does not validate the separate
            NGG, 0–4 mismatch genome-search stage.
          </li>
        </ul>
      </section>

      <details className="evidence-details">
        <summary>How to read these metrics</summary>
        <dl className="evidence-definitions">
          <dt>Average precision (AP)</dt>
          <dd>{evidenceReport.definitions.average_precision}</dd>
          <dt>Macro AP</dt>
          <dd>{evidenceReport.definitions.macro_average_precision}</dd>
          <dt>Pooled AP</dt>
          <dd>{evidenceReport.definitions.pooled_average_precision}</dd>
          <dt>Uncertainty</dt>
          <dd>{evidenceReport.uncertainty.reason}</dd>
          <dt>CFD baseline</dt>
          <dd>
            CFD is calculated separately from CRISPert, using the pinned Doench
            parameters. It is not averaged with the model outputs. Source:{" "}
            <a href={evidenceReport.provenance.cfd.citation_url}>
              {evidenceReport.provenance.cfd.citation}
            </a>
            .
          </dd>
        </dl>
      </details>

      <details className="evidence-details">
        <summary>Numerical reproduction checks for the full K562 file</summary>
        <p>
          These checks compare the served checkpoints against the supplied
          rounded reference values, using the recorded absolute tolerance. A
          passing check does not mean bit-identical results across devices or
          new biological validation.
        </p>
        <div
          className="evidence-table-scroll"
          tabIndex={0}
          role="region"
          aria-label="Numerical reproduction checks"
        >
          <table className="evidence-table">
            <caption>
              Full K562 macro AP, independent of the selectors above
            </caption>
            <thead>
              <tr>
                <th scope="col">Model</th>
                <th scope="col">Observed on GPU</th>
                <th scope="col">Bundle reference</th>
                <th scope="col">Absolute tolerance</th>
                <th scope="col">Change from earlier CPU run</th>
                <th scope="col">Check</th>
              </tr>
            </thead>
            <tbody>
              {evidenceReport.reference_reproduction.map((check) => (
                <tr key={check.method}>
                  <th scope="row">{check.method}</th>
                  <td>{check.observed_macro_ap.toFixed(8)}</td>
                  <td>{check.bundle_rounded_reference_macro_ap}</td>
                  <td>{check.tolerance}</td>
                  <td
                    title={String(check.absolute_delta_from_previous_cpu_run)}
                  >
                    {check.absolute_delta_from_previous_cpu_run.toExponential(
                      3,
                    )}
                  </td>
                  <td>
                    {check.passed ? "Within tolerance" : "Outside tolerance"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>

      <details className="evidence-details">
        <summary>Sources, runtime and full limitations</summary>
        <p>
          Generated {evidenceReport.generated_at}. Inference used{" "}
          {evidenceReport.runtime.cuda_device_name},{" "}
          {evidenceReport.runtime.precision}, PyTorch{" "}
          {evidenceReport.runtime.torch} and CUDA {evidenceReport.runtime.cuda}.
        </p>
        <p>
          Selected source file: <code>{dataset.filename}</code>
          <br />
          SHA-256: <code className="evidence-hash">{dataset.sha256}</code>
        </p>
        <ul>
          {evidenceReport.limitations.map((limitation) => (
            <li key={limitation}>{limitation}</li>
          ))}
        </ul>
        <details className="evidence-nested-details">
          <summary>Model, parameter and source-code hashes</summary>
          <pre>{JSON.stringify(evidenceReport.provenance, null, 2)}</pre>
        </details>
      </details>

      <div className="evidence-downloads">
        <a
          href={aggregateDownload}
          download="crispert-web-diagnostics.json"
        >
          Download aggregate evidence (JSON)
        </a>
        <a
          href={provenanceDownload}
          download="crispert-evidence-provenance.json"
        >
          Download provenance (JSON)
        </a>
      </div>
      <p className="evidence-reading-note">
        Downloads contain all dataset partitions, per-guide summaries and
        recorded sources. They contain no raw assay candidate rows or model
        weights. This page and its downloads work without a connection to the
        analysis server.
      </p>
    </section>
  );
}
