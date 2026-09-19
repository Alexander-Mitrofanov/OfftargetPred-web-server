# OfftargetPred: council review for the NAR Web Server Issue

**Review date:** 19 September 2026. **Scope:** suggestions and readiness assessment; no feature implementation or production changes.

**Subsequent implementation direction from the user:** prioritize an easy-to-use
web interface for the already published CRISPert tool. New algorithms and new
scientific novelty claims are not the objective. The broader research ideas below
remain optional extensions; implementation and the final review follow the
[updated scope and status](../implementation/README.md). Scientific checks support
accurate descriptions of the served artifacts and reliable operation.

## Council conclusion

OfftargetPred has a working technical foundation, but we would not yet describe it as ready for a NAR proposal. The highest-value next step is a **validated workflow for choosing off-target sites to investigate experimentally**. Adding many predictors is a weaker strategy than making CRISPert's results useful, reproducible and demonstrably beneficial.

Recommended user journey:

**Enter a guide and identify its intended locus → discover candidates → inspect gene context and model rankings → select an experimental shortlist → export the evidence and methods.**

The contribution to test is whether this workflow helps users find relevant sites within a fixed experimental budget, or materially improves task completion compared with existing tools. This is a proposed research question, not an established result. A polished interface alone does not establish novelty or acceptance.

The council consisted of independent scientific, integration and usability reviews, followed by cross-review. See [science](science-council.md), [integrations](integrations-council.md), [usability](usability-council.md), and the decisions below. CasKAS and epigenetic inputs remain outside scope.

## What is already present

