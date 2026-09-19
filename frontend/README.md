# OfftargetPred frontend

A static React/TypeScript research interface for the de.NBI prediction API. It is built with Vite and published to GitHub Pages. No model weights, API secrets, genomic indexes, or submitted data belong in this directory or the Pages deployment.

## Develop

Requirements: Node.js 22.12+ or 24 LTS, npm, and a running backend.

```bash
npm ci
npm run dev
```

The development URL is `http://127.0.0.1:5173/OfftargetPred-web-server/`. The Vite proxy forwards `/api` to `http://127.0.0.1:8010`; start the API on that port. The backend worker must be running for real predictions. `.env.example` lists public deployment settings.

## Build

```bash
VITE_API_URL=https://your-public-backend.example.org npm run build
```

`VITE_API_URL` is the HTTPS API origin, **without** `/api/v1`. The client appends that prefix. It is public build configuration and must never contain a credential. `BASE_PATH` defaults to `/OfftargetPred-web-server/`; use `/` for a custom domain. GitHub Pages receives only `dist/`. The API must allow the exact Pages origin in CORS.

The build runs strict TypeScript checks before generating the static assets. The dependency lock is committed for repeatable `npm ci` builds. No third-party fonts, telemetry, or remote UI assets are requested.

## Features and scientific boundaries

- One guide with newline-separated candidate sites, or CSV/TSV pairs with a normal file picker.
- Capability-gated human GRCh38 search with 23-base NGG-PAM guides, optional FASTA, 0–4 protospacer mismatches and no bulges.
- k=1 default; k=2 and k=3 selected independently; no invented ensemble.
- Exact 23-nt DNA validation, actionable row errors and ambiguous-base warnings.
- Private jobs, polling, cancellation/deletion, global filtering/sorting, paginated results, full CSV and JSON exports.
- Aligned sequences with mismatch and PAM marks; mismatch counts exclude PAM.
- In-app help and model provenance; no specificity/safety categories or calibrated cleavage-probability claim.

The API remains authoritative for validation, capacity, reference readiness, model execution and data retention. Empty/unavailable states never synthesize predictions.

## Private job access

The API returns an unguessable job capability once. The frontend keeps it in session storage and sends it using `Authorization: Bearer`, never a query parameter. `Copy private result link` creates a URL fragment containing the capability. On opening, the fragment is consumed and removed from the address bar before job polling. Fragments are not sent as HTTP requests; `no-referrer` is also configured. Anyone holding the copied link can access the job until deletion or expiry. Job IDs alone are insufficient. There is no email or account requirement.

Inputs remain in component memory during use; session storage holds only job access, not submitted sequences. A full reload restores job results but does not restore the unsubmitted form.

## Browser checks

`tests/browser_smoke.py` uses deterministic API fixtures to verify browser behavior: input errors, real submission payload shape, three-model results, global filtering, CSV/JSON downloads, capability recovery, small-screen layout, upload, unknown-base warnings, genome submission, help, and unavailable-server handling. Fixture scores are isolated in the test and never included in the production app.

With Python Playwright and Chrome installed, start the Vite server and run:

```bash
OFFTARGETPRED_UI_URL=http://127.0.0.1:5173/OfftargetPred-web-server/ \
  python tests/browser_smoke.py
```

`CHROME_PATH` overrides `/usr/bin/google-chrome`. `UI_ARTIFACT_DIR` overrides `/tmp/offtargetpred-ui`. These browser fixtures do not validate model accuracy or live infrastructure; run the backend tests and deployment smoke checks separately.

## File layout

- `src/App.tsx`: submission workflow, results, documentation and status views.
- `src/api.ts`: typed API contract, capability storage and authenticated downloads.
- `src/input.ts`: input parsing and early user-facing validation.
- `src/styles.css`: responsive interface, sequence marks, focus and reduced-motion treatment.
- `public/examples/`: downloadable format examples with no fabricated scores.
- `tests/browser_smoke.py`: deterministic browser contract checks.
