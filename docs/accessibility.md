# Accessibility and recovery

OfftargetPred provides keyboard-operable forms and result controls, labelled
sequence alignments, visible focus, a skip link, and horizontally scrollable
result tables. Mismatches have an underline and a textual position list, so their
meaning does not depend on colour alone. The interface can be explored through
recorded examples without an available prediction API.

## Private result recovery

A private link grants access to a job, including download and deletion. It puts
only the UUID and capability token in the URL fragment, which is not sent in an
HTTP request. Building the link removes query parameters and unrelated fragment
content while preserving a deployed GitHub Pages subdirectory. It never sends the
link to a sharing service or analytics endpoint.

The recovery panel provides a labelled, read-only link as well as a Copy button.
If clipboard access is unavailable or denied, it selects the link and explains
manual copy using the browser menu, Ctrl+C or Command+C. The expiry time is shown
when supplied by the API. This does not extend server retention.

The link restores server results. Filters, selections, selection notes and
imported experimental observations survive navigation to Help, About, Evidence
or Examples and back within the app. They are kept only in memory; download an
analysis package to keep this work before refreshing or closing the page. No raw
experimental input is placed in browser persistent storage by the recovery
component. The existing **Forget saved access in this tab** action removes an
expired or unavailable job's saved access without requiring a successful delete
request. It does not delete a server job.

## Verification

The targeted script is `tests/browser/accessibility.py`. It uses the isolated
staging frontend and a locally installed, pinned **axe-core 4.11.0** engine. The
script injects this local test engine only during the audit; the public website
has no axe dependency or remote test script.

```bash
# Separate test tooling, outside the application package.
npm install --prefix /srv/crispert/staging/accessibility-audit \
  --ignore-scripts --no-audit --no-fund axe-core@4.11.0

PLAYWRIGHT_BROWSERS_PATH=/srv/crispert/staging/browsers \
  /srv/crispert/staging/test-venv/bin/python tests/browser/accessibility.py \
  --url http://127.0.0.1:5182/ --browser chromium
# Repeat with --browser firefox.
```

Checks cover all five navigation pages, the candidate and genome forms, recorded
results with details expanded, keyboard navigation and selection, focusable result
scroll regions, 320/390 CSS-pixel widths, and 200% equivalent reflow (640 CSS pixels
at 2× device scale for a 1280 physical-pixel viewport). Connection errors and
expired jobs are controlled failure scenarios; no prediction job is submitted.
Recovery uses deliberately synthetic capabilities. The audit does not access or
record a real private job.

The audit also tests denied clipboard access, manual selection of the full link,
removal of unrelated URL query data, forgetting expired access, and restoring a
validated saved capability after refresh. Unit tests cover malformed and duplicate
credentials, URL construction, and clipboard failure independently of the browser.

The completed staging audit passed 28 workflow/layout checks and 10 scan states
in each of Chromium 153.0.8010.12 and Firefox 155.0, with zero detected axe
violations and no JavaScript errors. A compact report is recorded in
`docs/implementation/15-accessibility-checks.json`.

The executable report records axe violations, checks requiring manual review,
browser versions and tested states. Zero automated violations in those states
would not establish full WCAG conformance. See [Deque's axe documentation](https://www.deque.com/axe/core-documentation/api-documentation/)
and [testing ruleset limitations](https://docs.deque.com/devtools-for-web/4/en/rulesets/).

## Manual verification still required

Before claiming accessibility conformance, test the complete workflow with people
using assistive technology, including:

- NVDA with Firefox or Chromium on Windows; VoiceOver with Safari on macOS/iOS.
- Native browser zoom, platform text enlargement and screen magnification.
- Spoken DNA sequences, table navigation, dynamic result announcements and
  recovery instructions, without duplicate or unexpectedly verbose content.
- High contrast/forced-colour mode, speech input and touch-only use.
- Loading, failed, expired and cancelled jobs; longer lists and unusual user IDs.

These are pending human checks, not completed user-study evidence.
