# Search scope and extension decisions

**Decision, 19 September 2026:** retain the existing bounded genome search for
this web-interface release. The supplied, published CRISPert models stay
unchanged. Wider SpCas9 search is technically plausible, but the present evidence
does not establish its genomic retrieval, cost or model performance. This
assessment completes the scope review; it does **not** implement new search modes.

## What users can do now

| Workflow or extension | Support | Meaning and next decision |
|---|---|---|
| GRCh38 primary assembly, NGG, 0–4 protospacer substitutions, both strands | Supported genome search | Pinned Ensembl release 115 FASTA and Cas-OFFinder 2.4.1. Complete results within the configured limits; an exceeded limit fails the job. |
| Known aligned 23-base candidate pairs, including non-NGG candidate PAMs or more than four substitutions | Accepted in pair scoring | Sequence shape is compatible with the supplied models. This is user-supplied candidate scoring, without genome-wide enumeration or a new accuracy claim. Input provenance and model limitations remain visible. |
| NGG with five or six substitutions | Deferred | Same ungapped 23-base representation. Measure full-reference enumeration, candidate volume, runtime, failure rates and exact-checkpoint performance before enabling. |
| Additional three-base SpCas9 candidate PAMs, such as NAG | Deferred | Same input shape; PAM expansion requires an explicit pattern set, verified enumeration and model-stratum assessment. A supplied positive row is insufficient to validate a new service mode. |
| GRCh37/hg19 | Deferred | Requires a separately pinned reference and matching annotations, resolver/browser/export assembly handling, exact-locus retrieval tests and a transfer assessment. Do not relabel GRCh38 coordinates or silently lift them. Prioritize only when users need it. |
| Mouse reference | Deferred | Requires demonstrated user demand, a pinned assembly and annotation release, species-aware coordinate and browser handling, and evidence for transfer of these checkpoints to the intended use. No mouse reference or validated workflow is installed by this improvement. |
| Alternate haplotypes, personal variants or bulges | Outside current discovery | Not searched by the current primary-reference, ungapped workflow. See the separate extension assessments; neither primary-reference coverage nor a score implies personalized-genome coverage. |

Pair inputs must already contain the actual three-base PAM, be oriented with PAM
last, and have no gaps. The pair parser accepts `N` with a warning; genome queries
and returned candidates must be unambiguous. Keeping a compatible input does not
make its score a calibrated cleavage probability. See the [model card](model-card.md)
and [input/import contract](import-formats.md).

### Current discovery contract

- Reference: `Homo_sapiens.GRCh38.dna.primary_assembly.fa`, Ensembl 115,
  SHA-256 `1e74081a49ceb9739cc14c812fbb8b3db978eb80ba8e5350beb80d8ad8dfef3b`.
  The pinned primary-assembly file has 194 contigs. Its scope does not include
  every alternate human haplotype or user-specific variant.
- Engine: Cas-OFFinder 2.4.1, source commit
  `9816b94c20c4cba2e79b039e1e2a6dee684b7b66`.
- At most 10 guides, 50,000 result rows and a 900-second whole-job time budget
  in the current configuration. The budget includes processing after search;
  these bounds are not a promise that every allowed request will complete.
- Mismatches count positions 1–20 only. The discovery query substitutes `NNN`
  for the guide PAM and restores the original actual PAM for model input.
  Returned candidate PAMs must satisfy NGG. Both strands are searched.
- Coordinates are 0-based half-open intervals covering all 23 bases. Minus-strand
  candidate sequences are already oriented with PAM last. A complete search may
  have no hits, many perfect-spacer matches, or several identical 23-base matches;
  none automatically determines a unique intended locus.
- Exceeded timeout, row or output-size bounds fail the job. Results from a partial
  enumeration are not labelled complete. Job metadata preserves reference,
  engine, mismatch limit and model fingerprints.