The [repository](https://github.com/Alexander-Mitrofanov/OfftargetPred-web-server) and [published interface](https://alexander-mitrofanov.github.io/OfftargetPred-web-server/) already provide:

- Three sequence-only CRISPert-small models, candidate-pair scoring, and GRCh38 primary-assembly NGG search within 0–4 protospacer mismatches.
- Examples, CSV/TSV import, highlighted alignments, filtering, sorting, CSV/JSON downloads and interpretation help.
- Public HTTPS access without accounts, asynchronous jobs, private recovery links, cancellation, deletion and 24-hour retention.
- Model/reference fingerprints, numerical inference checks, API tests and successful public browser acceptance. These establish technical behavior; they do not establish biological superiority.

These capabilities should be improved rather than proposed as new features. Evidence is in the [model card](../model-card.md), [API documentation](../API.md) and [launch validation](../validation/README.md). The live landing page was also inspected during this review and showed the prediction server connected.

## Publication conditions and unresolved questions

The current [NAR instructions](https://academic.oup.com/nar/pages/Submission_Webserver) announce rolling proposals from **November 2026** and a two-month manuscript window after approval. They require useful differentiation, independent predictive validation, interactive sample output, a visible standard licence permitting free noncommercial use, private submissions and at least five years of maintenance. Prior peer-reviewed method validation remains necessary for applications that could be used therapeutically; a research-use label does not resolve that classification. Ask about the exact CRISPert-small application in the proposal. Acceptance remains an editorial decision.

Our immediate readiness assessment:

| Area | Current evidence | Recommended action |
|---|---|---|
| Scientific provenance | Original inference is reproduced; exact training membership and some display claims remain unresolved | Complete the split/provenance audit before generalization claims |
| Distinctive benefit | Usable access to three models; no comparative workflow study yet | Test a specific biological decision and a user task against existing servers |
| Output usefulness | Sequence alignments and tables; no gene/exon context or genome-view links | Add annotation and an actionable shortlist |
| Demonstration | Loadable example inputs; no durable interactive result demonstration | Provide curated, frozen results using the real result component |
| Access and rights | Anonymous public service; no top-level service/source licence found | Confirm rights and publish appropriate licences and contact/citation information |
| Reproducibility | Hashed models and reference, export metadata; original weights remain private | Resolve redistribution permissions; archive the publication release and document reproduction |
| Operational commitment | Working de.NBI VM, GPU and persistent volume | Name maintainers, secure resources and demonstrate recovery and monitoring |
| User testing | Chrome-based acceptance and a mobile viewport | Test another browser engine and observe representative biologists completing tasks |

The [general author guidelines](https://academic.oup.com/NAR/pages/author-guidelines) also call for a code archive with a persistent DOI at revision or acceptance. A public GitHub repository alone is not that archive. Do not apply a licence to contributed checkpoints, data or third-party code until the relevant rights are established.

### New finding: evaluate the evaluation data first

The council's read-only audit found **one shared guide and 981 exact guide–candidate pairs** between the supplied full K562 file and supplied T-cell corpus described as training data. This does not prove which overlapping rows entered the final checkpoint training split, or invalidate a deliberately cross-cell experiment. It does mean the full K562 evaluation cannot simply be presented as entirely sequence-independent from that corpus. Numerical benchmark reproduction and independent biological validation are different claims.

The exact four-layer checkpoints must be documented separately from the published, larger CRISPert model. The interface's seed and held-out-data descriptions should be reconciled with verified provenance. See the [science review](science-council.md) and its aggregate audit for counts, interpretation and limitations. The original bundle and production files were not altered.

A second finding concerns search coverage: only **91 of 188 positive pairs** in the supplied full K562 file satisfy the candidate NGG-PAM and at-most-four-mismatch filters used by the genome mode. This is a sequence-filter count, **not measured genome-search recall**; reference presence and actual retrieval were not tested by this audit. Therefore a candidate-pair benchmark cannot stand in for validation of the complete search-and-score workflow. The [aggregate audit](dataset-audit.json) was independently rerun by the lead reviewer with identical output using the [read-only audit script](audit_dataset_overlap.py).

## Prioritized suggestion list

Effort bands are council estimates for an experienced developer familiar with this repository: **S** approximately 1–3 developer-days, **M** 4–10 days, **L** 2–6 developer-weeks. **Research** requires data, validation or new training and cannot responsibly be given a software-only completion date. Estimates exclude external permissions, procurement and wet-lab experiments, and overlap between related items; do not sum them mechanically.

### P0 — address before claiming proposal readiness

| # | Suggestion | Why it matters / definition of done | Effort |
|---|---|---|---|
| 1 | **Audit model and dataset provenance** | Recover actual training/split manifests if possible; reconcile guide counts, training seed and UI text. Publish aggregate overlaps and explicitly separate cross-cell transfer from unseen-guide testing. | M + author input |
| 2 | **Run an independent, fair benchmark** | Freeze models and decision rules before testing. Compare relevant baselines on identical candidates and separately test candidate discovery. Report per-guide performance, positive/negative counts, precision/recall at shortlist sizes, uncertainty and failures. | Research |
| 3 | **Develop two or three biological case studies** | Show how the server changes a concrete choice: candidate prioritization, interpretation of model disagreement, or evidence-based follow-up. Compare against the closest existing workflow and include unsuccessful cases. | M + research |
| 4 | **Publish licence, attribution, citation and support information** | Visible service terms; separately documented code, model and data permissions; named maintainers and contact; citation metadata, release notes and a DOI-backed publication release. | S–M + rights decisions |
| 5 | **Make long-term operation credible** | Written ownership/funding plan, stable institutional URL or gateway, uptime/readiness monitoring, tested rebuild/restore, update procedures and capacity measurements. Resolve recorded clock-sync and authentication-renewal follow-ups. | M + institutional commitment |

### P1 — the recommended submission workflow

| # | Suggestion | User benefit and acceptance criterion | Effort |
|---|---|---|---|
| 6 | **Accept a 20-nt spacer through a guided resolver** | Let users specify genome and intended locus, resolve the real genomic PAM and orientation, and confirm ambiguous matches. Never append an invented PAM; keep direct 23-nt input available. | M |
| 7 | **Annotate gene, transcript, exon and intron overlap** | Translate coordinates into biological context using a pinned local annotation release. Show all relevant overlaps, distinguish nearest gene from overlap, and avoid equating annotation with damage. | M |
| 8 | **Add a per-guide summary and useful filters** | Group candidates by guide; show mismatch distributions, genomic context, selected-locus status and candidate counts. Label summaries with the search limits; do not invent a genome-wide safety score. | M |
| 9 | **Link each locus to a genome browser and export BED** | Inspect the surrounding region without copying coordinates. Verify chromosome naming and strand-aware, zero-/one-based conversions. External navigation must be explicit and must never include the private job token. | S–M |
| 10 | **Compare models through ranks and disagreement** | On the same candidate set, show a rank-comparison plot and sites that change position across k=1/2/3. Describe disagreement as model sensitivity, not calibrated uncertainty; keep scores separate. | M |
| 11 | **Build a transparent experimental shortlist** | Users select sites with visible reasons—rank, model disagreement, gene context or their evidence—and export the selection. Predefine the candidate universe, selection rule and budget before testing recovery of assay-observed sites. | M + research |
| 12 | **Provide a one-click interactive demonstration** | Frozen, provenance-labelled sample results load instantly and remain usable during backend outages. Include normal output, multiple exact matches, no hits and an input error; explain what each teaches. | S–M |
| 13 | **Export a complete analysis package** | Download full and selected results, BED, reference/model identifiers, settings, annotation versions and a readable methods summary. Mark filtered subsets and distinguish job expiry from file reproducibility. | M |
| 14 | **Simplify the first-run experience and test it with biologists** | Keep k=1 as the easy starting point with comparisons under advanced options. Add a column-mapping preview and actionable row errors. Observe 5–8 representative users; record completion, errors and interpretation, then revise. | M |
| 15 | **Strengthen accessibility and job recovery** | Audit keyboard, screen-reader, contrast, zoom and narrow screens; retain existing accessibility features. Provide a selectable recovery-link fallback when clipboard access fails, visible expiry, and clear queue/error recovery. | M |

### P2 — useful integrations after the core workflow

| # | Suggestion | Feasible scope and conditions | Effort |
|---|---|---|---|
| 16 | **Add a local CFD baseline** | Useful context beside CRISPert after implementation/parameter licensing and numerical parity checks. Score the same compatible candidates; handle unsupported inputs explicitly. MIT is optional, not another compulsory column. | M |
| 17 | **Import outputs from CRISPOR, CHOPCHOP and Cas-OFFinder** | Provide tested format adapters with a preview of guide/PAM, strand, coordinates and genome build. Preserve source identifiers and provenance. Do not silently submit sequences to another server. | M per format family |
| 18 | **Import experimental evidence** | Join user-provided GUIDE-seq/CIRCLE-seq-style site tables by explicit coordinates/build or sequence, retaining ambiguity when a sequence matches several loci. Keep assay labels/read counts distinct from predictions; unmatched or unobserved sites are not automatically true negatives. | M–L |
| 19 | **Embed a genome view with IGV.js** | Start with selected loci and pinned gene/candidate tracks. Lazy-load it; retain an accessible table. Audit remote requests and protect capability-bearing data. Browser links/BED can ship first. | M |
| 20 | **Provide an API reference client and reproducible local package** | A small Python example should submit, poll, download and handle expiry/rate limits. A pinned container can support local reproduction once model distribution is resolved; Galaxy integration follows demonstrated demand. | S client; M–L packaging |
| 21 | **Support gene/interval input and guide discovery** | Resolve gene identifiers/transcripts and enumerate eligible NGG guides from a bounded region; explicitly select intended loci. Add on-target efficiency only with a separately validated, compatible predictor. | L |
| 22 | **Extend search scope selectively** | First measure missed sites and cost of wider mismatch/PAM enumeration; compatible ungapped 23-mers do not inherently need a new architecture, but do need validation. Add mouse/GRCh37 only with demand, pinned references and annotation/transfer checks. | M–L + validation |
| 23 | **Help prepare experimental follow-up** | Optional local Primer3 amplicon design and exports for downstream amplicon analysis, with specificity checks and reference provenance. Treat primer design as a separate validated function. | L |
| 24 | **Improve throughput and fairness using measurements** | Measure search versus inference time, queue delay and shared-laboratory-IP effects. Consider verified-reference caching and model reuse without weakening job isolation or privacy. Show realistic progress and retry guidance. | M–L |
| 25 | **Expose a benchmark and limitations page** | Interactive per-guide/per-dataset results, candidate-discovery recall, score distributions and known failure modes, generated from the frozen evaluation. Downloadable benchmark provenance makes the scientific claim inspectable. | M after #1–2 |

### P3 — research extensions, not a release checkbox

| # | Suggestion | Why it must be gated |
|---|---|---|
| 26 | **Bulge-aware discovery and scoring** | CRISPRitz/CRISPRme-style discovery can produce gapped candidates, but current 23-nt models cannot represent them. Either display them explicitly as unscored or develop and validate a compatible model. Never remove gaps merely to obtain a score. |
| 27 | **Variant-aware and haplotype-aware prediction** | Requires allele-aware search, reference/variant provenance, representative validation, substantial compute planning and a data-handling design for individual genomes. Public variant annotation is a smaller, separate first step. |
| 28 | **Calibrated estimates or a learned model combination** | Requires independent calibration and a final untouched test set with relevant prevalence. Averaging the current outputs or calling disagreement a confidence interval is not sufficient. |
| 29 | **Sequence sensitivity explanations** | Perturbation maps could show how a model reacts to bases or mismatches. Validate their stability and utility; do not present attention weights or perturbations as proven molecular mechanisms. |
| 30 | **Other nucleases or editing modalities** | Cas12, high-fidelity Cas9 variants, base editors and prime editors need compatible inputs, task definitions and training/evaluation data. The existing three checkpoints do not establish support. Expanding compatible ungapped SpCas9 PAM/mismatch searches is the separate, smaller question in #22. |

## Council discussion and decisions

| Question debated | Council decision | Reason |
|---|---|---|
| Add many predictors or improve one complete workflow? | Prioritize the CRISPert interpretation-to-shortlist workflow; add at most one contextual baseline initially | Existing tools already offer multiple scores; the new benefit must be measured |
| Is the reproduced K562 benchmark enough? | No; audit sequence overlap and obtain independent evidence | Matching previous numbers demonstrates implementation parity, not an unseen-guide evaluation |
| Make an ensemble or a single guide-risk score? | Defer | No validated aggregation, calibration or complete candidate universe currently supports those claims |
| Embed a large genome browser immediately? | Ship locus links and BED first; IGV.js next if user tasks justify it | Fast access to context with less interface and maintenance complexity |
| Add personalized genomes or bulges for impact? | Keep as separate research projects | Candidate discovery support does not confer model validity; variants also change operational requirements |
| Build primers, gene design and full sequencing analysis now? | Keep outside the minimum submission bundle | Useful later, but they expand scope beyond the immediate interpretation and validation workflow |
| Is a human-only first release too narrow? | Keep a well-evaluated human workflow first | Species count alone does not establish useful breadth or scientific novelty |

The proposed distinctive feature is **transparent experimental prioritization informed by three separately reported model outputs**, with genomic context and reproducible evidence. Whether it outperforms an established workflow remains to be tested. Model disagreement is not automatically useful; it can be redundant or misleading, and the study must allow that outcome. The 20-nt resolver is a usability recommendation, not a journal-mandated feature; an effective 23-nt workflow remains valid.

If a shortlist policy is tuned using disagreement or annotation, develop it on separate guides and evaluate it on an untouched final set; group repeated guides across cell datasets together. Use nested guide-level validation if no separate final set is available, and state that limitation. Claims about manual selection need a blinded or counterbalanced user study, or prospective follow-up, rather than a retrospectively chosen attractive shortlist. The three checkpoints also differ in pretraining, so their comparison is not a controlled experiment isolating only k-mer size.

## Recommended order of work

1. **Evidence and claims:** #1, benchmark design for #2, rights/attribution #4, and maintenance ownership #5. Correct unsupported public descriptions once the underlying facts are resolved.
2. **A complete useful workflow:** #6–15, starting with annotations, locus links, grouped results and a durable interactive example. Freeze a usable release before user studies.
3. **Demonstrate the benefit:** finish #2–3 and #25; compare the complete workflow with the closest alternatives. Use separately held-out development and final evaluation data.
4. **Select integrations from actual demand:** CFD, external-format imports, experimental evidence and the API client. Add IGV.js if users need it; avoid making every optional integration a submission dependency.
5. **Prepare a proposal only after the evidence supports it:** document the exact model lineage, application scope, comparison, biological use cases and maintenance commitment. Clarify the therapeutic-classification question with the editor through the normal proposal process.

There is no credible guaranteed acceptance date from the current evidence. A bounded software milestone is possible; scientific validation, permissions and editorial judgment remain separate dependencies.

## Review artifacts

- [Scientific review](science-council.md): provenance, evaluation design, novelty and scientific extensions.
- [Integration review](integrations-council.md): tools, deployment choices, compatibility and licensing checks.
- [Usability review](usability-council.md): current interface findings, prioritized journeys and acceptance criteria.

This report is a planning artifact. Proposed features, validation studies, licences, monitoring and archival deposits have **not** been implemented or claimed complete by this review.
