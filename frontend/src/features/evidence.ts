import report from "../../../docs/validation/web-diagnostics.json" with { type: "json" };

/** The displayed diagnostics and downloads share this build-time source. */
export const evidenceReport = report;
export type EvidenceDataset = (typeof report.datasets)[number];
export type EvidencePartitionId = keyof EvidenceDataset["partitions"];
export type EvidencePartition =
  EvidenceDataset["partitions"][EvidencePartitionId];
export type EvidenceGuide = EvidenceDataset["per_guide"][number];
export type EvidenceMethodId = "k1" | "k2" | "k3" | "cfd";

export const evidenceMethods: readonly EvidenceMethodId[] = [
  "k1",
  "k2",
  "k3",
  "cfd",
];
export const evidenceMethodLabels: Record<EvidenceMethodId, string> = {
  k1: "CRISPert-small k1",
  k2: "CRISPert-small k2",
  k3: "CRISPert-small k3",
  cfd: "CFD baseline",
};
export const evidencePartitions: readonly {
  id: EvidencePartitionId;
  label: string;
}[] = [
  { id: "full", label: "All supplied guides" },
  {
    id: "reported_training_guide_disjoint",
    label: "Exclude reported T-cell guide overlap",
  },
  {
    id: "reported_training_guide_overlap",
    label: "Reported T-cell guide overlap only",
  },
];

export function selectEvidence(
  datasetId: string,
  partitionId: EvidencePartitionId,
) {
  const dataset = evidenceReport.datasets.find(
    (entry) => entry.id === datasetId,
  );
  if (!dataset) throw new Error(`Unknown evidence dataset: ${datasetId}`);
  const guides = dataset.per_guide
    .map((guide, index) => ({ ...guide, label: `Guide ${index + 1}` }))
    .filter(
      (guide) =>
        partitionId === "full" ||
        guide.reported_training_guide_overlap ===
          (partitionId === "reported_training_guide_overlap"),
    );
  return { dataset, partition: dataset.partitions[partitionId], guides };
}

export function evidenceMetric(value: number | null): string {
  return value === null ? "Not defined" : value.toFixed(4);
}

export function evidenceReason(reason: string | null | undefined): string {
  if (reason === "no_positive_labels")
    return "No positive labels in this group.";
  if (reason === "incomplete_score_coverage")
    return "Some candidate rows have no score.";
  return reason
    ? reason.replaceAll("_", " ")
    : "No eligible guides with defined average precision.";
}

export function macroReason(
  partition: EvidencePartition,
  method: EvidenceMethodId,
): string | null {
  const metrics = partition.methods[method];
  if (metrics.macro_average_precision !== null) return null;
  if (partition.guides === 0) return "No guides in this partition.";
  if (partition.positives === 0) return "No positive labels in this group.";
  return "No eligible guides with complete scores and positive labels.";
}

/** A provenance-only download is derived from the same report, never a second ledger. */
export function evidenceProvenance() {
  return {
    schema_version: evidenceReport.schema_version,
    generated_at: evidenceReport.generated_at,
    purpose: evidenceReport.purpose,
    datasets: evidenceReport.datasets.map(
      ({ id, display_name, filename, sha256, candidate_scope }) => ({
        id,
        display_name,
        filename,
        sha256,
        candidate_scope,
      }),
    ),
    provenance: evidenceReport.provenance,
    runtime: evidenceReport.runtime,
    reference_reproduction: evidenceReport.reference_reproduction,
    definitions: evidenceReport.definitions,
    limitations: evidenceReport.limitations,
    uncertainty: evidenceReport.uncertainty,
  };
}

export function evidenceJsonDownload(value: unknown): string {
  return `data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(value, null, 2) + "\n")}`;
}
