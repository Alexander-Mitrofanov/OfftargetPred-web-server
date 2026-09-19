# 02 — Reproducible web diagnostics

Implemented 19 September 2026 for the interface to the published CRISPert method.
The goal is transparent reproduction and score interpretation, without a new
algorithm, superiority claim or expansion of the biological claims.

## Delivered

- `docs/validation/reproduce_web_diagnostics.py`: runs the unchanged production
  inference adapter and pinned CFD implementation on the supplied evaluation
  files. Verifies dataset, model and tokenizer identities before inference.
- `docs/validation/web-diagnostics.json`: aggregate report from the V100 VM,
  containing per-guide, macro and pooled average precision (AP), exact row/label
  counts, guide-overlap partitions and descriptive rank agreement.
- `tests/test_web_diagnostics.py`: metric edge cases, optional numerical parity
  against scikit-learn/SciPy, and saved-report/provenance consistency.

All 87,294 evaluation rows were scored by all four methods. Every method uses
the same complete file, including non-NGG and high-mismatch candidates. No genome
search was run, and the report does not estimate candidate-retrieval recall.
No raw sequences, coordinates, private candidate records or model weights were
added to Git. Optional row-ordered score caches remain private on the VM.

## Observed macro AP

These are descriptions of the supplied files. They do not establish an untouched
independent test or a ranking of general biological performance.

| Supplied scope | Rows | Guides contributing AP / all guides | Positive labels | k1 | k2 | k3 | CFD |
|---|---:|---:|---:|---:|---:|---:|---:|
| Full K562 | 43,132 | 5 / 5 | 188 | 0.647596 | 0.536923 | 0.553369 | 0.258577 |
| K562 excluding the reported-T-cell guide group | 33,407 | 4 / 4 | 180 | 0.670785 | 0.539945 | 0.513299 | 0.267689 |
| K562 DeepCRISPR | 18,421 | 12 / 12 | 118 | 0.572286 | 0.708630 | 0.688498 | 0.368509 |
| iPSC | 25,741 | 2 / 3 | 53 | 0.764317 | 0.682203 | 0.205110 | 0.158134 |

All three full-K562 rounded reference AP checks pass the existing absolute
tolerance of 0.0001. CUDA k1/k2 macro AP equals the earlier CPU report; CUDA k3
differs by 0.0000264550. Both values and the difference are retained. This is a
successful tolerance-based reproduction, not a claim of bit-identical inference
on all devices or an identical four-decimal rounded value for k3.

AP uses distinct score thresholds with exact ties entering together, matching
scikit-learn's non-interpolated definition. Macro AP excludes zero-positive
guides with an explicit count and null per-guide AP. Pooled AP retains every
row, including zero-positive guide rows. The iPSC denominator is therefore two
guides even though its complete file contains three.

The whole overlapping K562 guide is excluded for the disjoint partition, using
20 nt protospacer identity. The underlying training/validation membership and
model-selection history remain unknown. Label-zero rows are not established
biological negatives. The three supplied datasets also contain repeated guides
and discordantly labelled repeated pairs, so they are not independent repeats.

Observed per-guide ranges expose variability. No confidence interval is claimed
from these small, historically selected guide groups; individual pair rows are
not treated as independent guide replicates. Agreement uses per-guide Spearman
correlation with averaged exact ties. Top-10 overlap resolves ties by original
row order and describes ranking disagreement, not uncertainty or accuracy.

## Reproduce on the VM

From `/srv/crispert/staging/nar-v2`, using the existing authorized private bundle:

```bash
sudo -n env \
  PYTHONPATH=/srv/crispert/staging/nar-v2/backend:/srv/crispert/venv/lib/python3.12/site-packages \
  /srv/crispert/staging/test-venv/bin/python \
  docs/validation/reproduce_web_diagnostics.py --device cuda \
  --cache-dir /srv/crispert/staging/private-web-diagnostic-cache

sudo -n env \
  PYTHONPATH=/srv/crispert/staging/nar-v2/backend:/srv/crispert/venv/lib/python3.12/site-packages \
  /srv/crispert/staging/test-venv/bin/python -m pytest \
  tests/test_web_diagnostics.py -q
```

Caches are reused only when dataset, model, runtime, inference-source and CFD
identities match and their score payload hash verifies. Cache directories/files
use 0700/0600 permissions. An identity change triggers fresh inference. A source
hash in the report records the code used; update the report intentionally when
the relevant source changes. No live service or checkpoint was modified.

## Evidence page integration contract (worker 25)

Consume `docs/validation/web-diagnostics.json` directly at build time; do not
copy metric values into a second hand-maintained data source. `schema_version`
is 1. Stable top-level fields:

- `purpose`, `definitions`, `limitations`, `uncertainty`: interpretation text.
- `datasets[]`: stable `id`, `display_name`, `filename`, `sha256`,
  `candidate_scope`, `partitions`, `per_guide`, `descriptive_agreement`.
- `datasets[].partitions.full`, `.reported_training_guide_overlap`,
  `.reported_training_guide_disjoint`: `rows`, `guides`, `positives`,
  `label_zero_rows`, `zero_positive_guides`, and `methods` keyed by
  `k1`, `k2`, `k3`, `cfd`.
- Each partition method: `macro_average_precision`,
  `pooled_average_precision`, `macro_evaluated_guides`,
  `macro_excluded_guides`, `guide_ap_min`, `guide_ap_max`,
  `available_rows`, `unavailable_rows`, `pooled_reason`.
- Each `per_guide` item: existing guide/split-group SHA-256 fingerprints,
  `reported_training_guide_overlap`, counts and `methods[].average_precision`.
  Fingerprints establish identity, not anonymization. They need not be prominent
  in the main interface; numbered guide labels and expandable provenance suffice.
- `reference_reproduction[]`: `method`, observed AP, earlier CPU AP, absolute
  delta, bundle rounded reference, tolerance and `passed`.
- `provenance`: exact models/CFD metadata, file/code/script SHA-256 values;
  `runtime`: V100/CUDA/FP32 and pinned library versions.

Use “Average precision (AP)” rather than an ambiguous interpolated “AUPRC”.
Display null as “Not defined” with its reason; never as zero. Show macro guide
denominators and candidate scope next to numbers. Label this page **Evidence**
or **Reproduction**, with published-method citation and limitations. Show the
overlap/disjoint partition as an explicit user choice. Do not rank the methods
with a winner badge, imply score calibration, or present guide-disjoint as
verified independent testing. Numerical checks are evidence for reproducibility;
usability of the web interface remains the product's main contribution.

## Verification

Final VM check: 18 tests passed, including 100 independent randomized AP/rank
parity cases against scikit-learn 1.5.2 and SciPy. The generated report passed
its internal scope/count/reference checks and uses the exact pinned models and
datasets. Heavy inference and reference-library testing ran on the VM only.
