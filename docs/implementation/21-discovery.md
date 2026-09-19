# Improvement 21 — Gene and interval guide discovery

Status: implemented and integrated on staging, 19 September 2026. Production
activation remains with the coordinator. This is a usability feature for the
published model; it introduces no model or on-target-efficiency claim.

## User workflow

In **Genome search**, open **Start from a gene or genomic region**. Optionally
look up an exact, case-sensitive gene name (for example `TP53`) or an unversioned
Ensembl gene/transcript ID. Review the returned loci and choose one explicitly.
Names with multiple annotation matches show every returned locus. No canonical
transcript or exon is selected automatically; gene/transcript spans include
introns. Aliases, version suffixes and transcript names are unsupported and
described as such.

Enter or narrow a **1-based inclusive** GRCh38 interval of 23–20,000 bases. The
service reads only that interval from the checksum-verified indexed FASTA and
enumerates both strands. Each entire 23-base site, including its actual NGG PAM,
must fit inside the interval. Windows containing ambiguous DNA are excluded and
their number is shown. Repeated sequences at different loci and both strands at
one locus are retained independently.

If the interval contains more than 200 sites, the entire request is rejected with
instructions to narrow it. No truncated coordinate-ordered list is shown as a
complete result. Returned sites are ordered by reference position and strand;
they are **not ranked by efficiency or specificity**. The user selects a site and
explicitly adds its actual 23-mer and intended reference locus to the existing
genome input. This never automatically submits a scoring job.

## Files and integration contract

- `backend/offtargetpred/discovery.py`: `discover_guides` and `lookup_genes`.
- `frontend/src/components/GuideDiscovery.tsx` and `.css`: bounded local workflow.
- `frontend/src/features/guideDiscovery.ts`: coordinate conversion and response
  validation.
- `tests/test_discovery.py`, `tests/frontend/guideDiscovery.test.ts` and
  `tests/browser/guide_discovery.py`: focused checks.

Parent integration uses existing origin/content-type/body-size checks, strict
GRCh38 schemas, shared tool admission limits, and worker-thread execution:

| Endpoint | Request | Response |
| --- | --- | --- |
| `POST /api/v1/discover-genes` | `{query, assembly:"GRCh38"}` | `{query, matches, status, complete:true, selection_required:true, annotation, limitations}` |
| `POST /api/v1/discover-guides` | `{chromosome,start,end,assembly:"GRCh38"}` with 0-based half-open coordinates | `{guides,scope,assembly,reference_sha256,selection_required:true,limitations}` |

Guide entries implement the existing `ResolvedGuideLocus` type: full-site
`start`/`end`, separate spacer coordinates, strand, `target23`, actual `pam`,
assembly, coordinate convention and reference SHA-256. Reference aliases use
the same explicit canonical chromosome mapping as the spacer resolver. The
component accepts `{available, genesAvailable, onResolved}` and reuses the
existing `useResolvedGuide` callback. Capability flags are `guide_discovery` and
`gene_lookup`.

Validation errors return HTTP 422; incompatible/unavailable annotation or
reference returns HTTP 503. Gene matches are capped at 25 with whole-request
rejection if exceeded. Gene SQL is parameterized, exact-match and read-only, with
an eight-second query execution bound; timeout never returns partial matches.
The existing `AnnotationIndex` verifies its database hash and reference binding
before querying. Verification occurs before this SQL time limit. No new index,
configuration file, external API, telemetry or reference download is required.

## Verification on the de.NBI staging VM

- 23 backend tests cover both strands, actual PAMs, half-open boundaries, full-site
  containment, ambiguous reference bases, repeated sites, two strands at one
  interval, 200-site limit, invalid inputs, gene ambiguity, literal SQL inputs,
  transcript identifiers, annotation mismatch, timeout and nontruncating limits.
- Four frontend tests cover exact human-to-API coordinates, compatible complete
  responses, reference identity, site bounds, empty results and gene ambiguity.
  The combined frontend suite passed **134 tests** at this stage.
- Actual Ensembl 115 `TP53` lookup returned `ENSG00000141510` at
  `17:7,661,779–7,687,546` (minus strand), with explicit narrowing required, in
  3.9 seconds including annotation verification/query.
- Chromium and Firefox exercised the actual staging APIs: gene lookup, explicit
  choice, large-span and >200-site rejection, a narrowed 500-base interval with
  **71 sites**, plus- and minus-strand selection, actual guide prefill and intended
  loci. No prediction job was submitted, and neither browser reported JavaScript
  errors. Both 390px and 320px layouts had no page overflow. The 320px screenshot
  was visually inspected; the candidate table scrolls within its own region.
- Browser artifacts: VM `output/guide-discovery/`. Run the tracked browser script
  against a staging instance with the pinned reference and annotation available.

## Deliberate scope

This feature discovers sequence-eligible sites, not experimentally optimal
guides. It does not assess variants, chromatin, transcript preference, cell
context or on-target activity. The selected guide still needs a separate
off-target search. No model weights, tokenizer behavior or existing score
semantics were changed. The request stays on the configured backend, and the
browser makes no third-party annotation or sequence request.
