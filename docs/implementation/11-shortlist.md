# 11 — Experimental validation shortlist

## Delivered

An optional results section helps a researcher choose candidates for follow-up.
It works on the complete result document and never uses only the currently visible
table page or filtered subset. It proposes a bounded top N for each guide, using
one explicitly chosen CRISPert checkpoint or the optional, separate CFD baseline.
It does not combine scores or claim that selection establishes experimental
validation, calibrated cleavage risk or guide safety.

The researcher can:

- Rank every guide separately, or choose one guide explicitly.
- Choose N from 1–100 per group, with all cutoff ties included by default.
- Explicitly turn off tie expansion; equal scores then use stable row identity
  as an arbitrary tie break, with an explanation in the interface and reasons.
- Optionally group by each protospacer mismatch count or genomic annotation
  category. Unknown mismatch counts, unavailable annotations and missing
  coordinates have separate groups. Overlapping annotation categories can yield
  multiple reasons for the same candidate; the candidate is selected once.
- Optionally exclude **user-designated intended loci** before ranking.
  Full sequence identity alone never triggers that exclusion.
- Preview the proposal, add it to their existing manual choices, explicitly
  replace their selection, clear it, or remove individual candidates.
- Review selected counts per guide and a paginated selected-candidate list with
  readable selection reasons.

Changing controls does not apply a selection. Automatic proposals exceeding
5,000 distinct candidates are blocked visibly; candidates and ties are never
silently truncated to meet the limit. The limit affects automatic actions only,
not manual table selection. Missing and nonfinite scores are not substituted
with zero. Zero and negative finite scores remain eligible.

## Files

- `frontend/src/features/shortlist.ts`: complete-document selection rules,
  stable identity, bounds, selection merging, reason reconciliation, summaries.
- `frontend/src/components/ShortlistBuilder.tsx` and `.css`: accessible optional
  controls, preview, explicit selection actions and paginated summaries.
- `tests/frontend/shortlist.test.ts`: ten focused behavioral tests.

## Integration contract

```tsx
const [selectionNotes, setSelectionNotes] = useState<SelectionNotes>({});
<ShortlistBuilder
  rows={document.rows}
  selectedKeys={selectedKeys}
  onSelectionChange={setSelectedKeys}
  metadata={document.metadata}
  onNotesChange={setSelectionNotes}
/>
```

`selectedKeys` accepts a `ReadonlySet<string>` using the shared `candidateKey()`
helper; `onSelectionChange` receives a complete replacement `Set<string>`.
`onNotesChange` is optional and returns `Record<string, string[]>`, keyed by the
same candidate identity, for the currently selected candidates only. The export
worker/coordinator can pass this as `selectionNotes` to analysis exports. The
optional metadata prop reserves a uniform integration surface and is not used to
infer unstated study or reference properties.

Mount the component with a stable analysis/job identity so notes persist while
the user changes filters and opens/closes sections. Changing to another result
document should remount the analysis workspace. Reasons for table/comparison
choices are labelled manual. Deselecting a candidate removes its stored reasons;
reselecting manually starts a fresh manual reason. Add preserves old reasons;
replace deliberately records the new rule instead. Reasons are local UI state
until exported; reloading the page does not restore a previous selection.

## Verification

Lightweight local checks passed:

```text
node --experimental-strip-types tests/frontend/shortlist.test.ts
10 tests passed

cd frontend && ./node_modules/.bin/tsc --noEmit
passed
```

Coverage includes per-guide ranking, cutoff ties and explicit tie breaking,
duplicate display identifiers, missing/zero/negative scores, optional CFD,
intended versus exact-sequence matches, mismatch and overlapping annotation
strata, N bounds and oversized tie rejection, preservation of manual selections,
reason deduplication/removal, guide scoping and zero selected counts. Full browser
integration and deployment are coordinator-owned checks on the VM.

## Scope

This is a planning aid around the published predictor. It does not generate
experimental evidence or choose a clinically meaningful validation threshold.
All selection operates on the returned candidate universe and inherits its
recorded search limitations. It does not claim an exhaustive genomic search.
