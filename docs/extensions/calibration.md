# Calibration and model combination

Reviewed 19 September 2026. **Semantics assessment complete; optional calibration
and ensemble features deferred.** This release provides a usable interface to
the published CRISPert method and its supplied, fixed sequence-only checkpoints.
It does not need a new predictor to deliver that interface.

## What the current outputs mean

| Surface | Verified behavior and interpretation |
|---|---|
| CRISPert k1/k2/k3 | `inference.py` returns positive-class softmax separately for each checkpoint. A value in [0, 1] is an uncalibrated score; 0.8 does not establish an 80% chance of cleavage. |
| Checkpoint comparison | k1 was reportedly trained from scratch; k2/k3 used artificial masked-language pretraining. This is not a controlled comparison of k-mer size alone. |
| CFD | A separate per-site sequence baseline with its own parameters. Its [0, 1] range does not give it the same meaning as CRISPert. Missing scores remain missing. |
| Rank comparison | Each method ranks candidates independently within one guide. Ties receive average ranks; Spearman reranks the jointly scored subset. Agreement describes ordering, not confidence or accuracy. |
| Shortlist | Rules use one selected method and record selection reasons. An overlap of top lists is descriptive; it is not a validated consensus predictor. |
| Sequence sensitivity | Each displayed difference subtracts the same model's original score from its substituted-sequence score. It is a counterfactual response, not an editing-rate change or evidence of molecular causality. |
| Exports and evidence page | Scores remain separate. AP assesses ranking against supplied labels; it does not calibrate scores. The report discloses overlap and uncertain dataset independence. |

Audit sources: [model card](../model-card.md),
[provenance](../science/README.md),
[diagnostics](../validation/web-diagnostics.json), and implementation modules
`inference.py`, `cfd.py`, `comparison.ts`, `shortlist.ts`, `sensitivity.ts`,
`analysisExports.ts` and their associated result/help components.

The three checkpoints are not documented independent samples from a posterior
distribution or a validated uncertainty ensemble. Their spread therefore
cannot supply a confidence interval, error bar or calibrated uncertainty score.
Arithmetic averaging, voting and rank averaging would each define a new rule
requiring separate validation; none is enabled. The same applies to combining
CFD with CRISPert. Shared score ranges alone do not justify this operation.

## Why existing diagnostic files are insufficient for calibration

Actual gradient-training and model-selection membership remain unverified.
One K562 guide and 981 exact pairs overlap the reported T-cell corpus; corpus
overlap is not proof of actual gradient exposure. The apparently disjoint files
are not established untouched tests. Assay ascertainment, label-zero generation
and deployment prevalence are unresolved. Balanced training sampling does not
provide the prevalence of positives in a future user's candidate set. Calibrating
these files and presenting the same files as final validation would not resolve
those gaps.

## Gates for a future, separately scoped extension

1. Define the event precisely: for example, detection by a named assay under a
   stated cell context and threshold. Probability of an assay label is not
   editing frequency, guide safety or probability of any off-target event.
2. Establish rights, raw-data provenance and documented training/selection
   history. Obtain suitable calibration data and a final untouched evaluation
   set. Keep guides and related samples separated; exact-pair deduplication
   alone does not establish independence. Record every partition before fitting.
3. Specify the candidate-generation procedure, nuclease, genome, assay,
   prevalence and sampling design. Assess transport to the intended population;
   case-control proportions or a selected shortlist must not silently stand in
   for deployment prevalence. Sequence-only calibration does not create a
   cell-context model or validate missed genome-search candidates.
4. Select the calibration method and any ensemble weights using only development
   data. Freeze them before final evaluation. Retain each original checkpoint
   score beside a separately versioned derived output, with context and
   applicability metadata. A new combination needs its own evaluation.
5. On the untouched set, report reliability diagrams with bin counts and
   observed-event fractions, plus Brier score and log loss, alongside ranking
   metrics. Brier/log loss reflect more than calibration alone. Include event
   counts, guide-level results and a justified approach to clustered uncertainty;
   do not let millions of correlated candidate rows masquerade as independent
   biological replicates. A scalar calibration error by itself is insufficient.
6. Expose a probability label only for the validated event and context, with
   explicit unavailable states outside scope. Validate any proposed decision
   threshold separately. Even calibrated per-site estimates do not establish
   clinical safety or support a naive sum/product for guide-level risk.

These gates are a project-specific extension plan, not additional experiments
claimed complete or a condition for providing the current ranking interface.

## Method references

Softmax classification outputs can require post-processing to achieve empirical
calibration; temperature scaling is one evaluated approach, not evidence that
these CRISPert checkpoints are calibrated.
[Guo et al., ICML 2017](https://proceedings.mlr.press/v70/guo17a.html).

Calibration fitting needs data separate from classifier fitting. Reliability
diagrams compare predicted values with observed frequencies; proper scoring
rules also reflect discrimination and data uncertainty. These principles inform
the proposed evaluation above; no scikit-learn calibrator is fitted here.
[Scikit-learn calibration guide](https://scikit-learn.org/stable/modules/calibration.html).
