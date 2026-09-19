# Improvement 15 — accessibility and private-job recovery

## Delivered

- `frontend/src/components/PrivateJobRecovery.tsx` and `.css`: labelled read-only
  private link, Copy button, manual-copy selection/fallback, explicit expiry, and
  a clear distinction between server results and browser-only analysis edits.
- `frontend/src/features/jobRecovery.ts`: strict UUID/capability validation,
  unambiguous fragment parsing, private-link construction that preserves deployment
  paths and strips unrelated query/hash content, and safe clipboard failure.
- `tests/frontend/jobRecovery.test.ts`: four focused privacy and recovery tests.
- `tests/browser/accessibility.py`: repeatable Chromium/Firefox audit against
  isolated localhost staging, using local axe-core 4.11.0. It never submits a
  prediction job or accesses a real private job.
- `docs/accessibility.md`: behavior, reproducible commands and pending human checks.

The coordinator integrated the new panel in completed and in-progress jobs and
used the validators for both fragment and session credentials.

## Findings corrected during the audit

1. Plain `<code>` sequence elements had prohibited accessible-name attributes;
   visual sequence groups now have an appropriate labelled image role and hidden
   individual bases, while mismatch positions remain available in text.
2. The PAM legend had 4.37:1 text contrast; its foreground was darkened.
3. The scrolling provenance block was not keyboard focusable; it is now a named,
   keyboard-focusable region.
4. Expanded model-comparison statistics placed descriptions outside definition
   values. Supporting text now sits within the matching `<dd>` elements.

The first three were integrated by the coordinator. The fourth is the worker's
narrow authorized correction in `ModelComparison.tsx`.

The audit also identified that a capability fragment opened in an already-loaded
app document was not processed by the navigation handler. This integration issue
was corrected by the coordinator after the full audit; a focused follow-up check of that new handler remains appropriate.

## Verification

Four helper tests and the final integrated TypeScript build passed on de.NBI.
Chromium 153.0.8010.12 and Firefox 155.0 each passed 27 workflow/layout checks
and 10 axe-core 4.11.0 scan states with zero detected violations and no JavaScript
errors. The compact evidence is `15-accessibility-checks.json`; raw reports and
viewport screenshots are in `output/accessibility/` (local and staging).

The audit includes keyboard skip-to-main, visible focus, candidate selection and
result announcements, all navigation pages at 320/390 px, active model comparison,
expanded details, 200% equivalent reflow, blocked API input preservation, expired
access removal, denied clipboard fallback, and recovery after refresh. Real screen
reader users and native platform browser zoom remain pending; automated checks do
not establish full WCAG conformance.

## Operational scope

No production service, existing model or model score changed. Axe is installed in
isolated staging test tooling, outside the application dependency tree. No new
persistent storage of raw sequence or experimental data was added. Private links
remain capability URLs and should be kept private.
