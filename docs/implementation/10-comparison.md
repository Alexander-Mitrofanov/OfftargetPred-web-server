# Improvement 10 — independent model rank comparison

## Delivered

- `frontend/src/features/comparison.ts`: per-guide independent ranks, tied
  average ranks, full-set top-N intersections and paired Spearman correlation.
- `frontend/src/components/ModelComparison.tsx` and `.css`: progressive section
  with explicit guide/model choices, optional CFD, counts, interpretation rules,
  rank differences and a selectable paginated comparison table.
- `tests/frontend/comparison.test.ts`: 12 mathematical and edge-case checks,
  including a complete 50,000-row candidate set.

## Integration

```tsx
<ModelComparison
  rows={document.rows}
  selectedGuideKey={filters.guideKey}
  onGuideChange={key => setFilters(previous => ({ ...previous, guideKey: key }))}
  selectedRowKeys={selected}
  onToggleRow={toggle}
/>
```

Pass the **complete document rows**, never a table page or filtered view. The
component selects one guide using the shared ID-plus-sequence `guideKey` and uses
the shared `candidateKey` for cross-view selection. The guide dropdown is explicit;
an empty guide key asks the user to choose instead of merging guides. Its local
guide selector can operate without `onGuideChange`; later changes to
`selectedGuideKey` reset that local selection. When `onGuideChange` is supplied,
guide selection is controlled by the parent. Selection and the callback are
optional, and no selection column appears without a callback.

The previous overview delivery note suggested passing filtered rows to comparison.
That suggestion does **not** apply here: ranks must retain the complete candidate
universe for the chosen guide, independently of filters and pagination.

## Definitions and interpretation

- Each finite score is ranked separately, largest first. Missing, null and
  nonfinite values remain unavailable, including an unsupported CFD result.
  Zero is a valid score and never substitutes for missing data.
- Exactly equal score values share their average rank. Stable candidate identity
  controls presentation within ties and never breaks a scientific rank tie.
- Top-N membership includes every tie crossing the Nth position. Counts can
  therefore exceed N; the interface reports each actual set size and the exact
  intersection. No intersection percentage with an ambiguous denominator is used.
- Table ranks use each model's complete scored candidate set for that guide.
  Signed differences are first rank minus second rank. Unequal missing-score
  counts can influence these differences and are explicitly disclosed.
- Spearman is the Pearson correlation of tied average ranks **recomputed on the
  jointly scored subset**. The paired sample count is displayed. Constant ranks
  and fewer than three jointly scored candidates display an explicit unavailable
  reason; 3–9 paired candidates receive a small-set note. There is no significance
  test, accuracy claim or experimental validation claim.
- k1/k2/k3 differ in pretraining as well as token length. Comparing their ranking
  is not a controlled study of k-mer length. CFD remains an optional independent
  baseline. No raw score scale comparison, averaging, ensemble, calibrated
  probability, guide safety score or on-target assignment is produced.

## Usability and performance

The native details section mounts rank work only when opened. It provides native
labeled keyboard-operable controls, scoped table headings, explicit numeric/text
rank differences, counts and text explanations. Visual interpretation never
depends on color. The table mounts at most 25 rows at once; first/next controls
preserve the underlying complete ranking. Guide lists above 200 entries have a
search field and explicitly limited options. Top-N choices are 5, 10, 20, 50 and
100, with full cutoff ties retained even if this creates a larger list.

Ranking costs O(n log n) and memory O(n), with memoization and no dependencies,
external requests or new backend work. No private information is transmitted by
the component. The existing stable row-index contract is required to distinguish
otherwise identical duplicate candidate rows, as elsewhere in the workspace.

## Verification

Passed on the development Node 24 runtime:

```sh
node --experimental-strip-types tests/frontend/comparison.test.ts
cd frontend
./node_modules/.bin/tsc --noEmit
```

All 12 checks passed. These cover deterministic exact ties, missing/nonfinite/zero
scores, hand-computed tied Spearman, paired-subset reranking, monotonic score-scale
invariance, constant/small sets, cutoff ties, duplicate IDs with distinct row
indices, guide isolation, CFD, empty results, bounded top-N and 50,000 rows. The
50,000-row test completed in approximately 222 ms in this run (a local diagnostic,
not a service latency guarantee). The coordinator should include the integrated
section in the final browser checks; no live deployment was performed by this
worker.
