# 17 — External-format imports

Delivered browser-local strict adapters with preview, per-row errors, duplicate
preservation and an explicit Apply action. Supports Cas-OFFinder 2.4.1 six-column
TSV and CRISPOR bulk off-target TSV/CSV. CHOPCHOP's native candidate outputs omit
candidate strand; an explicitly enriched coordinate/sequence table is supported
and native summaries are rejected. This is a compatibility boundary, not an
undocumented claim of native CHOPCHOP import.

## Files and contracts

- `frontend/src/features/toolImports.ts`: `previewToolImport(text, options)` →
  `{rows, csv, inputRows, issues, warnings, canApply}`. Options use format
  `cas-offinder-2.4.1`, `crispor-offtargets` or `chopchop-compatible`, assembly
  explicitly `GRCh38`, optional `guide23`/`guideId`. CHOPCHOP also requires
  `coordinateSystem` and `candidateOrientation` declarations.
- `frontend/src/components/ToolImport.tsx/.css`: named `ToolImport` export,
  props `onApply(csv, summary)` and optional `onUseMapper(rawText)`. No job submission,
  remote lookup or automatic analysis request. Safe inside the existing form:
  action buttons use `type="button"`.
- `backend/offtargetpred/input_metadata.py`: call
  `normalize_input_metadata(parse_pairs(...))` after existing sequence parsing.
  Returns new sanitized dictionaries. Throws existing `sequence.ValidationError`
  for incomplete or invalid coordinate metadata. Does not mutate input.
- `docs/import-formats.md`: user workflow, format boundaries, pinned primary
  sources, coordinate conventions and clearly synthetic examples.

The backend removes reserved scientific/server result fields from submitted
metadata. It parses numeric CSV coordinates, requires full 23-nt GRCh38 loci,
canonicalizes only known chromosome aliases, retains source chromosome names and
marks all imported loci `user-supplied, not reference-verified`. It does not read
FASTA or assert candidate/reference agreement. Do not call it on server-generated
genome search rows.

## Important integration details

Apply callback should switch the parent to pair-table mode and CSV, assign the
normalized text, then leave job submission to the user. The normalized table's
`coordinate_verification` field is descriptive; the backend discards and sets its
own value. Source score columns are not imported as CRISPert predictions.

CRISPOR's bulk export starts are **1-based inclusive**, demonstrated by the pinned
upstream `annotateOfftargets` → `iterOfftargetRows` path. The adapter subtracts
one. Cas-OFFinder 2.4.1 starts are already zero-based. CHOPCHOP orientation cannot
be inferred from the guide strand.

## Validation

On the de.NBI staging VM, 2026-09-19:

- `pytest -q tests/test_input_metadata.py`: **32 passed**.
- Node type-stripping test runner, `tests/frontend/toolImports.test.ts`:
  **19 passed**.
- Full frontend `npm run build`: passed TypeScript and Vite build.

Tests cover both coordinate conventions/strands, explicit negative-strand
conversion, no accidental Cas/CRISPOR reverse complement, missing/placeholder
PAM, mismatched fallback guides, gaps, unsupported variants, duplicates, source
IDs, CSV quoting, size/row limits, incomplete loci, malformed numeric metadata,
known-only aliases and stripping forged output claims. Source sequence/model
modules are unchanged. Coordinator owns final UI integration and public browser
verification. No production service was changed.
