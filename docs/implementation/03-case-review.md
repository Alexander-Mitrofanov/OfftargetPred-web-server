# 03 — Independent worked-example review

Reviewed on 19 September 2026 by a dedicated follow-up worker, separate from the
worker that generated the examples. Scope: accuracy and instructional usefulness
of the public worked examples for the web interface to published CRISPert.

## Findings

The frozen documents support the documented observations:

| Example | Checked observations |
| --- | --- |
| Reference walkthrough | 15 rows: 13 exact spacers and two one-mismatch spacers; five full 23-base matches; exactly one selected locus at chromosome 1 `[100056,100079)`, plus strand. |
| Multiple exact matches | 13 rows, all exact spacers; five full 23-base matches and eight differences at the first PAM base; both strands; no selected intended locus. |
| No hits | Zero rows, completed presentation job, zero metadata candidate count, and the submitted synthetic guide retained. |
| Missing PAM | Recorded HTTP 422 message for a 20-base input; no document, document hash or completed job. |

All three result-document SHA-256 values match the manifest. The stored reference
interval corresponds to the documented 1-based inclusive interval
100057–100079. The correction example correctly uses the shorter spacer interval
100057–100076; the resolver can retrieve its adjacent PAM outside that interval.
No model or frozen result was changed.

## Documentation improvements

Updated [Guided examples](../case-studies.md) with actual interface labels and
decisions a reader can reproduce:

- Open recorded results without submitting; distinguish offline result
  exploration from reference-backed tools and explicit job submission.
- Distinguish the originally chosen reference locus from result-row checkboxes
  used to create a shortlist.
- Explain the 5-of-13 exact-match filter and the complementary eight rows, and
  preserve the full candidate set when exporting a shortlist.
- Distinguish a complete zero-hit search from a filtered empty view, then check
  the recorded reference and search scope before changing a real query.
- Give the exact missing-PAM resolver fields and expected corrected sequence.
- State separately what a workflow demonstration, biological-insight use case
  and actual participant usability study would establish.

These changes keep the contribution focused on access to the published method
and interpretable results. They make no claim of new-method novelty, biological
superiority or measured improvement in researcher task completion.

## Review method and limits

Read the manifest, all three frozen JSON results, the original delivery record,
the focused demonstration tests, and the current Examples, result workspace,
filters, ranking, export and resolver components. Independently recomputed the
document hashes and basic row/count/strand/locus observations using JSON reads.
Checked the new instructions against the component labels and behavior.

This follow-up ran no model inference or live jobs and performed no new browser
or participant study. The original worker's **12 passing VM tests**, including
direct reference-sequence checks, remain recorded in
[03-cases.md](03-cases.md). Broader integration and browser acceptance belong to
the release verification; this documentation review does not replace them.
