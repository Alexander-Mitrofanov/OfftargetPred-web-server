# Improvement 6 — 20-nt spacer and explicit locus/PAM resolver

## Delivered files

- `backend/offtargetpred/reference.py`: bounded, read-only FASTA reader, explicit chromosome aliases, cached reference/index verification, and offline FAI builder.
- `backend/offtargetpred/resolver.py`: `resolve_guide(reference_path, reference_metadata, spacer, chromosome, start0, end0)`.
- `deploy/prepare-fasta-index.py`: build standard `.fai` plus a SHA-256-bound `.fai.json` sidecar beside an existing verified FASTA or in a separate staging directory.
- `tests/test_resolver.py`: 48 synthetic tests, including sequence orientation, interval boundaries, malformed and modified inputs, provenance and complete bounded matching.
- `frontend/src/components/GuideResolver.tsx` and `GuideResolver.css`: optional accessible resolver with explicit match selection and local pagination of all returned matches.

This adds a convenience workflow for published CRISPert inputs. Model checkpoints, tokenization, scores, and training are unchanged. It does not implement a new prediction algorithm.

## Coordinates and matching semantics

The UI accepts **20 unambiguous DNA bases**, a GRCh38 chromosome and a **1-based inclusive interval of 20–10,000 bases**. A 20-base interval specifies an exact spacer locus. The UI converts `(first, last)` to backend `[first - 1, last)` exactly once.

The complete 20-base protospacer must lie inside the requested interval. The reader fetches up to three additional bases on each side to determine the actual adjacent PAM. Both strands are searched, and **every exact spacer with an unambiguous reference NGG PAM** is returned. There is no whole-genome uniqueness claim. Unknown bases, absent PAMs at chromosome ends, and non-NGG PAMs do not produce matches. RNA U is rejected rather than converted.

Each match contains:

```json
{
  "chromosome": "1",
  "start": 50,
  "end": 73,
  "spacer_start": 53,
  "spacer_end": 73,
  "strand": "-",
  "target23": "GACTACGATCGTAGCTACGTTGG",
  "pam": "TGG",
  "assembly": "GRCh38",
  "coordinate_system": "0-based half-open, forward-reference coordinates",
  "reference_sha256": "<verified FASTA SHA-256>"
}
```

The example uses a synthetic reference. `start/end` always span the complete 23-base site including PAM. `spacer_start/spacer_end` always span the 20-base protospacer, also in forward-reference coordinates. A minus-strand `target23` is the reverse complement of the reference `[start, end)` **once**; it is already oriented 5′→3′ for model input. Callers must not reverse-complement it again. The UI displays coordinates as `start + 1` through `end` and reports strand explicitly.

The returned document also includes the normalized spacer, `matches`, `reference_sha256`, `assembly`, `selection_required: true`, and `scope`. Scope records the requested/canonical chromosome, requested and fetched intervals, both searched strands, exact matching rule, coordinate convention, reference coverage, and `complete: true`. Zero matches means zero within that complete bounded interval. All matches are retained; the UI shows 50 per page while preserving the complete response.

Exact reference contig names are accepted. Alias pairs are restricted to `1`/`chr1` through `22`/`chr22`, `X`/`chrX`, `Y`/`chrY`, and `MT`/`chrM`. No arbitrary `chr` stripping, accession substitution or assembly conversion occurs.

## Reference integrity and reuse

`load_reference(path, metadata)` requires `verified: true`, `assembly: GRCh38`, the exact basename and SHA-256 in the supplied reference metadata. It requires both `FASTA.fai` and `FASTA.fai.json`. The builder hashes every FASTA byte and checks sequence characters, contig uniqueness, sequence wrapping, line endings, contig counts, and total bases. It refuses to overwrite outputs or alter the FASTA.

The reader verifies FASTA and FAI hashes, sidecar provenance, contig coverage, safe file offsets, first/last line geometry and physical header boundaries. Verification is cached once per process and file identity, under a lock so concurrent requests do not repeat a cold verification. Changes to file size, inode, device, mtime or ctime invalidate the cache. Interval reads check identity again and fail closed for truncated reads, inconsistent sequence length or non-DNA content. The actual indexed reader is safe to share between threads: each read opens its own handle, and results are not held in a shared cursor.

Shared reader API for later gene, interval, primer and viewer work:

