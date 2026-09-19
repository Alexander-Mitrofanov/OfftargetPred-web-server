# Improvement 14 — first-run input guidance and column mapping

## Delivered

This improvement makes the existing CRISPert workflow easier to start without
changing its models or supported biological input. The coordinator has placed
model selection under an advanced disclosure, defaulting to k1; this worker adds:

- `frontend/src/features/columnMapping.ts`: bounded CSV/TSV inspection, suggested
  column mappings, explicit mapping validation and normalized CSV generation.
- `frontend/src/components/ColumnMapper.tsx` and its CSS: labeled selectors,
  first-10-row preview, all-row checks, explicit confirmation and Apply action.
- `frontend/src/components/InputGuide.tsx` and its CSS: live sequence-length
  guidance, clear missing-PAM advice, and the existing strict validation messages.
- `tests/frontend/columnMapping.test.ts`: 17 focused helper tests.
- `tests/browser/input_mapping.py`: reproducible Chromium/Firefox UI check that
  never submits a prediction job.
- `docs/usability-study.md`: ready protocol and empty observation sheet for 5–8
  representative biologists. **Participant recruitment and human observations are
  pending; no usability-study results are claimed.**

The coordinator owns and has integrated these components in `App.tsx`.

## Integration contract

```tsx
<ColumnMapper
  rawText={table}
  onApplyTable={(csv) => setTable(csv)}
  maxRows={capabilities?.limits.pairs ?? 10_000}
  maxRequestBytes={capabilities?.limits.request_bytes ?? 5 * 1024 * 1024}
/>
<InputGuide sequence={guide} mode="pairs" />
```

`ColumnMapper` works entirely in the browser and calls its callback only after all
rows pass and the researcher confirms the mapping. Applying changes the source
input; it does not call the server. A changed source or changed selection resets
confirmation. A format selector can override CSV/TSV detection. Recognized header
aliases are suggestions, and ambiguous aliases remain unselected. Generated row
identifiers are available when no identifier column is chosen.

`InputGuide` accepts one sequence, not a FASTA list. Its optional `mode="genome"`
uses the existing NGG/unambiguous-base genome validation. In pair mode, N and
non-NGG guide PAMs remain warnings consistent with backend behavior. A 20-nt
spacer is never expanded automatically and no reverse complement is inferred.

## Data preservation and bounds

Selected sequence columns become `target` and `off_target`; the identifier becomes
`ID`. Sequences are uppercased and trimmed at their ends. Interior whitespace,
RNA U, gaps and missing PAM bases remain errors. No bases are invented or changed.
Only a full 23-nt sequence is accepted. Identifier length/control-character checks
match the backend; duplicate identifiers remain separate rows.

Unselected, recognized metadata columns (`guide_id`, `chromosome`, `position`,
`start`, `end`, `strand`, `assembly`, `coordinate_system`) keep their original
values exactly, including numeric-looking strings and quoting content. The helper
does not claim to verify metadata or convert coordinate conventions. Omitted
columns are named visibly before confirmation. Original files should be retained.

Default limits are 10,000 rows and 5 MiB; smaller advertised server limits are
honored. Props cannot raise the supported hard limits. UTF-8 size is checked
before parsing; logical row and field counts are bounded before allocation.
The mapper accepts up to 256 columns and 200-character headers. Previewed invalid
sequences and identifiers are shortened for display, while validation uses their
full values. JSON escaping plus a conservative 1 KiB allowance for request
metadata are included in the final request-size check.

Every row is validated even though only ten are previewed. The UI reports total
rows, error count and invalid-row count, and lists the first 20 errors with data
row numbers. It does not silently discard rows or produce a partial normalized
CSV. Correct all errors before Apply becomes available.

## Verification

- `node --experimental-strip-types tests/frontend/columnMapping.test.ts`:
  **17/17 passed**. Coverage includes malformed quotation, duplicate/empty headers,
  UTF-8 and JSON byte limits, excessive rows/columns/header lengths, arbitrary
  mappings, reused/wrong column selections, CSV escaping, TSV/BOM/CRLF, unchanged
  coordinate metadata, missing PAM/gaps/RNA U, identifier validation, warnings,
  row 12 outside the preview, and a complete 10,000-row table.
- Frontend TypeScript checking passed after initial component integration.
- Focused browser checks ran against the isolated VM staging frontend on port
  5182 in **Chromium and Firefox**. Both passed mapping, explicit confirmation,
  metadata retention, an error beyond the preview, keyboard checkbox/Apply,
  duplicate-header rejection, 20-nt guidance and 390-pixel layout. There were no
  POST requests or page errors. The Chromium mobile screenshot was visually
  inspected and the page had no horizontal overflow; the preview table scrolls
  within its own region.

To repeat the browser check on the VM:

```bash
PLAYWRIGHT_BROWSERS_PATH=/srv/crispert/staging/browsers \
  /srv/crispert/staging/test-venv/bin/python \
  tests/browser/input_mapping.py \
  --url http://127.0.0.1:5182/OfftargetPred-web-server/
```

No live service or production job was modified by this worker. Automated checks
support implementation confidence; they are not evidence that the human-user
study has occurred.
