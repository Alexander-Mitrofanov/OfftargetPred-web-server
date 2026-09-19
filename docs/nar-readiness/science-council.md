# Scientific council: OfftargetPred and NAR readiness

Date: 19 September 2026. Recommendations only; no production code, model, dataset, or deployment changed. Companion files: [aggregate audit](dataset-audit.json) and [read-only reproduction script](audit_dataset_overlap.py).

## Recommendation

Build the submission around **reproducible prioritization of experimental off-target candidates using the exact sequence-only CRISPert-small models**. A strong, testable value claim would be: for a fixed number of sites a researcher can validate, the workflow recovers more assay-observed sites, while making candidate-search limits and disagreement between models visible. This is a hypothesis to test, not an established result.

The deployment is already numerically well checked. Its immediate scientific priority is to establish what the benchmark measures. Adding many external predictors would not resolve that issue. Preserve the deliberate exclusion of CasKAS and epigenetic features.

For policy, use the [current NAR instructions](https://academic.oup.com/nar/pages/Submission_Webserver), including the November 2026 changes; the coordinator memo covers requirements. Whether this CRISPR application falls under the therapeutic-validation exception needs editorial clarification. A research-use label alone does not establish exemption.

## Evidence: what was verified locally

Reviewed `README.md`, `docs/model-card.md`, `docs/validation/README.md`, `models.manifest.json`, `docs/validation/model-benchmark.json`, the supplied bundle README, its training/data code, and checkpoint metadata. Existing evidence establishes adapter/reference parity and reproduction of supplied benchmark scores. These checks establish implementation fidelity, not superiority over other predictors.

The existing five-guide K562 benchmark has macro average precision (AP) 0.647596, 0.536923, and 0.553342 for k=1/2/3; pooled AP is 0.309324, 0.230368, and 0.267289. These are the saved measurements, not newly run inference. AP is the scikit-learn metric called AUPRC in the package. The different pooled and per-guide summaries answer different questions.

### New aggregate audit findings

The script reads the local files, validates 23 nt sequence/label format, normalizes case and surrounding whitespace, and compares exact directional sequences. It publishes counts and hashes only.

| Supplied dataset | Rows | Positives / label-zero rows | Distinct 20 nt guides | Positive counts per guide | Exact guide / pair overlap with supplied T-cell corpus |
|---|---:|---:|---:|---|---:|
| T-cell | 51,906 | 1,266 / 50,640 | 17 | 11, 12, 12, 21, 24, 30, 31, 33, 44, 46, 48, 51, 59, 76, 117, 119, 532 | Reported training corpus |
| K562 in vivo | 43,132 | 188 / 42,944 | 5 | 2, 2, 8, 14, 162 | 1 / 981 |
| K562 DeepCRISPR | 18,421 | 118 / 18,303 | 12 | 4, 5, 6, 8, 9, 11, 11, 12, 13, 13, 13, 13 | 0 / 0 |
| iPSC in vivo | 25,741 | 53 / 25,688 | 3 | 0, 1, 52 | 0 / 0 |

Distinct 23 nt guide counts are identical to the 20 nt counts. The iPSC README says two guides, whereas the file contains three; two have positives. This needs reconciliation rather than silent correction of the original bundle.

The overlapping K562 guide has 9,725 evaluation rows and eight positives; its T-cell counterpart has 2,524 rows and 51 positives. Of the 981 shared sequence pairs, eight are positive in both, 933 are label-zero in both, and 40 are T-cell-positive/K562-label-zero. Such disagreements can reflect cell context, assay sensitivity, or dataset construction; they do not by themselves establish annotation errors. Because the service uses sequence alone, it cannot assign different predictions to an identical pair on the basis of cell context.

**Provenance limit:** the bundle README identifies `tcell_guideseq.csv` as training data, but saved checkpoints point to an original file named `Tcell_AG+histones+EX_compare_2bit.csv`. They contain a 20% validation-split setting and cfg seed 42, but no row-level split manifest. Training code passes the run seed separately, so cfg seed 42 does not prove the README's seed-zero description wrong. Exact gradient-training membership and equivalence of the original and bundled CSVs remain unverified. The defensible finding is overlap with the **reported training corpus** and insufficient evidence for a fully guide-independent benchmark. Cross-cell transfer is a different question from unseen-guide generalization.

The evaluation datasets also overlap each other: iPSC/K562 in vivo share one guide and 5,066 pairs; the two K562 files share one guide and 1,020 pairs. No cross-dataset reverse-complement 20 nt matches were found. That check is supplementary: reverse-complement protospacers do not automatically imply the same oriented Cas9 target and PAM.

### A second distinction: pair scoring versus genome search

Only 91/188 K562 in vivo positives satisfy the deployed search's sequence conditions, NGG and at most four protospacer substitutions. Counts are 117/118 for K562 DeepCRISPR and 37/53 for iPSC. These are **sequence-eligibility counts**, not observed search recall; genomic presence, assembly consistency, coordinates, duplicates, and actual retrieval have not been checked here. Therefore the pair-scoring benchmark cannot represent the performance of the search-plus-score workflow. Do not infer that all 188 observed K562 positives are even reachable under the current search settings.

## Publication status and novelty

The base method is published: Jobson Pargeter, Backofen and Tran, *CRISPert: A Transformer-Based Model for CRISPR-Cas Off-Target Prediction*, ECML PKDD 2024, pp. 92–104, DOI 10.1007/978-3-031-70368-3_6, published 22 August 2024. This is supported by the [publisher record](https://link.springer.com/chapter/10.1007/978-3-031-70368-3_6) and the [official conference listing](https://ecmlpkdd.org/2024/program-accepted-papers-research-track/).

The [conference-hosted paper](https://ecmlpkdd-storage.s3.eu-central-1.amazonaws.com/preprints/2024/lncs14947/lncs14947094.pdf) describes twelve encoder blocks and experiments including additional CasKAS inputs. The deployed artifacts have four layers and sequence-only input. I did not verify a publication validating these exact small checkpoints, their hashes, or their cross-cell selection procedure. Cite the base method as background and report the deployed models' own evidence; do not inherit paper headline metrics or therapeutic validation claims.

**Inference:** the credible contribution is accessible, transparent evaluation and prioritization using these models, supported by independent validation and a useful complete workflow. A React interface, GPU deployment, three model choices, or Cas-OFFinder integration alone is a weak novelty case. Several mature tools already combine search, scoring, annotation, and experiment preparation.

## Comparators: use current capabilities accurately

| Resource | Primary-source capabilities relevant here | Consequence for OfftargetPred |
|---|---|---|
| [CRISPOR live server](https://crispor.org/) and [2018 paper](https://doi.org/10.1093/nar/gky354) | Guide design from sequence/coordinates, genome selection, off-target and on-target scores, and experimental preparation. The current landing page advertises 1,548 genomes. | Annotation, primers, and a guide table are useful expected features, not a unique scientific claim. Compare task completion and candidate prioritization, not just visual appearance. |
| [CRISPRoff live server](https://rth.dk/resources/crispr/crisproff/) and [CRISPRon/off paper](https://academic.oup.com/bioinformatics/article/38/24/5437/6769890) | Energy-based off-target assessment; the live server states up to six mismatches and NGG/NGA/NAG candidate PAMs. Its connected workflow supports guide selection and a guide-level specificity score. | A direct search comparison must account for different candidate universes. Do not label the CRISPert softmax as CRISPRoff specificity or substitute an unvalidated sum/mean of site scores. |
| [CHOPCHOP live server](https://chopchop.cbu.uib.no/) and [v3 paper](https://academic.oup.com/nar/article/47/W1/W171/5491735) | Gene/transcript/coordinate/sequence input, multiple editing purposes, genomic context, and experimental design aids. | Broad multi-nuclease guide design is an established alternative. OfftargetPred can stay focused on SpCas9 candidate triage without imitating this entire scope. |
| [CRISPRme official repository](https://github.com/pinellolab/CRISPRme) and [current project page](https://pinellolab.github.io/CRISPRme/) | Variant/haplotype-aware nomination, mismatches and bulges, detailed reports. The original public hosted service is retired; current use is local/container deployment. | Include it as a methods/workflow comparator, accurately labeled as locally deployable. Do not claim to match its variant coverage. No inference of a hosted outage was needed: retirement is explicitly documented. |
| [Cas-OFFinder release source](https://github.com/snugel/cas-offinder/tree/9816b94c20c4cba2e79b039e1e2a6dee684b7b66) | Candidate enumeration is an upstream computation rather than the CRISPert predictive model. | Credit the dependency and measure search coverage separately from ranking. |

Live pages were inspected; no full comparative jobs were submitted to these services during this review. A paper's historical features and a working current end-to-end service are different evidence levels.

## Prioritized improvements

Effort estimates below are planning estimates for someone familiar with the repository, excluding author/data-owner response time. They are not NAR thresholds or implementation promises.

### 1. P0 — Reconstruct a defensible provenance and split ledger

**Value:** establishes which generalization claims the measurements support. **Scope:** document original accession/publication, assay, cell, nuclease, preprocessing, candidate-negative generation, guide identity, row filtering, training/selection/test role, and exact file/checkpoint hashes. Reconcile the overlapping guide, original training CSV identity, iPSC counts, and run-seed metadata with the model authors. Preserve the full five-guide score as reproduction evidence and separately evaluate genuinely disjoint guides; removing only shared candidate rows is insufficient for a new-guide claim.

**Acceptance:** a machine-readable manifest assigns every guide to a documented role; automated overlap report accompanies each benchmark; all unresolved provenance is explicitly flagged; claims in model card, interface, and manuscript agree. **Dependencies/caveat:** actual training and model-selection manifests require the model authors. Existing files alone do not prove exact training membership. Estimated 1–3 days plus author clarification.

### 2. P0 — Run a locked independent validation of the deployed artifacts

**Value:** tests biological usefulness beyond reproduced package numbers. **Scope:** first validate the 12-guide K562 file after provenance review; then freeze k=1 default, all three checkpoint hashes, processing rules, and metrics before evaluating an external dataset unused in training or model selection. Include more than one assay/context where feasible, reporting each separately. A multi-guide public experiment with cellular measurements is preferable; [CHANGE-seq's primary publication and supplement](https://www.nature.com/articles/s41587-020-0555-7) offer both in-vitro and cellular experimental material, but its T-cell relationship to the supplied training corpus must be audited before choosing it. No CasKAS or epigenetic inputs are needed.

**Acceptance:** release dataset provenance, positive/label-zero counts, per-guide AP, pooled AP, AUROC as secondary, PR curves, recall and precision at fixed candidate budgets, and guide-level uncertainty intervals. Report skipped/no-positive groups explicitly. Use guide resampling for aggregate intervals; five guides cannot produce a strong population-wide claim. **Dependencies/caveat:** assay non-detection is not a proven biological negative; compare within stated assay/candidate universes. Confirm that the 12-guide set was not used to choose k or tune other decisions before calling it untouched. Estimated 3–7 days after data provenance is resolved.

### 3. P1 — Test ranking against a small, fair baseline panel

**Value:** reveals whether the model adds useful information beyond mismatch counting. **Scope:** use mismatch count, locally reproduced CFD, and a reproducible CRISPRoff site score when compatible; add one well-documented sequence-only learned baseline only if checkpoint availability, license, and training overlap can be audited. CRISPOR/CHOPCHOP are also workflow comparators; they need not be forced into identical model architectures.

**Acceptance:** all ranking comparisons use the same frozen candidate rows, guide groups, label definition, and tie handling. Publish per-guide paired differences at budgets such as 10, 50, and 100 sites, plus AP. Separate end-to-end retrieval comparisons when a tool's search scope differs. Never copy published headline scores from other datasets into one ranking table. **Dependencies/caveat:** baseline source/parameter licensing and overlap audit; avoid naming an unavailable tool as a completed comparator. Strong utility can be documented without a universal SOTA claim. Estimated 2–5 days for minimal panel.

Predefine the shortlist policy, including any use of disagreement or genomic context. If its rules or weights are tuned, use guide-disjoint development data and an untouched final evaluation, or nested guide-level cross-validation when a final holdout is unavailable. Repeated guides across cell/assay datasets belong in the same split group. A manual shortlist's benefit needs a blinded/counterbalanced user study or prospective validation, not retrospective selection of favorable candidates.

### 4. P0 — Quantify candidate nomination coverage before claiming genome-wide performance

**Value:** prevents a good reranker from hiding unreachable positives. **Scope:** match published sites to the pinned GRCh38 primary assembly, then measure the fraction present, inside the PAM/mismatch scope, actually retrieved, and retained in the top-ranked list. Report an attrition table for every benchmark, including failure/cap cases. Keep the present NGG, substitution-only search contract until expanded scope is validated.

**Acceptance:** show separate denominators for sequence eligibility, reference-mappable observed positives, nomination recall, and conditional ranking recall. Every omitted site has a reason; failed searches never enter an accuracy table as complete. Add synthetic 3/4-mismatch edge cases to the existing 0/1/2-mismatch oracle when that search-validation work is implemented. **Dependencies/caveat:** coordinates/assembly harmonization may need original data. The 91/188 local eligibility count is an audit warning, not a genomic-recall estimate. Estimated 2–4 days.

Wider mismatch limits or additional PAMs can still yield ungapped 23 nt pairs and do not inherently require new model weights. They do require scope-specific validation, measured search cost, and appropriate bounds. Bulges are different: the present fixed-length aligned encoding does not support gapped candidates. Increasing enumeration alone never establishes predictive validity.

### 5. P1 — Complete the researcher workflow from guide to a documented shortlist

**Value:** makes the scientific ranking actionable. **Scope:** offer guided entry of a 20 nt spacer plus intended locus, resolve the actual reference PAM and orientation, and preserve explicit 23 nt expert input. Group results by guide; retain repeated perfect matches and let users identify their intended locus. Let users select a validation budget and export a transparent shortlist containing rank, score, mismatch pattern, coordinates, exact model/reference identity, and selection rationale.

**Acceptance:** plus/minus-strand examples recover the correct reference-derived 23-mer; ambiguous multi-locus matches require an explicit locus choice; sequence disagreement with reference is displayed; no arbitrary PAM is appended. The same shortlist is regenerated from its saved manifest and parameters. **Dependencies/caveat:** no claim of on-target efficiency or overall safest/best guide. An imported custom target allele needs distinct handling. Estimated 3–5 days.

### 6. P1 — Add local genomic context with explicit scientific boundaries

**Value:** helps plan which candidate sites to investigate and interpret. **Scope:** release-pinned gene, transcript, exon, coding/noncoding overlap; browser links and BED export. Keep annotation separate from model inputs and score. Prefer a compact, reproducible annotation layer over many live external services.

**Acceptance:** tested coordinate conversion on both strands, exon boundaries and overlapping transcripts; exported intervals round-trip through an independent browser; annotation release and retrieval date accompany results. **Dependencies/caveat:** source licenses, storage, reference-contig aliases, and transcript policy. Gene overlap describes context; it does not prove pathogenicity or clinical consequence. CRISPOR already has context and experiment-support functions, so this improves utility rather than independently establishing novelty. Estimated 2–4 days.

### 7. P1 — Make one positive and one difficult biological case reproducible

**Value:** demonstrates what a researcher learns, including limitations. **Scope:** one frozen interactive example shows guide → discovered candidates → ranked, annotated sites → shortlist matched to independent assay observations. A second shows a failure mode: missed non-NGG/high-mismatch sites, cross-context disagreement, or substantial model rank changes. Use public data with clear permission and attribution.

**Acceptance:** examples work through the same interactive result components as user jobs; all plotted sites map to downloadable records; expected conclusions are written before selecting attractive examples. Show observed/not-detected labels without relabeling non-detection as certainty of no cleavage. **Dependencies/caveat:** select examples after the split audit and disclose any illustrative selection. Retrospective use cases show practical value; prospective targeted sequencing of a blinded shortlist would strengthen the claim, but is a larger optional study. Estimated 2–4 days after benchmarking.

### 8. P2 — Evaluate model disagreement as ranking robustness

**Value:** makes the three models scientifically informative instead of three unexplained numbers. **Scope:** show per-guide rank correlations, top-budget overlaps, and rank shifts for k=1/2/3. In validation, check whether disagreements concentrate among assay-positive or difficult sites. Preserve separate score columns and the existing default.

**Acceptance:** all views use the same complete candidate universe; ties and filtered subsets are documented; plots reproduce from exported rows. Report any association with errors on independent data before presenting it as a useful review flag. **Dependencies/caveat:** the three models differ in tokenization and pretraining, so this is not a controlled k-only ablation or independent ensemble. Disagreement is not calibrated uncertainty and averaging scores is not justified. Estimated 1–3 days.

### 9. P1 — Publish a reproducible scientific evaluation package

**Value:** allows a reviewer to verify both the model claim and the web output. **Scope:** exact checkpoint/tokenizer identities, executable evaluation environment, public-data acquisition/preprocessing recipes, expected metrics, a small legally shareable fixture, model-card limitations, and a release archive linked to the server. Document performance at several input sizes and search radii with repeated runs, not just one successful GPU request.

**Acceptance:** a second person reproduces a fixture and all public benchmark aggregates in a clean environment; outputs contain version/configuration manifests; CPU/GPU tolerance and benchmark hardware are explicit. **Dependencies/caveat:** model and data redistribution permissions are distinct from the web-app license; do not publish the supplied private bundle without permission. A single runtime result is not a general service-level guarantee. Estimated 2–4 days, plus permission/archival work.

### 10. P2 — Explore a sequence-only model-sensitivity view after the core study

**Value:** offers an original inspectable view of what changes model ranking. **Scope:** for one selected guide/site pair, enumerate single-base substitutions in the candidate's protospacer, hold guide and PAM fixed, and display score/rank changes. This is a small bounded research extension with no retraining, epigenetic data, bulges, or genome-wide variant analysis. Test whether the view helps explain a verified case, rather than treating attention weights as biological explanation.

**Acceptance:** every cell corresponds to an explicit counterfactual sequence and can be rescored to reproduce the value; original-pair score is unchanged; labels distinguish hypothetical sequences from actual genomic sites. If scientific claims about mismatch tolerance are made, compare against experimental perturbation measurements from data untouched by model selection. **Dependencies/caveat:** perturbation effects describe this model, not a causal cleavage mechanism or patient-specific variant risk. Defer if benchmarking gives the server no distinctive predictive benefit. Estimated 2–3 days for a prototype, substantially longer for biological validation.

## Minimum evidence package and sequencing

1. Resolve the provenance ledger and moderate current independence claims first.
2. Lock one useful hypothesis: improved experimental-site recovery at fixed validation budget on unseen guides.
3. Obtain an independently justified evaluation panel, run the small baseline panel, and separate search coverage from ranking.
4. Build the guide-to-shortlist workflow with concise genomic context and two reproducible biological cases.
5. Archive reproducible artifacts with cleared permissions and seek editorial classification of the therapeutic exception before investing in optional research extensions.

Do not set a universal AP threshold after seeing outcomes. If CRISPert does not improve fixed-budget recovery, report that result and use measured usability/reproducibility benefits only if they are substantial; otherwise strengthen the science before submission. Deferring CasKAS, bulges, new nucleases, personalized haplotypes, and an unvalidated ensemble keeps this project scientifically coherent.

## Council discussion and outstanding questions

- To integration: favor local annotation, export, and one baseline. Each supports the shortlist; installing many predictors creates licensing, overlap, and interpretation work without automatically adding novelty.
- Cross-review agreement: ship verified locus links and BED before embedded IGV; use CFD first as an offline evaluation comparator, with a live score column optional after licensing and parity checks. Preserve a user-selected shortlist with an explicit complete candidate universe.
- To usability: support spacer-plus-locus entry and user-selected intended target, but never imply that a candidate list alone supplies a validated overall guide-safety score.
- To model owners: provide the original training-data hash and row/guide splits, run seed and model-selection record, original accessions and negative construction, and whether exact small checkpoints have been published or evaluated elsewhere.
- To the submission lead: establish the editorial classification and model/data permissions; these cannot be inferred from public hosting or the published larger-model paper.

The most promising shared council hypothesis is **better recovery of experimentally observed off-target sites within a researcher's validation budget**, measured fairly and delivered in a fully reproducible browser workflow. Its success remains to be demonstrated.
