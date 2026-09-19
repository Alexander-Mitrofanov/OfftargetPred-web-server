# Improvement 7 — pinned local gene and transcript annotations

## Delivered files

- `backend/offtargetpred/annotations.py`: verified, read-only SQLite integer R-tree; streaming GTF preparation; bounded row annotation.
- `deploy/prepare-annotations.py`: offline builder pinned to the exact Ensembl 115 GTF and deployed GRCh38 primary assembly.
- `tests/test_annotations.py`: coordinate, transcript, provenance, availability and 50,000-row contracts.
- `frontend/src/components/AnnotationDetails.tsx` and its scoped CSS: compact category/gene summary with accessible expandable transcript details.

## Semantics

Annotations describe overlap of **the full 23-nt interval, including the 3-nt PAM**. Candidate and exported feature intervals use **0-based, half-open forward-reference coordinates**. GTF's 1-based inclusive starts are converted by subtracting one. Touching endpoints do not overlap. An annotation does not depend on the candidate strand; both gene strands are considered and each feature's strand is retained.

All overlapping gene, transcript, exon, CDS and UTR intervals are retained. Introns are derived as gaps between merged exons within each transcript on either strand. Categories are the union of `CDS`, `exon`, `UTR` and `intron`; multiple categories can coexist at an exon boundary or across transcript isoforms. `transcript_count` and `ambiguous_transcripts` expose this ambiguity. No canonical transcript is selected. A gene-body overlap without one of those four features has empty categories and is shown as “Gene overlap”.

`intergenic` is assigned only when an interval lies within a verified reference contig and no indexed feature overlaps. Reference contigs with no GTF features still have established annotation coverage. An unknown contig is `unavailable`, not intergenic. Exact Ensembl contig identifiers are required; aliases such as `chr1` are not guessed. Missing coordinates produce `no_coordinates`. Missing/incompatible assembly or coordinate convention, an invalid 23-nt interval, or out-of-range coordinates produce `unavailable` with a reason.

Annotation is genomic context, not evidence of functional harm. It is never fed into the models or used to modify, rank, calibrate or combine model scores. Annotation executes locally without external lookups or automatic outbound user-data requests.

## Integration

The coordinator owns config, worker, API, shared types and App integration.

1. Set `Settings.annotation_db` from `OFFTARGET_ANNOTATION_DB` to the installed `.sqlite` path, with its matching `.json` manifest beside it.
2. In the worker, create `AnnotationIndex(settings.annotation_db, reference_metadata=reference)` once per job (or cache one process-local instance). Opening validates the entire index SHA-256 once and compares the search FASTA hash and assembly. Catch `AnnotationUnavailable` and record the reason. Do not open and hash the large index on every capabilities request; inspect the small manifest there.
3. After inference, set `rows = index.annotate_rows(rows)`. Fallback: `rows = annotate_rows(rows, reason="…")`. Both return a new list in identical order with all input fields and score values preserved. The original rows are not mutated. Results above 50,000 rows raise; no partial result is returned.
4. Add `index.metadata()` to analysis metadata as `annotations`; retain explicit unavailable metadata when the index cannot load. This metadata includes the complete source and reference provenance and all hashes.
5. Add `<AnnotationDetails annotations={row.annotations} />` in the result row/detail area. The component imports the shared `AnnotationResult` type, makes no network requests and uses ordinary accessible `details`, `summary` and a scrollable table.

The integer R-tree stores an inclusive end internally (`end - 1`), so its query `indexed_start < candidate_end AND indexed_end >= candidate_start` is exactly half-open overlap. Candidate lookups use a bounded 4,096-entry LRU cache. All feature rows are retained, including overlapping transcripts; the result is not truncated.

## Pinned inputs

