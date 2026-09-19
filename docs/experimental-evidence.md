# Compare predictions with your experimental observations

The results page accepts a small, generic CSV or TSV observation table. This lets
you inspect your own assay evidence beside predictions from the published CRISPert
models. Importing observations does not change, train or calibrate those models.

GUIDE-seq and CIRCLE-seq are examples of assay names you may enter. The importer
does **not** claim to support every native export format from these assays. Convert
your source export to one of the exact formats below, preserve your original file,
and check its sequence and coordinate definitions before importing.

## Workflow

1. Open **Compare with your experimental observations** below a completed result.
2. Enter an assay name and, optionally, sample context such as cell type, treatment
   and replicate. Choose whether `value` represents a read count or another
   nonnegative evidence value.
3. Choose one matching method below and upload or paste the corresponding table.
4. Select **Preview observation matches**. Inspect one-match, ambiguous and
   unmatched observations. The preview uses the complete result document.
5. Correct every import error, then select **Apply observations**. The previous
   applied import remains active while you edit or preview a replacement.
6. Include experimental evidence in the analysis export to preserve the import.
   **Clear applied observations** removes the applied evidence from this result.

Imports stay in memory in your browser tab. Reloading the page clears them. No
observations, filenames or assay names are sent to a remote service by this feature.
There are no automatic links or requests to assay databases.

## 1. Match guide + candidate sequences

Required, case-sensitive headers: `target,off_target,value`.
Optional header: `id`.

Both sequences must contain **23 actual A/C/G/T bases**, including their own
3-base PAM, in guide orientation: 5′ spacer → PAM 3′. Lowercase bases are accepted
and normalized to uppercase. N, gaps, RNA bases and 20-nt spacers are rejected.
The importer never guesses a PAM or reverse-complements a sequence.

This entirely synthetic example demonstrates the format:

```csv
id,target,off_target,value
synthetic-observation,GATGCTCTCCAGAATCACTGCGG,GTTGCTCTTCAGAATCACTGAGG,12
synthetic-zero,GATGCTCTCCAGAATCACTGCGG,GATGCTCTCCAGAATCACTGCGG,0
```

Both sequences must match a prediction row. A sequence pair may occur at several
genomic loci; all such rows are retained as possible matches and the observation is
marked **ambiguous**. Guide labels do not substitute for actual sequence identity.

## 2. Match candidate sequence only

Required headers: `off_target,value`. Optional header: `id`.

```csv
id,off_target,value
synthetic-observation,GTTGCTCTTCAGAATCACTGAGG,12
```

The same actual 23-base sequence rules apply. This option deliberately ignores guide
identity, so one observation may match multiple guides or loci. Every possible match
is retained, with ambiguity recorded. Use paired-sequence matching when your source
contains the actual guide sequence.

## 3. Match GRCh38 interval + strand

Required headers: `chromosome,start,end,strand,value`.
Optional headers: `id,target`.

Explicitly select **GRCh38** and either **0-based half-open** or **1-based
inclusive** coordinates. The interval must cover the full **23-base candidate,
including its PAM**, on the forward reference coordinate axis; `strand` is `+`
or `-`. A cleavage position, break-site interval or assay peak is not a 23-base
candidate interval. Convert those source coordinates using a verified reference
before import. The web interface does not infer that conversion.

These two synthetic rows identify the same positive-strand interval under their
respective declarations:

```csv
chromosome,start,end,strand,value
chr1,100,123,+,12
```

Above: 0-based half-open. Below: 1-based inclusive.

```csv
chromosome,start,end,strand,value
chr1,101,123,+,12
```

Negative-strand intervals use the same forward reference coordinates and `-` in
the strand column. Imported coordinates are stored as 0-based half-open.
Canonical chromosome names such as `chr1`/`1` and `chrM`/`MT` are matched as aliases.
Other contig names must match exactly; there is no general removal of `chr`.

Only prediction rows with explicit GRCh38, complete 0-based half-open coordinates
and a known strand can match. An optional actual 23-base `target` narrows the match
to that guide. Assembly conversion and reference-sequence verification are not
performed by this importer. If several prediction rows satisfy the same identity,
all remain possible matches.

## Interpretation and bounds

- A positive `value` means **reported observed evidence in the specified assay
  context**. It is not a probability of editing, a clinical assessment or proof of
  causality.
- A zero value is retained as **reported zero**. It is never labelled a true
  negative. Predictions with no imported observation likewise are not negatives;
  assay coverage, sensitivity and context may differ.
- Each data row receives a unique `import_row_id`, even when source IDs repeat.
  Duplicate matching-key/value rows are preserved and flagged using `duplicate_of`.
  These flags do not establish whether rows are technical duplicates or independent
  replicates. Values are never summed, and no AP, accuracy or enrichment metric is
  computed. Summary observation counts explicitly include duplicates.
- **One match**, **multiple possible matches** and **no match** partition the
  observation rows. The count of prediction rows with possible evidence is a
  separate number and may exceed the number of observations.
- Unmatched observations remain in the applied state and export. They may refer
  to a site outside the prediction search scope, another guide or a mismatched
  declaration. The software does not decide which explanation applies.
- Maximum input: 5 MiB and 10,000 observations. Maximum prediction document:
  50,000 rows. More than 250,000 possible observation-to-result links rejects the
  entire import; use paired-sequence matching or split your observations.
- Read counts must be nonnegative safe integers, at most 9,007,199,254,740,991.
  Other evidence values must be finite, nonnegative numbers representable by
  JavaScript numbers; ordinary floating-point precision applies. NaN, Infinity,
  negative values, missing values and numeric underflow to zero are rejected.
- Unknown columns, duplicate headers, malformed quoting and invalid data rows
  block the complete import. Rows are never silently dropped. Standard CSV quoting
  and tab-separated files are supported; uploaded files must be UTF-8.

## Provenance in the analysis export

The `EvidenceState` JSON object contains:

- `metadata`: assay name, sample context, matching method, value meaning, coordinate
  declarations when relevant, source filename if supplied, import time and
  interpretation limits.
- `observations`: every imported data row, normalized matching identity, value,
  stable import row ID, duplicate flag, matching result-document indexes and status.
- `per_row`: possible observations for each matched prediction row. `result_index`
  is the zero-based position in the complete result document; `candidate_key` is an
  additional identity check. It also lists positive, zero and ambiguous observation
  IDs separately.
- `summary`: input-row, ambiguity, duplicate and prediction-row coverage counts.

Where browser Web Crypto is available, metadata includes `source_sha256`. For an
uploaded file it hashes the original file bytes (`hash_basis: original_file_bytes`),
including a UTF-8 byte order mark if present. For pasted or edited text it hashes
that text encoded as UTF-8 (`hash_basis: UTF-8 text`). When hashing is unavailable,
`hash_status: unavailable` is recorded explicitly; matching remains unchanged.
The checksum identifies the supplied input; it does not authenticate an assay or
establish ownership of the underlying observations.

The examples in this document and in the interface are invented format examples,
not measured assay results or validation evidence for CRISPert.
