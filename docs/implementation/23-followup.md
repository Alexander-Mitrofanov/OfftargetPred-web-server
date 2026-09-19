# Improvement 23 — Experimental follow-up preparation

Status: reference-flank export implemented and integrated on de.NBI staging,
19 September 2026. Production activation remains with the coordinator.

## Delivered scope

The selected-result workflow exports verified local GRCh38 reference flanks and
linked JSON provenance. It supports the published tool's practical usability;
it introduces no model, calibration, experimentally validated primer or new-method
claim. Primer3 design and genome-wide amplicon specificity remain deliberately
deferred until a separately validated implementation exists.

The service retains every selected row as either `ready` or `skipped`; it never
guesses missing genomic declarations or silently drops mismatches. Both candidate
strands are verified against the actual reference. Forward-reference flanks have
explicit candidate offsets, boundary clipping flags, ambiguity counts and hashes.
At most 20 loci and 1,000 bases per side are accepted: a maximum of 40,460 context
bases per request. Nothing is sent before the explicit preparation action.

## Owned files and integration

- `backend/offtargetpred/followup.py`: `reference_context(path, metadata, records,
  flank_bases=250)`; strict request validation followed by bounded verified
  reference access. Uses existing `ValidationError` and `ReferenceUnavailable`.
- `frontend/src/features/followup.ts`: minimal request builder, response
  completeness/geometry checks and JSON export.
- `frontend/src/components/FollowupPreparation.tsx` and `.css`: accessible,
  progressively disclosed preparation and download controls. Props are
  `{selectedRows: ResultRow[], available?: boolean}`; unavailable by default.
- `tests/test_followup.py`, `tests/frontend/followup.test.ts` and
  `tests/browser/reference_flanks.py`: verification described below.
- `docs/experimental-followup.md`: user instructions, conventions, limitations
  and API contract.

The coordinator integrated `POST /api/v1/reference-context`, strict top-level
schema, the 16 KiB request bound, origin/content-type handling, shared tool
admission, thread-pool execution and the `reference_context` capability. The
component appears in real and example result workspaces using the existing
explicit candidate selection. Changes to selected data, flank length or service
availability invalidate old results and prevent stale asynchronous responses
from restoring them. No shared App/API/Workspace files were edited by this worker.

## Verification on the VM

- **24 backend tests passed**, including strict pre-I/O bounds, duplicate
  selections, every skip category, unambiguous candidate enforcement, both
  strands, aliases, zero flanks, boundary clipping, ambiguous flank bases,
  caller-input preservation, SHA-256 values and reference-integrity failures.
- Actual Ensembl GRCh38 FASTA checks passed for public frozen-example sites on
  plus and minus strands and a 23-mer near the shortest installed contig's end.
  Returned contexts were independently re-fetched from the verified reference.
- **Six focused frontend tests passed** inside a combined **163-test** frontend
  run. The TypeScript check and production frontend build passed on the VM.
- **Chromium and Firefox** exercised the real staging API from the public
  examples: explicit selection, keyboard expansion/submission, both strands,
  downloaded FASTA SHA-256, full JSON preservation, zero-flank downloads and
  stale-download clearing after selection/input edits. No prediction jobs were
  created. Selection and input edits made no implicit POST requests.
- A controlled browser request fixture changed one candidate base while keeping
  its declared locus. The **real API** returned the sequence-mismatch skip reason;
  the UI displayed it, disabled the empty FASTA and retained the metadata download.
  This test did not substitute a canned API response.
- Both browsers passed 390px and 320px page-overflow checks without JavaScript
  errors. The 320px public-example panel screenshot was visually inspected; the
  outcomes table scrolls horizontally inside its own region.

VM browser artifacts are under `output/reference-flanks/`. Focused commands:

```bash
OFFTARGET_DEMO_REFERENCE=/path/to/verified/reference.fa python -m pytest -q tests/test_followup.py
node --experimental-strip-types --test tests/frontend/followup.test.ts
python tests/browser/reference_flanks.py --url http://127.0.0.1:5182/ --artifacts output/reference-flanks
```

The first test command requires the same adjacent `.fai` and verified index
manifest used by the service. Without the opt-in reference environment variable,
the actual-genome check is explicitly skipped; synthetic interval tests still run.
No model weights, tokenizer behavior, scientific score semantics or production
services were changed by this improvement.
