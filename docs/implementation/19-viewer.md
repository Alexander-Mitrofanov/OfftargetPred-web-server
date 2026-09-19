# 19 — Embedded genomic context

Dedicated worker: `improvement_19_viewer`.

## Delivered scope

The collapsed **Explore genomic context** panel lets a researcher choose a result
row, inspect its coordinate neighborhood, and read the annotations attached to
that focal candidate. It is usable with frozen examples and an unavailable API.
The panel creates its full-result index only when expanded.

- Search candidate IDs, guide labels, result-row numbers or chromosome locations;
  optionally choose from the existing shortlist. The first 100 matching choices
  are offered, with an explicit instruction to narrow larger searches.
- Choose 100, 1,000 or 10,000 bases on each side. Windows are clipped to the known
  GRCh38 contig boundaries. Reverse-strand sites retain forward-reference intervals.
- Show candidate sites from **all result rows**, including different guides, in
  the visible window. Identical interval/strand sites share a diagram bar with
  their row count; each original row remains in the paginated candidate table.
- Show the focal row's pinned gene, transcript, exon, CDS, UTR or inferred intron
  records. Duplicate annotation records retain a count. The complete list of
  valid supplied features remains accessible in the paginated feature table.
- Bound drawing to the 12 nearest distinct candidate sites and 12 feature records;
  disclose these display limits alongside the uncapped, paginated tables.
- Provide keyboard controls, a named SVG/text description, exact-coordinate tables
  and horizontally scrollable diagrams on narrow screens. Display 1-based inclusive
  coordinates with the original 0-based half-open focal interval beside them.

## Interpretation and privacy

The SVG is a **local result-context view**, replacing the proposed IGV.js scope.
It neither downloads a genome nor asks an external annotation service about the
user's locus. No library or network dependency was added. The component has no
credentials prop and issues no fetches, navigation, prefetch or external requests.
Existing explicit Ensembl/UCSC links remain a separate action.

The available annotations describe only overlaps with the focal 23-nt site,
including its PAM. They are **not a comprehensive regional gene track**. Features
elsewhere in the window are not loaded, and absent exons or transcript structures
are not reconstructed. Introns retain the annotation backend's definition as gaps
between merged exons within each transcript. A focal intergenic annotation does
not classify the surrounding region. Unavailable data, invalid records, upstream
truncation flags and diagram-only limits have separate explanations.

Coordinate convention and bounds are checked against the existing GRCh38 contig
allowlist. This does not verify imported sequences against the reference. Recorded
`coordinate_verification` is shown, and the interface explains that annotations
on imported coordinates are positional only. No scores change, and overlap is
not presented as a measure of functional harm.

A full regional genome browser remains optional future work: it would require a
complete, version-pinned regional track contract and a privacy-preserving reference
serving arrangement. It is not simulated using sparse result annotations here.

## Integration

Owned files:

- `frontend/src/components/GenomeContext.tsx`
- `frontend/src/components/GenomeContext.css`
- `frontend/src/features/genomeContext.ts`
- `tests/frontend/genomeContext.test.ts`
- `tests/browser/genome_context.py`

The coordinator integrates the panel in `AnalysisWorkspace`:

```tsx
<GenomeContext key={`context-${job.id}`} rows={rows} selectedRows={selectedRows} />
```

`rows` is the complete downloaded result array; `selectedRows` references objects
from that array, as the existing workspace does. Keys must be unique among siblings.

## Verification

On the de.NBI staging VM:

- 11 focused Node tests pass: explicit coordinate requirements, contig boundaries,
  half-open overlap math, reverse strand, duplicate rows/sites, nearest-site cap,
  focal-only feature origin, invalid feature counts, unavailable versus intergenic,
  upstream truncation, feature diagram cap, identity-preserving selection, and empty
  or missing-coordinate results.
- TypeScript compilation passes.
- Chromium and Firefox pass the integrated browser check with API access blocked:
  keyboard expansion, lazy rendering, the real 95-feature example and pagination,
  coordinate distinctions, focal intergenic scope, 390 px and 320 px layouts,
  zero viewer requests, empty results, and no JavaScript errors.
- A regression assertion checks that candidate selection and applying experimental
  evidence preserve a single viewer and its focus. It caught duplicate sibling
  React keys during integration; the coordinator fixed the keys before the final
  passing run.
- Desktop diagram and 320 px screenshots from the public demonstration were
  visually inspected. Artifacts are in the VM's
  `output/genome-context-browser/`; no private job credentials are present.

Reproduce against staging:

```bash
cd /srv/crispert/staging/nar-v2/frontend
node --experimental-strip-types --test ../tests/frontend/genomeContext.test.ts
npx tsc -b --pretty false
cd ..
PLAYWRIGHT_BROWSERS_PATH=/srv/crispert/staging/browsers \
  /srv/crispert/staging/test-venv/bin/python tests/browser/genome_context.py \
  --url http://127.0.0.1:5182/ --artifacts output/genome-context-browser
```

The browser check uses a public frozen demonstration. It blocks API requests and
asserts that expanding and manipulating the viewer makes no network request.
