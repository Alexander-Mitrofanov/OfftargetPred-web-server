# NAR improvement implementation

This release tracks work against the 30-item [council backlog](../nar-readiness/README.md).
Implemented web workflows, partial deliveries and deferred research extensions
are reported separately; this is not a claim that every proposed extension ships.
Each numbered improvement has a dedicated worker. The coordinator integrates
shared files, verifies interactions, deploys a tested release, and commissions a
fresh independent council after implementation. A scientific or institutional
dependency is recorded as such; it is never replaced by a simulated feature.

## Interface direction

Retain the existing scientific workbench: paper white `#ffffff`, cool background
`#f5f8fb`, navy text `#16334a`, blue actions `#1266a8`, teal comparison `#087f79`,
and grey-blue boundaries `#d7e2ea`. Keep the system sans-serif for explanations
and the existing monospace stack for sequences only. Left-aligned, compact
scientific typography; readable explanations stay below about 80 characters.

The characteristic view is the aligned guide/candidate sequence linked to its
genomic context and separate model ranks. Keep the primary action straightforward;
progressively reveal research tools in labelled sections. Use real data and clear
scope, not ornamental dashboard counters. Preserve keyboard operation, text
alternatives and mobile access to scores.

```text
Predict | Examples | Evidence | Help | About
Input: known candidates / genome search / guide or region resolver
Completed analysis: scope + guide summary
Candidates: filters + alignment + models + genomic context + selection
Optional: compare ranks / experimental evidence / sensitivity
Export: full results / selected shortlist / reproducible analysis package
```

This extends the established CRISPRoff-inspired interface. Each added panel must
answer a researcher task; keep extensive model/operations detail in help and
the evidence page. The three model outputs must remain distinguishable.

## Status register

| # | Improvement | Dedicated worker | Status |
|---|---|---|---|
| 1 | Provenance audit and claims | improvement_01_provenance | Implemented; claims/provenance integrated |
| 2 | Checkpoint diagnostics | improvement_02_benchmark | Frozen four-method diagnostics on 87,294 rows; independent benchmark claim remains unsupported |
| 3 | Public-reference worked examples | improvement_03_cases; improvement_03_case_review | Implemented and independently checked; 15/13/0-hit and invalid-input demonstrations; manuscript biological case remains external |
| 4 | Licence/citation/support | improvement_04_licence | Implemented; MIT, citations and support integrated |
| 5 | Long-term operations | improvement_05_operations | Implemented; VM probes and config restore pass; NTP and institutional ownership unresolved |
| 6 | Spacer/PAM resolver | improvement_06_resolver | Implemented; integrated and API-tested, staged reference ready |
| 7 | Genomic annotations | improvement_07_annotations | Implemented; full GRCh38 annotation index staged |
| 8 | Guide summaries/filters | improvement_08_overview | Implemented; full-result summaries and zero-hit guides integrated |
| 9 | Browser links/BED | improvement_09_browser | Implemented; browser links and BED with explicit skipped-row export |
| 10 | Model comparison | improvement_10_comparison | Implemented and integrated; 12 rank-math tests |
| 11 | Experimental shortlist | improvement_11_shortlist | Implemented; selection rules, ties and notes verified in browser export |
| 12 | Interactive examples | improvement_12_examples | Implemented; Chromium/Firefox offline demonstrations pass |
| 13 | Analysis exports | improvement_13_exports | Implemented and integrated; 10 VM export tests |
| 14 | First-run usability | improvement_14_input | Implemented; mapping/first-run guidance, browser checks pass; human study pending |
| 15 | Accessibility/recovery | improvement_15_recovery | Implemented; 28 workflow checks and 10 axe states per browser, plus navigation-state/ZIP regression in both browsers |
| 16 | CFD baseline | improvement_16_cfd | Implemented; CFD integrated and reference-tested |
| 17 | Tool imports | improvement_17_imports | Implemented; strict importers, provenance and API metadata normalization |
| 18 | Experimental evidence | improvement_18_assay_evidence | Implemented; browser-local evidence with complete separate ZIP export |
| 19 | Embedded genome view | improvement_19_viewer | Implemented as local sparse-context SVG/table; both browsers pass; full IGV regional tracks not claimed |
| 20 | API/local package | improvement_20_client | Client and CPU image implemented; 31 client tests, 21 real container API checks and real CLI workflow pass |
| 21 | Gene/interval discovery | improvement_21_discovery | Implemented; both-strand reference discovery and exact annotation lookup, both browsers pass |
| 22 | Search scope | improvement_22_scope | Assessment and aggregate eligibility audit complete; wider search/assemblies deferred |
| 23 | Experimental preparation | improvement_23_flanks | Reference-flank export integrated and verified in both browsers; validated primer design deferred |
| 24 | Performance/fairness | improvement_24_performance | Implemented; measured stages/timings, eight isolated V100 jobs, NAT limitation explicit |
| 25 | Diagnostic evidence page | improvement_25_evidence_page | Implemented; frozen report with overlap-aware strata, offline browser checks pass |
| 26 | Bulge-aware extension | improvement_26_bulges | Assessed and guarded; incompatible gapped scoring deferred |
| 27 | Variant/haplotype extension | improvement_27_variants | Assessment complete; variant-aware discovery and haplotypes deferred |
| 28 | Calibration/combination | improvement_28_calibration | Assessment complete; calibration and ensemble claims deferred pending independent data |
| 29 | Sensitivity view | improvement_29_sensitivity | Implemented; 61-pair explicit workflow, real three-model V100 repeat check and both browsers pass |
| 30 | Other nucleases/editors | improvement_30_nucleases | Assessment complete; other nuclease/editor modes deferred |

## Decisions from the user

- Publication positioning: an easy-to-use web interface for the already published
  CRISPert tool. Prioritize usability, integration and reproducibility; a new
  algorithm or a claim of scientific novelty is not the objective. Existing-model
  checks must support accurate descriptions, not become an unrelated research
  programme. The independent council must evaluate this web-server framing.
- MIT licence for the web-server code they own.
- Use the de.NBI VM for compute-heavy evaluation and preparation.
- Model/data redistribution permissions, original split manifests and the named
  institutional maintenance commitment remain awaiting clarification.

Workers follow [shared integration contracts](CONTRACTS.md). Their delivery notes
record actual implementation, verification and unresolved requirements.