- [Official Ensembl release 115 GTF directory](https://ftp.ensembl.org/pub/release-115/gtf/homo_sapiens/)
- [Complete primary-assembly GTF](https://ftp.ensembl.org/pub/release-115/gtf/homo_sapiens/Homo_sapiens.GRCh38.115.gtf.gz)
- Archive SHA-256: `2f8e31578c3aa2f35646927c4a3b3b0dcf0321e57c0ebd3ecc81afcbc836d1a8`
- Publisher BSD checksum verified: `32658 101949`, from the official release `CHECKSUMS` file.
- Matching FASTA SHA-256: `1e74081a49ceb9739cc14c812fbb8b3db978eb80ba8e5350beb80d8ad8dfef3b`
- Matching reference: `Homo_sapiens.GRCh38.dna.primary_assembly.fa`, Ensembl 115, 194 contigs, 3,099,750,718 bases.

Preparation verifies the pinned archive, hashes the expanded GTF while streaming, rehashes the actual reference FASTA, records all contig lengths, and writes index/source/reference provenance. The index includes only contigs present in that exact FASTA; excluded nonreference feature counts are recorded. Existing destination files are never overwritten. Preparation and tests were staged separately from running production services.

## Validation

Local `python3 -m pytest tests/test_annotations.py -q`: 9 passed. Includes both strands, endpoint/PAM-only overlap, CDS/exon/UTR, transcript-specific introns, multiple isoforms, known feature-free and unknown contigs, source/index/manifest hash failures, incompatible/missing assembly and conventions, immutable inputs, full 50,000-distinct-row completion and the hard row limit. `npm run build` passed with the new component.

The completed VM build and benchmark are recorded below.

### Completed VM artifacts

- Index: `/srv/crispert/staging/annotations/ensembl-115-GRCh38.sqlite`
- Manifest: `/srv/crispert/staging/annotations/ensembl-115-GRCh38.json`
- Source archive: `/srv/crispert/staging/annotations/Homo_sapiens.GRCh38.115.gtf.gz`
- Publisher checksum file: `/srv/crispert/staging/annotations/Ensembl-115-CHECKSUMS`
- Benchmark JSON: `/srv/crispert/staging/annotations/benchmark.json`
- Index SHA-256: `5dd8477439a334bb35c002da7f1e0fcf599f5437fadff2c8c7cedb231231eb6d`
- Expanded GTF SHA-256: `eed078d2d5aedcd6ce3163175a552b03cb6cf6887f03566e4f57b18c085e391f`
- Contig-length map SHA-256: `3acb4fa3ef42660a8e4383df055d08e0e65549ca6c161c0ae64e35cf9f3a637d`
- GTF header: `GRCh38.p14`, assembly accession `GCA_000001405.29`, annotation last updated `2025-05`.

The real index contains 78,899 genes, 509,650 transcripts, 3,683,354 exons, 2,283,168 CDS intervals, 767,221 UTR intervals and 3,173,704 derived introns. All supported source features belong to the matched reference (zero excluded nonreference records).

On the VM's Python 3.12 runtime, a 50,000-row benchmark (25,000 exon starts plus 25,000 deterministically sampled genome-wide sites; 35,105 unique intervals) completed annotation in **8.00 seconds** after **2.82 seconds** to open and SHA-256-verify the 1.3-GB index. It returned **890,166 features** without truncation, including 26,755 rows with multiple overlapping transcripts and 20,369 intergenic rows. Peak process RSS was **485,844 KiB** (about 475 MiB, including original and annotated result lists). Assertions confirmed identical input fields, scores and order for all 50,000 rows. Separate real TP53 and BRCA1 CDS checks passed, with 31 and 35 overlapping transcripts respectively. The exon-start half deliberately stresses transcript density; timings describe this fixture, not a universal response-time guarantee.

Production services were not modified by this worker. The coordinator must install the index and its matching sidecar together in a service-readable data directory, set `OFFTARGET_ANNOTATION_DB`, and activate the integrated application. The original production venv lacks pytest; local tests passed, and the full real-data benchmark used that VM runtime without installing dependencies.
