# Improvement 13 — Reproducible analysis exports

## Delivered

`AnalysisExports` adds browser-local downloads for a complete analysis, the current
filtered view, and the explicit candidate shortlist. These are distinct views;
selection can include candidates hidden by a later filter. An empty selection is
stated before downloading, and its package CSV contains only column headings.

The full ZIP contains:

- `results-full.json`: every row and recorded metadata, with full stored numeric
  precision and additional scientific fields preserved.
- `results-full.csv`, `results-filtered.csv`, `shortlist-selected.csv`: separate
  views with stable original `row_index`, guide/candidate identifiers, sequence,
  separate model and CFD scores, coordinates, annotations and warnings. The
  selected CSV includes user/rank selection notes.
- `candidates-full.bed`, `shortlist-selected.bed`, `bed-skipped.json`: BED6 from
  the existing verified GRCh38 conversion, plus every skipped row and reason.
- `selection-notes.json`: selection reasons for currently selected candidates
  only; these notes are not experimental evidence.
- `provenance-settings.json`: UTC generation time, export schema version, full/
  filtered/selected counts, active filters, an explicit job summary and recorded
  model/reference/search/annotation/software provenance.
- `schema.json`: meanings of result fields, precision, identity and coordinates.
- `report.html`: a script-free, escaped, readable report with counts, settings,
  interpretation, citation and links to the complete data files. Its preview is
  explicitly bounded to the first 200 filtered rows.
- `CITATION.cff`, `LICENSE.txt`, `THIRD_PARTY_NOTICES.md`: bundled repository
  documents. MIT applies to project-owned code; bundling a licence does not grant
  rights to user data or upstream weights/tokenizers.

The disclosure shows full and selected BED exportable/skipped counts and grouped
reasons **before** download. Missing or invalid coordinates affect BED only;
every result remains in JSON and CSV. BED intervals include the PAM, use 0-based
half-open forward-reference coordinates and retain a neutral score of zero.

## Integration contract

```tsx
<AnalysisExports
  document={analysisDocument}
  filteredRows={allFilteredRows}
  selectedRows={selectedRowsFromFullDocument}
  filters={activeFilters}
  selectionNotes={selectionNotes}
  job={job}
/>
```

`selectionNotes?: Record<string, string[]>` uses `candidateKey(row)` from
`features/resultIdentity.ts`. `job` is optional and typed as the narrow
`ExportJobSummary`: `id`, `mode`, `models`, `name`, `created_at`, `finished_at`.
Credentials are never an input. `filteredRows` must contain the entire filtered
view, including its chosen order, rather than one visible page. All selection
identity comes from full-document rows, so duplicate user-provided IDs survive.

Coordinator-owned integration is in `AnalysisWorkspace.tsx`. No API, deployment,
model, package-manifest or worker changes are required by this improvement.

## Privacy, format and responsiveness

Exports make no network calls. A recursive JSON sanitizer removes credential
fields and redacts credential-bearing URLs and bearer strings in values. It
preserves scientific tokenizer hashes. Sanitization also covers row identifiers
before BED punctuation normalization and selection notes. The component never
reads browser location, session storage or private-link state. Downloads still
contain user sequences and analysis data; the disclosure states this clearly.

CSV uses RFC 4180 quotation and escapes formula-like string prefixes with an
apostrophe. Original text remains in JSON after credential filtering. Arrays and
full annotation features are JSON within CSV cells. Numeric values are not
rounded; missing CFD values stay unavailable rather than becoming zero. HTML
escapes every data value and applies a restrictive content-security policy.

The archive uses standard, uncompressed ZIP32 STORE with CRC32, safe fixed
filenames, UTF-8 flags and no dependencies. The original specification is
[PKWARE APPNOTE 6.3.10](https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT).
ZIP entries use the UTC export date; `generated_at_utc` retains millisecond
precision. JSON/CSV construction yields between 100-row batches and CRC streams
yield after each MiB; users can cancel without affecting the analysis. Rendering
does not stringify or display the entire result document. The package is bounded
to 50,000 rows per view and 2 GB; larger archives fail explicitly with guidance to
download separate files/a smaller filtered CSV. Browser memory still bounds large
annotated exports, because the complete analysis and output Blobs must coexist.

## Verification

Tests run on the de.NBI VM staging workspace with Node 22.23.2:

```text
node --experimental-strip-types --test tests/frontend/analysisExports.test.ts
```

Ten tests cover:

- recursive credential removal, encoded/signed/private URLs and provenance
  preservation;
- formula prefixes, quotes, Unicode and multiline CSV;
- full precision, duplicate IDs and stable row indices;
- distinct view counts and explicit empty selection;
- escaped/script-free HTML and its 200-row limit;
- full JSON, unavailable CFD, annotations and invalid-coordinate BED reports;
- selection notes attached to exact candidates, with unselected notes excluded;
- private URLs in identifiers before BED name normalization;
- cancelled exports, invalid dates and unsafe/duplicate ZIP paths;
- every row in a 50,000-row CSV and event-loop yielding (about 1.6 seconds on VM).

Python's independent `zipfile` validates every ZIP entry's CRC and STORE format,
extracts the package, and checks Unicode/multiline CSV with Python's CSV reader.
The integrated TypeScript/Vite production build passes. The coordinator performs
the final rendered download smoke test after wiring this component into results.
