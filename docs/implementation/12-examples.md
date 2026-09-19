# 12 — Interactive examples without a backend dependency

Implemented 19 September 2026 by the dedicated improvement-12 worker. This is a
usability feature for the existing published CRISPert tool. It introduces no new
model, calibration claim or experimental validation claim.

## Delivered

- `frontend/src/components/ExamplesPage.tsx` and its scoped CSS
- `frontend/src/features/demonstrations.ts`
- `tests/frontend/demonstrations.test.ts`
- `tests/browser_examples.py`

The page uses the four verified public-reference/synthetic scenarios from
[improvement 03](03-cases.md). Native buttons open the same `AnalysisWorkspace`
used by actual jobs, with the full frozen document, `demonstration={true}` and no
credentials. The 15-candidate walkthrough, 13-candidate exact-match example and
zero-hit result retain their actual settings and scores. The missing-PAM case
shows its recorded HTTP-422 reason and correction instructions, with no result
workspace or manufactured score.

Cards describe the task and first learning objective. The selected example
shows its search scope, guided steps, expected observations and expandable input.
Keyboard focus moves to the selected example heading. All interactions and
downloads operate in the browser, including filtering, separate model comparison,
selection and reproducible ZIP export.

## Integration contract

```tsx
import { ExamplesPage } from "./components/ExamplesPage";

<ExamplesPage onUseInput={(submission) => preparePredictionForm(submission)} />
```

The coordinator owns navigation and the callback. This component invokes the
callback only after the user chooses **Use this input in a new analysis**. It
passes a fresh copy of the exact recorded `Submission`, preserving all selected
models, zero/one-mismatch settings and any explicitly selected intended locus.
It never creates a job or changes the user's private-job credentials. The invalid
example deliberately prefills its original 20-nt spacer so the correction can be
practised. The form must require the user's explicit submission.

The coordinator has integrated a lazy-loaded Examples navigation page and the
prefill callback in `App.tsx`.

## Loading, integrity and failure behavior

- Only public `demonstrations/*.json` assets are fetched, relative to Vite's
  `BASE_URL`; GitHub Pages repository prefixes are preserved.
- Fetches omit credentials and referrers. No prediction API request is made by
  this feature. Viewing examples works while the prediction API is unavailable;
  it still requires access to website assets on first load.
- The manifest must use schema 1; results must use schema 2.0, match the recorded
  complete candidate count, have unique row indices and valid result fields.
- SHA-256 checks each exact document against its manifest hash when Web Crypto
  is available. An unavailable checksum API is explicitly identified; schema
  validation still applies. A mismatched checksum rejects the document.
- The module caches in-flight and verified completed loads. Failed loads are
  removed from the cache, with clear retry buttons. Loads time out after 15
  seconds. Result assets are limited to 2 MiB and 100 candidates, matching the
  deliberately small complete demonstration datasets.
- Switching examples cannot pair the previous document with the next example's
  job metadata. Selecting a different example starts a fresh analytical view.

## Verification

All verification ran on the de.NBI VM's isolated staging deployment; production
services were not changed.

**11 unit tests passed**, covering all actual asset hashes/counts, GitHub Pages
paths, no-credential static fetches, request caching, absent Web Crypto, checksum
failure/retry, failed-file retry, zero-hit/invalid cases, prefill fidelity, malformed
schemas/rows and oversized files. TypeScript and the Vite production build passed.

**Chromium and Firefox browser checks passed**, with every `/api/v1/` request
blocked. Both browsers verified:

1. Manifest failure and explicit retry.
2. Invalid document checksum and explicit retry.
3. Four real examples and exact 15/13/0 candidate counts.
4. Keyboard focus, filtering, candidate selection and the separate CFD column.
5. Downloaded ZIP integrity and complete 15-row JSON/settings/intended locus.
6. Exact zero-mismatch form prefill and unchanged 20-nt invalid example input.
7. Zero-hit guide preservation and no score for invalid input.
8. Cached navigation without repeated successful asset requests.
9. A 390-pixel viewport without document overflow.
10. No JavaScript page errors or API submissions.

Desktop and mobile screenshots were inspected. Browser evidence and downloaded
ZIPs are in the ignored staging directory `output/examples-browser/`.

To rerun from `/srv/crispert/staging/nar-v2`:

```bash
PATH=/srv/crispert/staging/node/node-v22.23.2-linux-x64/bin:$PATH \
  node --experimental-strip-types --test tests/frontend/demonstrations.test.ts

PLAYWRIGHT_BROWSERS_PATH=/srv/crispert/staging/browsers \
  /srv/crispert/staging/test-venv/bin/python tests/browser_examples.py

PLAYWRIGHT_BROWSERS_PATH=/srv/crispert/staging/browsers \
  /srv/crispert/staging/test-venv/bin/python tests/browser_examples.py --browser firefox
```

The browser script accepts only a localhost frontend. Its default port is 5182.
