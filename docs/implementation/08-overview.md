# Improvement 8 — per-guide overview and scientific filters

## Delivered files

- `frontend/src/features/overview.ts`: full-document aggregation, filter state,
  explicit mismatch/exact-match handling, annotation membership filters, guide
  counts, and recorded search-scope text.
- `frontend/src/components/GuideOverview.tsx` and `.css`: controlled overview and
  filters with scoped styling, optional scientific controls, full-document tables,
  and a paginated guide summary.
- `tests/frontend/overview.test.ts`: independent Node tests; no package edits.

## Integration contract

The coordinator owns `App.tsx` and shared API changes. Import:

```tsx
import { GuideOverview } from "./components/GuideOverview";
import { createOverviewFilters, filterOverviewRows } from "./features/overview";

const [overviewFilters, setOverviewFilters] = useState(createOverviewFilters);
const filteredRows = useMemo(
  () => filterOverviewRows(analysis.rows, overviewFilters),
  [analysis.rows, overviewFilters],
);

<GuideOverview
  rows={analysis.rows}
  mode={job.mode}
  metadata={analysis.metadata}
  filters={overviewFilters}
  onChange={setOverviewFilters}
/>;
```

`analysis` is the **complete** downloaded `AnalysisDocument`; never supply a
paginated response or already-filtered rows to the overview. The table, comparison,
and selected-view exports should receive the same derived `filteredRows`. If the
existing table adds sorting, apply it after this filter. Reset table pagination
when filters change. Reset overview filters when changing jobs/documents; key the
component by job ID to also clear its local guide-list page/search state.

`OverviewFilters` fields:

| Field                             | Default | Meaning                                                                                                              |
| --------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------- |
| `guideKey`                        | `""`    | All guides; otherwise shared `guideKey(row)`                                                                         |
| `query`                           | `""`    | Case-insensitive substring over ID, guide ID, sequences, chromosome, start, assembly and gene/transcript identifiers |
| `annotation`                      | `""`    | All states; `status:annotated`, `status:unavailable`, `status:no_coordinates`, or `category:<literal category>`      |
| `minMismatches` / `maxMismatches` | `null`  | Inclusive bound on known 20-base protospacer substitutions                                                           |
| `includeUnknownMismatches`        | `true`  | Keep unknown counts even when a numeric range is selected                                                            |
| `exactMatch`                      | `"all"` | `"hide"` hides known 23-base identity; `"only"` selects known identity                                               |

All defaults retain all rows. Functions preserve row objects, original order,
duplicate candidate rows, row indices, and score ties. Guide identity combines
supplied ID and guide sequence via the shared helper, so different IDs with the
same sequence and the same ID with different sequences remain separate groups.

## Scientific interpretation

- Mismatch counts are recomputed over the first 20 bases. Any non-ACGT base or
  incomplete protospacer produces an unknown count. A PAM N does not make the
  protospacer mismatch count unknown.
- Exact matching requires two unambiguous 23-base sequences and includes PAM.
  It is a sequence property, never an inferred on-target designation. It is never
  hidden by default. Hiding known exact matches retains unknown identities.
- Annotation category memberships count each row once per category and may
  overlap. Missing/unavailable annotations and absent coordinates have separate
  counts; neither is converted into an intergenic annotation.
- Overview totals, histograms, and per-guide totals always use the full document.
  The per-guide `In view` column and result count reflect combined filters.
- Pair mode explicitly states genomic completeness is unknown. Genome mode uses
  recorded `metadata.reference` assembly/PAM/bulge fields and `max_mismatches`;
  missing reference information is labeled as missing, without an exhaustive
  search claim. No aggregate model score, safety rank, or probability is produced.
- Zero returned rows is supported. A row-only document cannot identify submitted
  guides with zero hits: the UI says “Guides represented” and explicitly explains
  this limitation for an empty document. Showing named zero-hit guides in the
  future requires a submitted-guide list in metadata.

## Accessibility and performance

Native labeled controls, keyboard-operable details/buttons, live filtered counts,
table captions/header scopes, and a focusable scroll region are provided. Summary
tables mount only when expanded. At most 25 guide summary rows and 201 guide options
are rendered at once. For more than 200 guides, a separate ID/sequence search
narrows the guide picker; its limit is explicitly stated and the selected guide
remains available. It does not filter candidate rows until a guide is selected.

Full-universe aggregation and filtered-guide counting are linear passes. The
component memoizes aggregate and derived values by rows/filter identity; category
counts deduplicate per-row labels, not candidate rows. No per-guide scan of the
entire candidate list is used.

## Verification

Passed:

```sh
node --experimental-strip-types --test tests/frontend/overview.test.ts
cd frontend
./node_modules/.bin/tsc --noEmit
```

Coverage includes guide-ID/sequence distinctions, duplicated candidates and tied
scores, unknown protospacer/PAM bases, histogram reconciliation, overlapping
annotation labels, missing annotations, range/query/category/identity filters,
unchanged full-universe totals, zero rows, scoped metadata, and 50,000 rows. The
coordinator should include the integrated component in the final browser smoke
check; this module was verified with pure-function tests and the frontend type
checker before integration.
