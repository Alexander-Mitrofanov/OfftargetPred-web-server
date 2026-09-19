import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  evidenceJsonDownload,
  evidenceMethods,
  evidenceMetric,
  evidencePartitions,
  evidenceProvenance,
  evidenceReason,
  evidenceReport,
  macroReason,
  selectEvidence,
} from "../../frontend/src/features/evidence.ts";

test("the interface uses the exact aggregate report as its only metric source", () => {
  const source = JSON.parse(
    readFileSync(
      new URL("../../docs/validation/web-diagnostics.json", import.meta.url),
      "utf8",
    ),
  );
  assert.deepEqual(evidenceReport, source);
  assert.equal(evidenceReport.schema_version, 1);
  assert.equal(evidenceReport.datasets.length, 3);
  assert.equal(
    evidenceReport.datasets.reduce(
      (n, dataset) => n + dataset.partitions.full.rows,
      0,
    ),
    87294,
  );
  assert.deepEqual(evidenceMethods, ["k1", "k2", "k3", "cfd"]);
});

test("all dataset and partition selections preserve the matching guide and row counts", () => {
  for (const dataset of evidenceReport.datasets) {
    for (const { id } of evidencePartitions) {
      const selected = selectEvidence(dataset.id, id);
      assert.equal(selected.partition, dataset.partitions[id]);
      assert.equal(selected.guides.length, selected.partition.guides);
      assert.equal(
        selected.guides.reduce((n, guide) => n + guide.rows, 0),
        selected.partition.rows,
      );
      assert.equal(
        selected.guides.reduce((n, guide) => n + guide.positives, 0),
        selected.partition.positives,
      );
      assert.equal(
        selected.guides.reduce((n, guide) => n + guide.label_zero_rows, 0),
        selected.partition.label_zero_rows,
      );
      for (const guide of selected.guides) {
        const sourceIndex = dataset.per_guide.findIndex(
          (original) => original.guide_23nt_sha256 === guide.guide_23nt_sha256,
        );
        assert.equal(guide.label, `Guide ${sourceIndex + 1}`);
        if (id !== "full")
          assert.equal(
            guide.reported_training_guide_overlap,
            id === "reported_training_guide_overlap",
          );
      }
      for (const method of evidenceMethods) {
        const metrics = selected.partition.methods[method];
        assert.equal(
          metrics.macro_evaluated_guides + metrics.macro_excluded_guides,
          selected.partition.guides,
        );
        assert.equal(
          metrics.available_rows + metrics.unavailable_rows,
          selected.partition.rows,
        );
      }
    }
  }
  assert.throws(
    () => selectEvidence("missing", "full"),
    /Unknown evidence dataset/,
  );
});

test("whole-guide overlap partition is explicit and counts reconcile", () => {
  const full = selectEvidence("k562_dataset_invivo_full", "full");
  const overlap = selectEvidence(
    full.dataset.id,
    "reported_training_guide_overlap",
  );
  const disjoint = selectEvidence(
    full.dataset.id,
    "reported_training_guide_disjoint",
  );
  assert.equal(overlap.partition.guides, 1);
  assert.equal(overlap.partition.rows, 9725);
  assert.equal(overlap.partition.positives, 8);
  assert.equal(disjoint.partition.rows, 33407);
  assert.equal(
    overlap.partition.rows + disjoint.partition.rows,
    full.partition.rows,
  );
  assert.match(
    evidenceReport.definitions.reported_training_guide_disjoint,
    /exposure remain unknown/,
  );
});

test("iPSC retains all three guides and all rows while macro AP excludes its zero-positive guide", () => {
  const { guides, partition } = selectEvidence(
    "ipscs_dataset_invivo_full",
    "full",
  );
  assert.equal(partition.guides, 3);
  assert.equal(partition.zero_positive_guides, 1);
  assert.equal(partition.positives, 53);
  const zero = guides.find((guide) => guide.positives === 0)!;
  assert.equal(zero.rows, 3846);
  for (const method of evidenceMethods) {
    assert.equal(partition.methods[method].macro_evaluated_guides, 2);
    assert.equal(partition.methods[method].macro_excluded_guides, 1);
    assert.equal(partition.methods[method].available_rows, partition.rows);
    assert.equal(zero.methods[method].average_precision, null);
    assert.equal(
      evidenceMetric(zero.methods[method].average_precision),
      "Not defined",
    );
    assert.equal(
      evidenceReason(zero.methods[method].reason),
      "No positive labels in this group.",
    );
  }
});

test("empty partitions remain selectable and undefined metrics never become zero", () => {
  const { partition, guides } = selectEvidence(
    "ipscs_dataset_invivo_full",
    "reported_training_guide_overlap",
  );
  assert.equal(guides.length, 0);
  assert.equal(partition.rows, 0);
  for (const method of evidenceMethods) {
    assert.equal(partition.methods[method].macro_average_precision, null);
    assert.equal(
      evidenceMetric(partition.methods[method].pooled_average_precision),
      "Not defined",
    );
    assert.equal(
      macroReason(partition, method),
      "No guides in this partition.",
    );
  }
  assert.equal(evidenceMetric(0), "0.0000");
  assert.equal(evidenceMetric(1), "1.0000");
});

test("recorded reproduction checks agree with the displayed full-K562 source and tolerance", () => {
  const { partition } = selectEvidence("k562_dataset_invivo_full", "full");
  assert.equal(evidenceReport.reference_reproduction.length, 3);
  for (const check of evidenceReport.reference_reproduction) {
    const method = check.method as "k1" | "k2" | "k3";
    assert.equal(
      check.observed_macro_ap,
      partition.methods[method].macro_average_precision,
    );
    assert.equal(
      check.passed,
      Math.abs(
        check.observed_macro_ap - check.bundle_rounded_reference_macro_ap,
      ) <= check.tolerance,
    );
    assert.equal(
      check.absolute_delta_from_previous_cpu_run,
      Math.abs(check.observed_macro_ap - check.previous_cpu_macro_ap),
    );
  }
});

test("aggregate and provenance downloads preserve precision and recorded artifact identities", () => {
  const href = evidenceJsonDownload(evidenceReport);
  assert.match(href, /^data:application\/json;charset=utf-8,/);
  assert.deepEqual(
    JSON.parse(decodeURIComponent(href.slice(href.indexOf(",") + 1))),
    evidenceReport,
  );
  const provenance = evidenceProvenance();
  assert.equal(provenance.provenance, evidenceReport.provenance);
  assert.equal(provenance.runtime, evidenceReport.runtime);
  assert.deepEqual(
    provenance.datasets.map((dataset) => dataset.sha256),
    evidenceReport.datasets.map((dataset) => dataset.sha256),
  );
  assert.equal(provenance.provenance.model.models.length, 3);
  for (const dataset of provenance.datasets)
    assert.match(dataset.sha256, /^[0-9a-f]{64}$/);
  assert.ok(!("per_guide" in provenance.datasets[0]));
});
