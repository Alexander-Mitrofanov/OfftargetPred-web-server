# Independent council after implementation

**19 September 2026 · OfftargetPred 0.2.0**

## Decision

The three independent reviewers agree: **a usable web interface to published
CRISPert is an appropriate NAR Web Server Issue contribution**. A new prediction
algorithm or the deferred research extensions are not prerequisites for that
framing. The implemented workflow is a credible candidate for submission after
the bounded author and service-owner work below. This is not a guarantee of
editorial acceptance.

The contribution is a connected researcher task: prepare a guide or candidate
table, inspect genomic context and separate model rankings, select candidates,
and preserve the analysis. [Current journal instructions](https://academic.oup.com/nar/pages/Submission_Webserver)
accept usability as a benefit while retaining expectations for validation,
useful biological cases and maintained public access.

## Independent discussion and software findings

| Reviewer | Conclusion and action |
|---|---|
| [Usability](final-usability.md) | Useful published-method workflow. Found that Help navigation discarded browser-local edits. The coordinator retained workspaces in memory and verified selections, reasons, observations and ZIP contents in Chromium and Firefox. |
| [Reliability](final-reliability.md) | No additional established P0/P1 privacy or backend defect. Found release-file permissions could prevent service imports. The installer now establishes read access for public source while keeping private artifacts under their separate permission policy. Exact-release service-user and public checks are deployment acceptance steps. |
| [Publication](final-publication.md) | No new-method claim is needed. Existing model evidence must be tied accurately to these checkpoints; interface tests do not establish training-independent predictive validity. |

The reviewers exchanged findings before their conclusions. They did not implement
the feature set and distinguish their source reviews from coordinator-executed
tests. See [integration verification](../implementation/INTEGRATION.md) for test
results and the final deployment addendum. The initial [30-item planning council](README.md)
is historical; the [implementation register](../implementation/README.md) records
what shipped, partial deliveries and explicitly deferred extensions.

## Bounded submission work

1. **Published validation and provenance:** ask the model authors to identify the
   published evaluation corresponding to these exact checkpoints and clarify
   training/model-selection history. Reuse adequate existing evidence; do not
   claim supplied overlapping datasets are an independent test.
2. **Manuscript case and comparison:** show an author-supported biological
   question and a practical comparison with relevant web servers. Public workflow
   demonstrations already exist; they are not experimental validation or a
   completed biological-insight study.
3. **Rights and archive:** establish upstream tokenizer/model hosted-use and
   relevant redistribution permissions. MIT covers project-owned work only.
   Archive distributable software under the journal's repository or supplementary
   material route; no software DOI has been assigned.
4. **Service ownership:** supply authors/affiliations, primary and backup contacts,
   resource ownership and a five-year maintenance commitment. Resolve approved NTP
   reachability and assign authentication renewal and recovery responsibilities.

Researcher usability observation and manual assistive-technology testing are
recommended follow-ups, not universally prescribed participant studies. No such
study is claimed. Wider assemblies/PAMs, bulges, haplotypes, calibration, learned
ensembles, validated primer design and other editors remain optional scoped
projects, not hidden dependencies of this release.
