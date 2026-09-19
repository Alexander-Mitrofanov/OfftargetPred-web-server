# 25 — Evidence page for the published-tool interface

Implemented 19 September 2026. The page explains the existing numerical
reproduction of the three served, unchanged CRISPert-small checkpoints. It is
supporting documentation for a usable interface to published CRISPert, without
claiming new scientific novelty or general superiority.

## Delivered

- `frontend/src/components/EvidencePage.tsx` and `.css`: named export
  `EvidencePage`, no props and no analysis-server dependency. The coordinator
  integrates it as the lazy-loaded `#evidence` page.
- `frontend/src/features/evidence.ts`: imports the exact
  `docs/validation/web-diagnostics.json` at build time. Selectors, display values
  and downloads all use that one source; metrics are not copied into a second
  ledger or recomputed in the browser.
- `tests/frontend/evidence.test.ts`: seven focused tests covering all nine
  dataset/partition combinations, whole-guide overlap, macro denominators,
  undefined values, reproduction checks and download identity.

Readers choose one of three supplied datasets and all guides, guides excluding
reported T-cell overlap, or overlapping guides only. Empty partitions remain
selectable and explain why AP is undefined. Each selection displays rows, guides,
positive labels and label-zero counts beside the macro/pooled AP table. CFD is
separate from the three CRISPert models. No method receives a winner badge.

Macro AP denominators and excluded-guide counts are displayed for every method.
The iPSC zero-positive guide remains in the expandable per-guide table with null
AP and a reason; its rows remain in pooled AP. Guide numbers retain their dataset
identity across partition changes. Downloads preserve the report's full floating
point precision, while ordinary display values use four decimals.

The published CRISPert citation and important interpretation limits are visible.
Metric definitions, per-guide results, fingerprints, numerical reproduction
checks, runtime and source hashes use progressive disclosure. The full-K562
reference-check table is explicitly labelled as independent of the selection
above it. The interface does not equate guide-disjoint with verified independent
evaluation, label-zero with established biological negatives, or supplied-file
scoring with genome-search retrieval validation.

Aggregate evidence and a provenance-only JSON download are generated from the
imported report. Neither contains raw assay candidate rows, coordinates, private
weights or sequences. Source identity fingerprints remain labelled as identity
information rather than anonymization.

## Design

The page follows the existing scientific workbench: white (`#ffffff`), light blue
background (`#f5f8fb`), ink (`#16334a`), links (`#1266a8`), teal context marker
(`#087f79`) and pale borders (`#d7e2ea`). System sans-serif text, left alignment,
an ordinary comparison table and expandable details keep the evidence readable.
Tables scroll horizontally on small screens, with a visible mobile hint and
keyboard-focusable scroll regions. All choices use labelled native selects.

## Verification

On the authorized de.NBI staging VM:

```bash
cd /srv/crispert/staging/nar-v2/frontend
PATH=/srv/crispert/staging/node/node-v22.23.2-linux-x64/bin:$PATH \
  node --experimental-strip-types --test ../tests/frontend/evidence.test.ts
```

Result: **7 passed**. The final `npm run build` also passed on the VM; the lazy
Evidence JavaScript chunk is 71.99 kB (14.03 kB gzip). Browser testing used Chromium through the isolated VM
Playwright environment against the integrated `http://127.0.0.1:5182/#evidence`
route. It verified dataset and partition controls, full/overlap/disjoint counts,
empty partitions, iPSC's 2/3 denominator, its null per-guide values, both JSON
downloads after switching the browser offline, and no JavaScript exceptions.
Desktop, 390 px and 320 px layouts passed without document-width overflow;
desktop and 320 px screenshots were visually inspected. Browser checks are
recorded in the temporary VM script `/tmp/evidence-browser.py`, without private
job data. No production service or checkpoint was changed by this worker.

The source diagnostics and their scientific limitations are documented in
`02-benchmark.md`. The Evidence page does not resolve unknown training membership,
selection history, dataset accessions, external data rights or institutional
hosting commitments.
