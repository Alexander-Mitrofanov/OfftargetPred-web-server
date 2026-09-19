# Independent council review: researcher workflow and usability

Reviewed 19 September 2026 for the proposed 0.2.0 release. This reviewer did not
implement its features. The review covers the current source and recorded test
evidence; it does not assess the older release still public during the review.

## Verdict

**A credible web-interface contribution for published CRISPert, conditional on
completing public release acceptance.** The identified workflow defect has been
corrected and its regression checks pass. The contribution
is a usable path from researcher input to interpretable, recoverable and
exportable results. It does not depend on a new prediction algorithm, retraining,
bulges, haplotypes, additional nucleases or calibrated probabilities.

The current [NAR Web Server Issue instructions](https://academic.oup.com/nar/pages/Submission_Webserver)
allow usability to establish benefit over existing tools and allow previously
described software. They emphasize useful, functional web access, interactive
examples, interpretive help, rich output, private results and testing in multiple
browsers. An author should still explain the interface's added value and compare
similar websites. Workflow demonstrations are distinct from the biological-insight
use cases requested for a manuscript. A participant study would strengthen
usability claims; it is not stated as a mandatory prerequisite in these
instructions. Editorial suitability remains an editorial decision.

## Release-significant finding

### Resolved P1 — In-app help navigation discarded browser-local analysis work

At initial inspection, `App.tsx` rendered the prediction workspace only when its
current page was Predict. Choosing Help, About, Evidence or Examples unmounted
that workspace. `AnalysisWorkspace.tsx` stored selected candidate keys, filters,
selection notes and applied experimental evidence in component state. Its own
**Interpretation guide** link went to Help. Returning to Predict therefore
recreated the result workspace and silently discarded the researcher's local
work, even though the server results remained available. The Examples workspace
had the same lifetime issue when leaving its navigation page.

This is a concrete supported-workflow defect: a researcher can reasonably consult
interpretation guidance midway through shortlisting. Existing warnings about
refreshing or closing the page did not describe this in-app loss.

**Required correction:** retain the current live and example workspaces in
memory during navigation, or lift their complete editable state into a stable
owner. Keep hidden content out of keyboard navigation and the accessibility tree.
Do not solve this by persisting raw experimental data in browser storage.

**Acceptance:** select candidates, create shortlist notes and apply observations;
visit Help and another navigation page; return to the analysis; confirm state,
open sections and the downloaded ZIP still contain the same selections, notes
and observations. Check a live-job presentation and a recorded example in both
supported browsers. A new job or deliberately changed example may start a new
workspace, with that boundary made clear.

The coordinator confirmed the defect and changed `App.tsx` to retain the
prediction workspace and a visited Examples page in hidden containers. This
reviewer inspected that correction: it keeps state in memory and uses the native
`hidden` attribute for inactive pages. The coordinator executed
`tests/browser/navigation_state.py` in Chromium and Firefox after the correction:
both passed. The test covers the Predict workspace using a synthetic job-access
fixture and recorded Examples, preserving selected candidates, rule reasons and
applied observations through Help/About navigation. It independently checks ZIP
CRC and exported selection, notes and observation content. This reviewer inspected
the regression source; the coordinator, not this reviewer, ran the browsers.

The coordinator also repeated the full accessibility audit after the correction:
28 workflow/layout checks and 10 axe states passed in each browser, with zero
detected violations or JavaScript errors. The P1 finding is resolved. No other
P0 or P1 usability defect was identified in this bounded source/evidence review.
This is not a claim of exhaustive defect absence.

## What supports the contribution

| Researcher task | Current implementation and supporting evidence |
| --- | --- |
| Choose a starting point | Candidate pairs and Genome search are labelled by the researcher's intent. k=1 is the default and additional models are disclosed separately. No account or email is required. |
| Supply a valid query | The form counts 23 bases, explains actual PAM requirements, distinguishes a missing PAM from invalid letters and offers a local reference resolver. Explicit column mapping and supported tool imports preview errors instead of dropping rows. See [input delivery](../implementation/14-input.md) and [import delivery](../implementation/17-imports.md). |
| Begin from a biological region | Exact gene/Ensembl lookup and bounded interval discovery find reference NGG sites on both strands. Choosing a guide fills the form without submitting it. This is preparation, not an on-target-efficiency claim. See [discovery delivery](../implementation/21-discovery.md). |
| Learn without waiting for a job | Frozen 15-, 13- and zero-candidate examples use the same result workspace; the missing-PAM example contains the actual error and no invented score. API-blocked Chromium and Firefox checks support independent example exploration. See [worked cases](../case-studies.md), [independent case review](../implementation/03-case-review.md) and [examples delivery](../implementation/12-examples.md). |
| Understand what was computed | Search scope, actual selected reference locus, separate model scores, mismatch positions and reference annotations are visible. Help distinguishes uncalibrated scores, within-model ranking, incomplete supplied candidate lists and zero-hit scope. Unknown/unsupported values are not presented as zero. |
| Inspect and prioritize candidates | Full-result summaries, filters, per-guide ranks, linked sequence alignments and a local genome view support review before shortlisting. Optional evidence and sensitivity panels remain separate from model predictions and require explicit actions. |
| Keep reproducible work | Full/filtered/selected exports have separate meanings. ZIPs include complete results, settings, provenance, selection notes, citations and separate applied observations including ambiguous/unmatched rows. Coordinate exports record skipped rows and reasons. See [exports delivery](../implementation/13-exports.md) and `tests/browser/evidence_export.py`. |
| Recover a long-running analysis | A private link is available while queued/running and after completion, with expiry and sharing implications explained. Manual copying works without clipboard permission. Retry and forget-access paths handle unavailable or expired jobs. See [recovery delivery](../implementation/15-recovery.md). |
| Use a narrow screen or keyboard | Native labelled controls, a skip link, visible focus, non-colour mismatch cues and named horizontal table regions are implemented. Recorded audits cover 320/390 CSS-pixel widths, expanded result sections and keyboard operations in Chromium and Firefox. |

The most persuasive manuscript description is the connected workflow above,
illustrated with a meaningful computation and its outputs. A long inventory of
features would obscure the benefit. The interface's main path can stay short
because optional analysis tools are disclosed beneath the primary results.

## Evidence reviewed and its limits

- Source inspection: `App.tsx`, `AnalysisWorkspace.tsx`, `ExamplesPage.tsx`,
  `InputGuide.tsx`, `GuideResolver.tsx`, `PrivateJobRecovery.tsx`,
  `ShortlistBuilder.tsx`, `AssayEvidence.tsx`, `AnalysisExports.tsx` and
  `ServiceInformation.tsx`.
- Implementation register, integration record, worked examples and their
  independent follow-up review; focused input, discovery, import, export,
  example and recovery records.
- `tests/browser/accessibility.py` and the committed
  `15-accessibility-checks.json` originally recorded 27 workflow/layout checks
  and 10 axe states in each of Chromium 153 and Firefox 155. After adding the
  same-document recovery check and correcting navigation lifetime, the coordinator
  executed the full audit again: 28 checks and 10 states passed in each browser,
  with zero detected violations or JavaScript errors.
- `tests/browser/navigation_state.py`: source reviewed independently; Chromium
  and Firefox execution performed by the coordinator. These are synthetic
  private-job presentation and recorded-example checks, not new live predictions.
- Browser scripts for local evidence export and their intended data-preservation
  assertions. Prior implementation records also cover reference context,
  sensitivity and flank preparation in both browsers.
- The coordinator reports 607 passing backend checks, 163 passing frontend
  checks and a successful production build before this council review. This
  reviewer did not independently rerun those tests or submit new model jobs.

These observations support implemented usability provisions. They do **not**
establish that representative biologists complete tasks faster, prefer this
interface or choose better experimental candidates. The
[usability-study protocol](../usability-study.md) remains an unperformed study.
Automated axe scans likewise do not establish complete WCAG conformance or
successful screen-reader use; [manual accessibility checks](../accessibility.md)
remain pending. No such claim should enter the website or manuscript without
the corresponding evidence.

## Bounded next actions

1. Keep the passing navigation regression in release acceptance; the reported
   lifetime defect is resolved.
2. Record final two-browser acceptance against the exact released frontend and
   backend, including one real pair job and one reference-search job. Keep public
   demonstration checks distinct from authenticated live-job checks.
3. Have 5–8 representative researchers attempt the existing protocol, prioritize
   observed misunderstandings and report actual outcomes. Include the missing-PAM
   correction, search-scope interpretation, shortlist export and help navigation.
   This is recommended evidence for usability, not a reason to build a new model.
4. Complete representative assistive-technology and native zoom checks before
   claiming accessibility conformance.
5. For the manuscript, provide an author-supported biological question/use case
   and a concise comparison of how similar web tools handle the same practical
   workflow. Cite published CRISPert and distinguish unchanged method capability
   from the new web-access and interpretation work.

Institutional maintenance, rights, archival identifiers and predictive-validation
provenance are addressed by the publication and reliability council reviews;
this usability verdict does not waive them.
