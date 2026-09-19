# 28 — Calibration and model-combination assessment

Delivered 19 September 2026 by dedicated worker `improvement_28_calibration`.

**Status: semantics assessment delivered; optional calibrated estimates and
ensemble prediction deferred.** The user requested an accessible interface to
an already published tool. No new model, calibrator or research experiment was
introduced.

## Delivery and findings

- [Calibration extension assessment](../extensions/calibration.md): current
  output meanings, evidence gaps and explicit prerequisites for any future
  calibrated probability or combined predictor.
- Reviewed the actual softmax inference, CFD metadata, checkpoint provenance,
  aggregate diagnostics, Help, results, comparison/rank plot, shortlist,
  sensitivity display and export wording.
- No actionable probability, safety, uncertainty or equal-scale claim defect
  was identified in those paths. CRISPert models remain separate, CFD is a
  separate baseline, shortlist rules choose one method, and sensitivity uses
  within-model differences. Rank agreement is explicitly descriptive.
- No changes to pinned inference/tokenizer/CFD code, model files, shared UI,
  manifests, API or production services were needed.

## Verification

Ran existing focused checks on the authorized de.NBI staging VM at
`/srv/crispert/staging/nar-v2`, using Node 22.23.2:

```bash
node --experimental-strip-types --test \
  tests/frontend/comparison.test.ts \
  tests/frontend/shortlist.test.ts \
  tests/frontend/sensitivity.test.ts
```

**34 passed, 0 failed, 0.49 seconds.** Checks include independent ranks,
invariance to increasing score transformations, tied ranks, missing-score
handling, one-method shortlist rules and a structurally complete sensitivity
panel. These are implementation checks, not calibration validation. No local
inference or additional biological experiments were run.

## Coordinator integration

Link the extension assessment from the consolidated support matrix. Record
the status as **“assessed; optional calibration/ensemble deferred”**, never
“calibrated probabilities implemented.” Existing score labels already support
the current release scope.