```python
reference = load_reference(fasta_path, reference_metadata)
contig = reference.resolve_contig("chr1")
lengths = reference.contigs  # fresh name -> length mapping
sequence = reference.fetch(contig, start0, end0, max_bases=10_006)
```

`fetch` returns uppercase forward-reference sequence, preserves unknown IUPAC letters, and enforces a maximum of 1,000,000 bases per call, with a caller-supplied lower bound. `ReferenceUnavailable` indicates unusable reference/index installation. Resolver user-input errors use the existing `sequence.ValidationError`.

## Coordinator integration

1. Install the two staged index files beside the existing verified FASTA, service-readable as `root:offtarget`, mode `0640`. The FASTA and its original reference metadata remain the source of truth.
2. Prewarm `load_reference(...)` in a thread pool during readiness checks/startup. The first full hash verification is intentionally outside the event loop. Expose an availability capability only when compatible reference/index access succeeds; the helper UI has `available: boolean` and remains disabled otherwise.
3. Add `POST /api/v1/resolve-guide` with a small request-byte bound, request-rate bound, GRCh38-only validation, and a thread-pool call to `resolve_guide`. Request fields are `{spacer, chromosome, start, end, assembly}`; `start/end` are already **0-based half-open**. Translate `ValidationError` to a user input error and `ReferenceUnavailable` to unavailable status. The pure module has its own 10,000-base interval bound.
4. Import `{ GuideResolver }` from `./components/GuideResolver` and render `<GuideResolver available={...} onResolved={(guide23, locus) => ...} />` beside the ordinary guide input. Callback receives `ResolvedGuideLocus`, exported by the component. No callback occurs until the user selects a radio button and clicks **Use selected 23-nt guide**. Even a single match is never silently selected.
5. Add the callback's already-oriented `guide23` to the ordinary 23-nt guide input and retain locus metadata if desired. Continue to accept direct 23-nt input when the helper is unavailable. Editing helper fields clears old results; late responses are discarded. Enter in a resolver input resolves the spacer without submitting the surrounding prediction form.

Root-owned API, configuration, shared API types and App files were not changed by this worker.

## Validation and staged artifacts

- `pytest -q tests/test_resolver.py`: **48 passed**, locally and on the VM's Python 3.12 test environment.
- `npm run build`: passed with the component and scoped stylesheet.
- Isolated headless Chromium checks passed: disabled capability, 1-based display to 0-based request conversion, no automatic match selection, explicit minus-strand callback, input-change invalidation, RNA rejection, zero-hit message, late-response rejection, Enter behavior inside a parent form, and 375-pixel mobile layout. Temporary UI harness and script were kept outside delivered application sources; screenshots were inspected.
- Max-interval repetitive fixture confirms all 9,981 overlapping exact matches are returned, including a PAM extending just outside the requested interval.

VM staging directory: `/srv/crispert/staging/resolver`.

- `Homo_sapiens.GRCh38.dna.primary_assembly.fa.fai`
- `Homo_sapiens.GRCh38.dna.primary_assembly.fa.fai.json`
- `verified-resolver-smoke.json`: exact plus/minus loci, targets, provenance and timing.
- FASTA SHA-256: `1e74081a49ceb9739cc14c812fbb8b3db978eb80ba8e5350beb80d8ad8dfef3b`.
- FAI SHA-256: `0998f61682f4041b11f0d156e1db6dae3e4c743e26643a3f45ea7faea70cb604`.
- Indexed coverage: **194 contigs, 3,099,750,718 bases**, from the existing Ensembl 115 primary assembly.

Staged real-reference tests checked an exact plus-strand protospacer at `1:[1000003,1000023)` and minus-strand protospacer at `1:[1000013,1000033)`. Both yielded the expected 23-base reference sequence, PAM and complete-site coordinates. Cold verification took **6.85 seconds**; subsequent exact-locus resolutions took **0.17–0.34 ms** in that run. These timings describe those small checks, not a universal latency guarantee.

The build command was:

```sh
python deploy/prepare-fasta-index.py \
  /srv/crispert/references/GRCh38/Homo_sapiens.GRCh38.dna.primary_assembly.fa \
  /srv/crispert/references/GRCh38/reference.json \
  --output /srv/crispert/staging/resolver/Homo_sapiens.GRCh38.dna.primary_assembly.fa.fai
```

Production reference files and services were not changed by this worker. Index installation, API activation and final integrated deployment remain with the coordinator.