These statements follow the current [search implementation](../backend/offtargetpred/search.py),
[settings](../backend/offtargetpred/config.py) and [model card](model-card.md).
Cas-OFFinder itself exposes a search pattern and mismatch count; this service's
limits are additional product decisions. Its upstream documentation describes
variable PAM patterns and mismatch limits, but those capabilities alone do not
validate a new OfftargetPred mode. [Cas-OFFinder documentation](https://github.com/snugel/cas-offinder/blob/develop/README.md?plain=1).

## What the supplied datasets say about the filters

The [aggregate report](validation/search-scope.json) was produced on the de.NBI VM
using [this read-only script](validation/audit_search_scope.py). It verifies the
four input SHA-256 values against the earlier [dataset audit](nar-readiness/dataset-audit.json),
then counts rows using candidate PAM and protospacer substitutions. No reference
lookup, model inference or genome search is performed. No private sequences,
coordinates or row identifiers are exported.

### Positive rows passing each hypothetical sequence filter

Each denominator is the number of label-positive rows in that supplied file.
NGG+NAG is a string-filter scenario, not an enabled discovery mode. The entire
file is retained; these are not new independent validation partitions.

| Supplied dataset | Current NGG ≤4 | NGG ≤5 | NGG ≤6 | NGG+NAG ≤4 | NGG+NAG ≤6 |
|---|---:|---:|---:|---:|---:|
| Full K562, 188 positive rows | 91/188 | 146/188 | 177/188 | 100/188 | 187/188 |
| K562 DeepCRISPR, 118 positive rows | 117/118 | 117/118 | 118/118 | 117/118 | 118/118 |
| iPSC, 53 positive rows | 37/53 | 50/53 | 52/53 | 38/53 | 53/53 |
| Reported T-cell training corpus, 1,266 positive rows | 774/1,266 | 1,013/1,266 | 1,078/1,266 | 870/1,266 | 1,184/1,266 |

Of the 97 full-K562 positives outside the current string filter, 86 have an NGG
PAM and more than four substitutions, ten have a non-NGG PAM and at most four
substitutions, and one has both differences. The eleven non-NGG positives comprise
ten NAG and one NGA candidate PAMs. These counts identify potential follow-up
strata; they do not show that the service missed 97 reference-retrievable loci.

### All supplied rows passing the filter

| Supplied dataset | All rows | Current NGG ≤4 | NGG ≤5 | NGG ≤6 | NGG+NAG ≤4 |
|---|---:|---:|---:|---:|---:|
| Full K562 | 43,132 | 1,253 | 9,745 | 19,384 | 2,595 |
| K562 DeepCRISPR | 18,421 | 847 | 3,591 | 5,996 | 2,015 |
| iPSC | 25,741 | 431 | 3,345 | 25,740 | 432 |
| Reported T-cell training corpus | 51,906 | 1,281 | 5,610 | 28,885 | 1,972 |

The large changes in supplied row counts illustrate how candidate universes can
differ. They are **not estimates of whole-genome candidate counts, GPU cost or
retrieval recall**. Dataset candidate generation and label-zero generation remain
incompletely traced. A label-zero row is not automatically a proven biological
negative. Files share some guides and pairs, so do not sum their results as
independent observations. Actual checkpoint training membership is unresolved.
See [scientific provenance](science/README.md).

All 139,200 rows across these four files have unambiguous 23-base sequences under
this audit, and no rows are deduplicated. The script nevertheless explicitly
excludes pairs containing `N` from strict hypothetical filters. It publishes
thresholds 0–6 and 20; threshold 20 removes the substitution limit within this
fixed input shape, and does not extend it to indels.

## What has and has not been measured

- **Sequence eligibility:** measured above, including the same 91/188 K562 count
  previously reported. This checks two strings without establishing assembly,
  genomic presence, correct intended locus or actual search retrieval.
- **Search implementation behavior:** synthetic fixtures check expected counts,
  both-strand coordinate handling and zero-hit behavior. Public-reference
  [worked examples](case-studies.md) preserve actual complete 15-hit, 13-hit and
  zero-hit results. They establish software behavior, not assay sensitivity.
- **Runtime of the existing mode:** the [performance measurements](implementation/24-performance-measurements.json)
  contain two repeats of one public guide at one mismatch, with 15 candidates and
  all three models. On that V100 VM, search took 22.084–22.097 seconds and whole
  child execution 28.173–28.308 seconds. These small runs are not a stress test or
  a latency guarantee and cannot establish five-/six-mismatch or new-PAM cost.
- **Actual assay-site genome retrieval and expanded-scope accuracy:** not measured
  here. The existing complete-file ranking diagnostics answer a different question.

## Requirements before an expansion

1. Record the requested biological workflow and choose one bounded extension.
   Wider ungapped 23-base SpCas9 enumeration need not change the model architecture;
   correctness and usefulness still require evidence for the exact served models.
2. Freeze the reference, explicit PAM set, query orientation and parser rules.
   Add planted both-strand boundary fixtures, recomputed mismatch checks and
   expected exact coordinates; independently verify full-reference retrieved
   sequences for a representative set of guides.
3. Where original assay coordinates and assembly are traceable, reconcile labels
   to that reference and measure nomination/retrieval separately from score
   ranking. Report unresolved reference mappings instead of treating them as misses
   or quietly dropping them. Preserve guide overlap and training-membership caveats.
4. Measure complete jobs on the VM across representative guides and worst-case
   repetitive targets: candidate counts, search/scoring phases, peak memory,
   temporary disk, timeout/cap failures and queue effects. Keep fail-closed bounds;
   a deliberately truncated list is not a successful expanded search.
5. Assess ranking by PAM and mismatch stratum with the unchanged checkpoints and
   label assumptions visible. Do not infer generalization from aggregate pooled
   AP or from the mere presence of such rows in the reported training corpus.
6. For another assembly/species, pin matching annotation and browser conventions,
   test resolver/export/locus behavior, and assess the appropriate transfer claim.
   Release capabilities, UI help and exported scope metadata together only after
   the new path has passed these checks.

This list is an extension acceptance plan, not a prerequisite for offering the
current useful web interface or a claim that NAR requires every extension.

## Suggested interface/API wording

Coordinator integration suggestions; this worker does not modify shared UI/API files:

- Genome form: **“Search GRCh38 primary assembly · NGG · both strands · 0–4 spacer
  mismatches. Limits: 10 guides and 50,000 candidates. Searches that exceed a limit
  fail without a partial result.”**
- Help: **“Genome search does not enumerate non-NGG PAMs, sites beyond your chosen
  mismatch limit, bulges, or personal variants. You can score your own aligned
  23-base candidate pairs separately.”**
- Pair form: **“Known candidate scoring does not verify that a site exists in the
  selected reference. Model scores describe these submitted pairs; they are not
  cleavage probabilities.”**
- Zero hits: **“No candidates were found within this reference, PAM and mismatch
  scope. This does not show that the guide has no off-target activity.”**
- Preserve the existing mismatch maximum of four and assembly literal in API
  validation. Do not add selectable disabled assembly/PAM controls that suggest a
  functioning mode. A help link to this scope decision is sufficient until demand
  and evidence justify an extension.
