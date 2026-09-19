# Guided examples

These examples demonstrate the web interface to the published CRISPert method.
They teach input preparation, interpretation and result handling. They are
software demonstrations using public reference DNA and one explicitly synthetic
query, not wet-lab case studies, validation of biological activity or evidence of
a new prediction method.

The frozen examples work without submitting a job. They contain genuine output
from the V100 staging worker: unchanged sequence-only k1/k2/k3 models, separate
CFD scores, Cas-OFFinder 2.4.1 searches against Ensembl 115 GRCh38 primary assembly,
and matching Ensembl 115 annotations. Each result includes all candidates within
its stated scope. No example was truncated to fit the interface.

Open **Examples** and choose **Explore results** to work with a recorded analysis.
**Use this input in a new analysis** only fills the prediction form; review it
and submit explicitly to run a new job. Viewing, filtering and downloading the
recorded results needs no prediction-server connection. The reference resolver
and optional reference-flank preparation do need the backend.

## 1. Explore a public reference guide

**Task:** follow a reference locus through a complete search, inspect the aligned
sequence differences, compare separate model ranks and explore annotations.

Input: `TGAGACTCTTGCAGTCACACAGG`, read from the pinned public GRCh38 reference.
The selected locus is chromosome 1, **100057–100079, plus strand**, in 1-based
inclusive display coordinates. The stored interval is `[100056,100079)`.
Search settings are NGG PAM and at most one protospacer mismatch.

The complete search returns **15 candidates**. Exactly one locus is marked as
explicitly selected. Five candidates match all 23 input bases; other exact matches
remain visible. This guide is useful for learning precisely because a sequence
match does not uniquely identify the intended locus.

1. Find **Your selected reference locus** in the candidate table. This marker
   records the input locus; the row-selection checkboxes build a separate
   shortlist and do not change the intended locus.
2. Inspect the aligned bases. There are 13 zero-spacer-mismatch candidates and
   two one-spacer-mismatch candidates. Differences in the three PAM bases are
   displayed separately from the 20-base spacer mismatch count.
3. Open **Compare model rankings**. Compare ranks within each model, then inspect
   the genomic annotation before deciding which rows to review further. The
   scores are uncalibrated, and an annotation overlap describes location rather
   than biological harm. No automatic exclusion or cleavage claim follows from
   an exact match.
4. Select rows, then open **Download an analysis package or shortlist**. The full
   ZIP retains all 15 candidates alongside the filtered view and your selected
   shortlist; **Download selected CSV** contains only the checked rows. Keeping
   the complete search preserves the context for a later prioritization decision.

## 2. Understand multiple exact matches

**Task:** distinguish full-sequence identity from protospacer identity, and
inspect matching sites on both strands.

The same public guide is independently searched with **zero protospacer
mismatches** and NGG PAM. The complete result has **13 candidates**, all matching
the 20 nt protospacer. **Five** also match the entire 23 nt input. The remaining
eight differ at the first PAM base, which NGG discovery permits.

No intended locus is selected for this example. Open **Scientific filters**, set
**Full-sequence exact matches** to **Only known exact matches**, and expect
**5 of 13** candidates. **Hide known exact matches** instead shows the other
eight candidates, even though their 20-base spacers still match exactly. Reset to
**Show all candidates** to restore all 13. This filter changes the displayed view,
not the search results or the ranks calculated from the complete candidate set.

Inspect the coordinates and strand before deciding which locus was intended.
Full-sequence identity alone cannot make that decision. The example demonstrates
multiple matching reference loci; it supplies no experimental cleavage evidence.

## 3. Interpret a completed search with no hits

**Task:** distinguish a successful empty search from a service error and from a
claim about safety.

Input: `ACGTCAGTACGATCGTACGATGG`, a deliberately synthetic 20 nt protospacer plus
an explicitly synthetic TGG PAM. It is not presented as a genomic editing target.
The actual NGG search at one protospacer mismatch completed with **zero hits**
against the pinned GRCh38 primary assembly.

The guide remains visible in the overview with zero candidates. There are no
candidate scores. This result says only that no candidates were found within
this reference/PAM/mismatch scope. It does not exclude other assemblies,
individual variants, alternative PAMs, bulges or more distant matches.

Check **Run settings and provenance** before choosing a next step. A real query
with an unexpectedly empty result calls for checking its sequence, actual PAM,
assembly and search scope. By contrast, an empty table after filtering a nonempty
analysis says **No candidates match these filters**; reset those filters to see
the existing candidates. Neither state should be interpreted as an API failure.

## 4. Fix a guide with a missing PAM

**Task:** recognize a 20 nt spacer and obtain its real PAM before submission.

Input: `TGAGACTCTTGCAGTCACAC`. The staging API returned HTTP 422 with the message:

> Row 1: guide must contain exactly 23 bases (20 nt + 3 nt PAM); got 20.

No prediction job or result document exists for this scenario. Choose **Use this
input in a new analysis**, then open **Have a 20-nt spacer? Find its reference
PAM**. Enter the spacer above, chromosome **1**, start **100057** and end
**100076** (1-based inclusive). Choose **Find spacer and PAM**, select the actual
public-reference locus, and choose **Use selected 23-nt guide**. Verify that the
filled input is `TGAGACTCTTGCAGTCACACAGG` before submitting. A guessed PAM is not a
valid substitute. The resolver needs an available backend and reference index.

## Evidence and provenance

- [Example manifest](../frontend/public/demonstrations/manifest.json): inputs,
  tasks, settings, expected observations, complete counts, document SHA-256
  hashes, model identities, reference identity and annotation/CFD provenance.
- [Generator](../scripts/generate_demonstrations.py): reuses the original verified
  15-row reference search, performs the two additional complete staging searches,
  checks the invalid input, and deletes the temporary jobs it creates.
- [Focused tests](../tests/test_demonstrations.py): manifest/document integrity,
  scope and coordinate consistency, actual frozen CFD recomputation, private-token
  absence and optional direct FASTA verification on the VM.
- [Pinned public reference source](https://ftp.ensembl.org/pub/release-115/fasta/homo_sapiens/dna/Homo_sapiens.GRCh38.dna.primary_assembly.fa.gz)
  and [annotation source](https://ftp.ensembl.org/pub/release-115/gtf/homo_sapiens/Homo_sapiens.GRCh38.115.gtf.gz).

No supplied private assay rows, labels, coordinates or training examples were used.
The examples are distinct from the [supplied-data diagnostic report](validation/web-diagnostics.json).
They do not substitute for an independent usability evaluation with researchers.

For a manuscript, these examples support a description of the accessible
workflow and its outputs. They do not establish faster researcher task
completion, better biological prioritization or improved prediction accuracy.
A biological-insight use case would need a documented biological question,
appropriate evidence and a supported interpretation. A human usability study
would need real participants and recorded outcomes; the existing
[usability-study protocol](usability-study.md) is a plan, not a completed study.

Validation on 19 September 2026: **12 tests passed on the VM**, including direct
FASTA confirmation of all 15 distinct oriented candidate loci across the two
nonempty examples. Both newly created staging jobs were deleted. The complete
four-file demonstration bundle is approximately 209 KiB uncompressed.
