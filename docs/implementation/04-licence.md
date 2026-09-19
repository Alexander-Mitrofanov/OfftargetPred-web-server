# Improvement 4: licence, attribution, citation and support

Implemented 19 September 2026. UI integration is owned by the coordinator.

## Delivered files

- `LICENSE`: MIT for original project-owned code/documentation, copyright
  `2026 OfftargetPred contributors`, with explicit upstream exclusions.
- `frontend/public/license.txt`: byte-identical public copy of `LICENSE`.
- `THIRD_PARTY_NOTICES.md`: unresolved supplied-tokenizer provenance, private
  artifact exclusions, retained CFD licence reference, full shared React/React
  DOM/Scheduler notice, and the installed licence inventory for 72 frontend
  packages and 64 Python distributions. Includes non-MIT and binary-vendor terms.
- `CITATION.cff`: schema-valid development software citation, `0.2.0-dev` toward
  planned `0.2.0`, separate verified CRISPert paper reference, no software DOI,
  no invented release date, and licence-scope qualification.
- `docs/licensing.md`: rights scope, citations, public maintainer/support route,
  and the outstanding release/archive checklist.
- `frontend/src/components/ServiceInformation.tsx` and scoped CSS: model scope,
  free/no-account access, base-paper link, draft software citation, accessible
  copy/read-only-text controls, CFF and third-party-notice downloads, licence,
  source and support links. Clipboard failure selects the text for manual copy.

No shared app/API/package/readme file was changed by this worker. No model,
tokenizer or dataset was changed. No issue, email, archive deposit or release
was created.

## Integration

Import and render the standalone component on the about/methods page or other
appropriate information section:

```tsx
import { ServiceInformation } from "./components/ServiceInformation";

<ServiceInformation />
```

It takes no props, performs no fetch or sequence submission, and uses only
ordinary React text rendering. The CFF and notice downloads import the root
files through Vite's `?raw` loader, keeping downloaded and repository copies
identical. The licence URL uses `import.meta.env.BASE_URL` for GitHub Pages.
No new package is required. The component supplies an `h2` and `h3` headings.

The coordinator should link `docs/licensing.md` and the main licence/citation
files from the shared README and include the component in final browser checks.
Leave release metadata in its draft state until a real release exists. Any
future version/date/DOI update must synchronize `CITATION.cff`, the component
text and release records. Package version changes remain coordinator-owned.

## Checks performed

- `frontend/node_modules/.bin/tsc -p frontend/tsconfig.json --noEmit`: passed.
- Formatted the new TSX/CSS, CFF and licensing guide with installed Prettier.
- Parsed CFF with PyYAML and validated against the official CFF 1.2.0 JSON
  Schema using `jsonschema.Draft7Validator` with format checks: passed.
  [Official schema](https://raw.githubusercontent.com/citation-file-format/citation-file-format/1.2.0/schema.json).
- Verified root/public licence equality, copyright/scope, separate paper DOI,
  absence of top-level software DOI/release date, and retained React notice.
- Resolved every repository-relative Markdown link in the licensing guide and
  notices against the local tree: passed. New documentation links will become
  public only after the coordinator publishes their source commit.
- Bundled the isolated component with installed esbuild, rendered it using
  React DOM server, and checked accessible form/status controls, the support
  URL, the Pages base-path licence URL, and exact decoded CFF/notices download
  contents: passed. This is a render/download-content check, not a browser
  clipboard-permission or full-app visual test.
- Confirmed the tokenizer and upstream CFD licence SHA-256 values remain
  `b15aae904e073d53d0c878199a3a04e2eeccb81faeb3e11738dc00bc282cb2e2` and
  `023d7b6c330e5e1d769d28b329a1b4efcac23d36f169394cebc58b60dbd3dc11`.

## Remaining external dependencies

The supplied tokenizer's distribution rights and upstream weights/dataset
permissions remain unverified. MIT applies only where the project owns the
rights; documentation does not cure missing permission. Archive owner/author
authorization has not been provided. No institutional support commitment or
five-year maintenance promise has been invented. The project can expose the
published CRISPert method without asserting a new prediction algorithm.
