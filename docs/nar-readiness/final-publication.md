# Independent final council: publication positioning

Reviewed **19 September 2026** against the implemented source and its evidence
records. This reviewer did not develop the improvements or rerun inference.
The coordinator reports 607 backend and 163 frontend tests passing, plus a
successful frontend build; final browser acceptance and public deployment were
still in progress when this review began. Earlier public-launch reports describe
the earlier release, not acceptance of every new feature.

## Verdict

**A credible NAR Web Server Issue candidate after bounded submission work.**
The appropriate contribution is accessible, interpretable access to the
published CRISPert method. A new prediction algorithm, extra nuclease models,
bulges, personal genomes or a learned ensemble are unnecessary for that framing.
The present records do not yet support an unconditional publication-ready claim.

The strongest story is one complete task: supply or find a guide, examine
candidates with genomic context and separate model rankings, record a shortlist,
and export a reproducible analysis. Lead with that task and demonstrate why the
interface helps its intended researchers. A count of integrations is a weaker
argument than showing this workflow clearly.

## What the current policy says

NAR permits a clear usability benefit and previously published software. It
expects a working, simple, freely accessible service with interactive examples,
interpretation help, rich output, privacy, HTTPS and a visible standard licence.
Predictive applications still need training-independent validation evidence;
manuscripts should compare relevant tools and include biological-insight use
cases. Five-year maintenance is expected. Prior publication of the same or an
essentially similar server invokes a two-year interval; authors should disclose
the CRISPert publication rather than assume the editor's classification.
Proposals become rolling from November 2026, with invitation before manuscript
submission. [Web Server Issue instructions](https://academic.oup.com/nar/pages/Submission_Webserver).

Code supporting the manuscript must have a permanent archive: a public DOI
repository **or supplementary material**. GitHub alone is insufficient. The
archive must contain material its authors can distribute.
[Software and source-code policy](https://academic.oup.com/nar/pages/data_deposition_and_standardization).

These are policy summaries. A participant usability study, a particular sample
size, a new benchmark, new wet-lab experiments, and an institutional domain are
not imposed here as universal journal requirements.

## Evidence already available

| Area | Assessment of this implementation |
| --- | --- |
| Published-method attribution | The [model card](../model-card.md), citation metadata and About page identify CRISPert and distinguish the supplied four-layer checkpoints from broader paper results. No CasKAS claim is made. |
| Useful interface | Guided PAM resolution, bounded gene/interval discovery, mapping/import previews, annotations, separate ranks, transparent selection, context and exports support the proposed researcher task. |
| Demonstrations | [Four guided cases](../case-studies.md) explain genuine recorded output, multiple exact matches, no hits and a missing-PAM error. They are correctly labeled software demonstrations. |
| Predictive claims | Uncalibrated scores, model/pretraining differences, search limits and unknown training membership are disclosed. Overlap-aware diagnostics and inference parity support artifact characterization, not proof of an untouched test. |
| Reproducibility | Checkpoint/reference hashes, methods metadata, API/client, analysis packages and a tested CPU container provide concrete implementation evidence. Private model availability remains a separate dependency. |
| Licence and support | Project-owned code has MIT terms and a public issue route. Upstream rights and the long-term maintenance commitment remain unresolved. |

The [extension assessments](../extensions/calibration.md) appropriately avoid
inventing unsupported model capabilities. Their deferral does not weaken the
current interface's stated contribution.

## Conditions to close

1. **Finish release acceptance.** Resolve the navigation-state loss identified
   by the usability council and the release-file readability defect identified
   by the reliability council. Verify retained edits, service-user imports and final workflows, and
   preserve the actual public release/browser/API evidence. Align citation,
   licence documentation, changelog and release identifiers. These are software
   acceptance items, not a request for more research features.
2. **Connect existing predictive evidence to the served artifacts.** Obtain
   author confirmation of the relevant published model/evaluation correspondence
   and original split/selection history where available. Existing published
   evidence may suffice; this review does not automatically demand a new study.
   The current supplied-data reports alone cannot establish independence:
   K562 shares one guide and 981 pairs with the reported training corpus, and
   actual training/model-selection exposure is unknown. If the correspondence
   cannot be supported, agree a narrowly scoped evidence plan before making
   generalization claims. See [provenance](../science/README.md).
3. **Write the manuscript's practical comparison and case.** Use a reproducible
   biological question with appropriate public or authorized evidence and a
   supported interpretation. Reanalysis of existing evidence can be suitable;
   new experimental data are not inherently necessary. Existing walkthroughs
   teach the interface but do not establish biological insight. Compare the
   actual supported tasks and input/search assumptions with relevant servers;
   do not imply that extra interface features establish predictive superiority.
4. **Resolve rights and archive scope.** Confirm upstream tokenizer distribution
   and hosted use of the supplied models. The tokenizer is already included in
   source; an MIT exclusion supplies no missing permission. Separately establish
   any intended weight/data redistribution rights, or document lawful access
   without including those artifacts. Review [licensing](../licensing.md), then
   archive only distributable release material. No software DOI exists yet.
5. **Obtain owner commitments and submission details.** Name the responsible
   authors, affiliations, corresponding author and operational owner; record
   resources and responsibility for continued service and renewals. The project
   currently has no documented five-year commitment. Prepare the proposal with
   accurate prior-publication disclosure and the intended research-use scope.

## Recommendations, not extra eligibility gates

Observe representative researchers completing the first-run and interpretation
tasks, then fix demonstrated problems. The existing study protocol has not been
executed. Automated browser/accessibility checks establish technical behavior;
they do not measure researcher task time, comprehension or satisfaction. Report
measured improvements only after collecting those observations. Manual assistive
technology checks would complement the automated audit.

The usability and reliability reviewers agree on the distinction between
software completion and author-owned publication evidence. They identified
navigation and release-permission defects for correction; this report does not
treat them as already fixed. The reliability review also identified outdated
deployment wording calling the supplied evaluation a held-out benchmark; it
should describe checkpoint diagnostics and their recorded provenance instead.
No misleading new-method, independent-test, biological-insight or calibrated-
probability claim was found in the inspected current interface and model card.
Editorial suitability and acceptance remain decisions for the journal after
reviewing the actual proposal and evidence.
