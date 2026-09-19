# Prepare reference sequence for follow-up experiments

OfftargetPred can export reference flanks for explicitly selected candidate loci.
This supplies sequence for downstream assay planning; it does **not** produce
validated primers or predict whether an experimental assay will work.

## Workflow

1. Select 1–20 candidate rows in the results table. Imported candidate rows can be
   used when they contain a declared GRCh38 locus, strand and coordinate convention.
2. Open **Prepare reference flanks for selected candidates**.
3. Choose 0–1,000 bases per side; the default is 250. Click **Prepare selected
   reference flanks**. Selection and field edits do not send requests automatically.
4. Review every row's outcome, then save **Download reference FASTA** and
   **Download flank metadata JSON** together.

The backend checks each complete 23-base candidate, including PAM, against the
installed checksum-verified reference. For a minus-strand candidate, it compares
the candidate sequence with the reverse complement of the reference interval.
The exported flanking sequence itself always remains in **forward-reference
orientation**, on both strands.

Sequence-only rows, undeclared assemblies or coordinate conventions, absent
contigs, out-of-bounds sites and sequence mismatches receive explicit skip reasons.
No genomic coordinates, strand or PAM are inferred. Duplicate selections retain
separate entries and identifiers. Every selection is represented in the JSON,
including skipped rows; only successfully verified rows appear in the FASTA.

## Coordinates and export contents

The table displays candidate loci as **1-based inclusive** intervals. FASTA
headers and JSON use **0-based half-open** coordinates: start is the first included
base and end is the first excluded base. A full candidate therefore has
`end - start = 23`.

Each exported context includes:

- A generated FASTA identifier (`candidate_1`, etc.) linked to the original row
  identifier, optional `row_index` and selection index in JSON.
- Canonical reference chromosome, requested chromosome alias, candidate locus,
  candidate strand and actual candidate sequence.
- Context interval, forward-reference sequence and SHA-256 sequence hash.
- `target_start_offset` and `target_end_offset`: the candidate interval within
  that sequence, also 0-based half-open.
- Actual left/right flank lengths, contig-boundary clipping flags and the number
  of ambiguous reference bases retained in the flanks.
- Reference assembly, filename and verified reference SHA-256; a hash of the
  complete FASTA download.

For example, a candidate at `[100,123)` with 25 bases of context on each side
produces reference interval `[75,148)` and target offsets `[25,48)`. Its FASTA
contains 73 bases. A minus-strand candidate uses the same interval arithmetic;
its candidate sequence is the reverse complement of the 23-base target slice.

At a contig boundary, unavailable flank bases are omitted and flagged. The
service never pads them with invented bases. Ambiguous bases in an otherwise
valid flank are retained and counted; the 23-base candidate itself must match
unambiguous reference DNA exactly.

## Privacy and limitations

The explicit preparation request sends selected candidate sequences and declared
loci only to the configured OfftargetPred backend. It does not contact genome
browsers or primer services, create a scoring job, modify scores, or include job
access tokens. The context helper performs bounded reference reads and writes no
request files. Downloads are generated in the browser. Changing the selection
or flank length clears the previous downloads so they cannot be mistaken for
the new selection.

These are reference sequences, not sample-specific haplotypes. Genetic variants,
primer chemistry, amplicon feasibility and genome-wide primer specificity have
not been assessed. Primer3 integration and any specificity-validation workflow
remain deferred until their behavior, reference scope and failure conditions can
be validated separately. This feature does not claim cleavage confirmation,
safe guide selection or a new prediction method.

## API

`POST /api/v1/reference-context` accepts a JSON object containing `records` and
`flank_bases`. Each record accepts only:

```json
{
  "id": "candidate-1",
  "row_index": 0,
  "off_target": "TGAGACTCTTGCAGTCACACAGG",
  "chromosome": "1",
  "start": 100056,
  "end": 100079,
  "strand": "+",
  "assembly": "GRCh38",
  "coordinate_system": "0-based half-open"
}
```

The envelope requires 1–20 records and an integer flank length from 0 to 1,000.
Identifiers and text fields are bounded, integers must be exact, unknown fields
are rejected, and the complete request is limited to 16 KiB. Requests share the
backend's bounded reference-tool admission controls. Structural errors return
HTTP 422; incompatible or unavailable reference data returns HTTP 503; admission
limits return HTTP 429 with retry guidance. Ordinary per-record incompatibilities
produce a complete HTTP 200 report with `status: "skipped"` and a reason.

`complete: true` means that every selected input has an outcome. It does not mean
that every selected candidate passed verification or that any assay was validated.

See [implementation and verification](implementation/23-followup.md).
