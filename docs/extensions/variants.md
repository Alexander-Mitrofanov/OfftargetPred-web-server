# Genetic variants and haplotypes: current boundary

Reviewed 19 September 2026. **Status: deferred; variant-aware and haplotype-aware
discovery are not implemented.** This release provides a convenient interface to
the published CRISPert model. Personalized-genome analysis is a separate optional
extension, not a prerequisite for this web-interface contribution.

## Supported workflow today

| Workflow | Actual behavior |
| --- | --- |
| Genome candidate search | Searches the installed, verified Ensembl 115 GRCh38 primary reference with NGG PAMs, both strands and 0–4 protospacer substitutions. It reads no VCF, genotype, phased haplotype or alternative personal assembly. |
| Guide discovery and 20-nt resolution | Finds sequences and actual PAMs in that same reference. A locus selection does not introduce an alternative allele. |
| Pair scoring | Scores supplied, aligned, ungapped 23-nt guide/candidate sequences using the unchanged checkpoints. A sequence prepared elsewhere from an allele can satisfy this input contract, but its acceptance establishes only sequence compatibility. |
| Imported coordinates | Checks declared GRCh38 coordinates, strand and a 23-base interval. Labels them `user-supplied, not reference-verified`; it does not infer allele identity, genotype or phasing. |
| Gene/transcript context | Reports overlap of the declared interval with pinned reference annotations. On imported coordinates this is positional context, not proof that the supplied allele occurs there or a prediction of its functional effect. |
| Reference-flank export | Requires exact agreement between the entire candidate 23-mer and its declared reference locus, accounting for strand. A differing allele is retained as a skipped record with `reference_sequence_mismatch`; reference sequence is not silently substituted for that allele. |

These boundaries are enforced in `sequence.py`, `input_metadata.py`, `search.py`,
`resolver.py`, `discovery.py`, `annotations.py` and `followup.py` under
`backend/offtargetpred/`. The [model card](../model-card.md) defines the unchanged
scoring domain. The local genomic-context viewer also preserves the distinction
between declared coordinates and verified sequence.

### Supplying an externally prepared allele sequence

The pair workflow may accept two complete 23-nt sequences with each actual PAM,
already in the guide orientation with PAM last. Preserve the external source and
allele interpretation in the accompanying research records. The service cannot
reconstruct that history from the sequence alone and does not validate a variant
identifier or haplotype.

Do not replace a variant position with `N` to represent alternative alleles:
`N` creates unknown k-mer tokens; it does not enumerate or marginalize genotypes.
Do not strip gaps, trim an indel alignment or invent a PAM to satisfy the input
length. A sequence containing an indel-derived region can happen to be 23 bases
long; that alone does not establish correct alignment or a valid reference
interval. When a defensible reference locus is unavailable, omit all optional
coordinate fields and use sequence-only scoring. Coordinate-based views and
reference-flank preparation will then be unavailable for that row.

Outputs remain separate, uncalibrated CRISPert scores. Comparing two externally
prepared allele sequences is a model-output comparison, not validated prediction
of allele-specific editing, patient risk, population prevalence or discovery
completeness. No variant-specific performance evidence was established here.

## Three distinct future features

1. **Public variant annotation:** intersect already found reference candidates
   with a pinned public variant release. This can flag known overlapping variants,
   with source and allele frequencies where available. It cannot find candidates
   or PAMs created by variants, prove that a sample carries an allele, or establish
   that several alleles occur together.
2. **Variant-aware candidate discovery:** search explicitly constructed alternative
   sequences as well as the reference, including variant-created/lost PAMs and
   changed mismatch counts. It needs a defined allele-combination policy and a
   complete candidate contract before any claim of coverage.
3. **Haplotype-aware discovery:** restrict combinations using actual genotype and
   phase information. Missing or unphased calls need an explicit treatment; arbitrary
   combinations must not be labelled observed haplotypes. Phase-block boundaries
   also constrain what is known to occur on the same chromosome copy.

The VCF specification defines reference/alternative alleles, genotype separators
and phase-set information; these are inputs a future implementation would have to
interpret explicitly. [VCF 4.5 specification](https://samtools.github.io/hts-specs/VCFv4.5.pdf)

Ensembl VEP provides variant consequence annotation. Such annotation is a distinct
operation from searching for all off-target candidates in alternative genomes.
[Ensembl VEP documentation](https://www.ensembl.org/info/docs/tools/vep/index.html)

CRISPRme documents variant- and haplotype-aware off-target nomination from a
reference and variant datasets, making its approach a possible integration to
assess. Its current repository also points new development to CRISPRme+; any
future integration must select and pin the actual maintained implementation.
Neither tool was installed, benchmarked or integrated for this assessment.
[Official CRISPRme repository](https://github.com/pinellolab/CRISPRme)

## Requirements before enabling an extension

- **Define the user task and candidate universe.** Choose public variant context,
  population discovery or explicitly consented individual analysis. State covered
  assemblies, contigs, variant classes, alleles, PAMs and mismatch/alignment rules.
  Public annotation is a smaller first step if user demand justifies it.
- **Pin compatible inputs.** Record reference FASTA and index hashes, assembly,
  contig mappings, variant release/source/hash, access terms, filtering criteria
  and normalization version. Validate each reference allele against the exact
  FASTA. Define handling of multi-allelic, overlapping, symbolic and structural
  variants, missing calls and reference gaps; unsupported records must be counted
  and explained rather than silently discarded.
- **Represent the actual allele and phase.** Preserve stable variant IDs where
  available, reference/alternative alleles, genotype/ploidy, phase status/block,
  sequence orientation and the construction history of every searched sequence.
  A versioned mapping must relate personal/haplotype coordinates back to reference
  coordinates, particularly across indels. A list of nearby variants is not a
  haplotype. Do not infer sample genotypes from population allele frequencies.
- **Preserve completeness and provenance.** Give allele-specific candidates stable
  identities and retain multiple alleles/alignments at a locus. Report searched,
  unsupported and unscored denominators separately; document any merging policy.
  Search both existing and variant-created PAM sites. Bounds, timeouts or exhausted
  allele combinations must never produce an unqualified complete-result claim.
- **Keep scoring eligibility separate.** Only genuinely compatible, aligned,
  ungapped 23-nt pairs can enter the current model. Incompatible records require
  unavailable scores and explicit reasons, with no fabricated zero or score rank.
  Discovery support does not establish model accuracy on that candidate domain.
  Validate any advertised allele-specific accuracy with suitable observations;
  new scoring claims require evidence, even if no new model is proposed.
- **Validate search and operation on de.NBI.** Start with small public/synthetic
  references where exhaustive enumeration is practical. Cover both strands,
  PAM creation/loss, adjacent substitutions, phased/unphased combinations,
  phase-block boundaries, indels and duplicate representations. Measure recall
  against known candidates, resources, cancellation and failure behavior before
  selecting public limits. No capacity or latency promise is made here.
- **Design individual-data handling first.** The current short-lived job capability
  does not by itself constitute a design for personal genomes. Establish the
  permitted data and purpose, authorized access, retention/deletion, logging,
  backup exclusions and deployment responsibilities. A local/private workflow may
  be preferable. Never send uploaded alleles or sample identifiers to third-party
  annotation services automatically or include them in public examples.

## Suggested user-facing wording

**Support matrix:** “Genetic variants and haplotypes: not searched. Genome mode
uses the GRCh38 primary reference. Pair mode scores supplied compatible sequences
and does not verify allele identity or population/sample coverage.”

**Reference-flank mismatch:** “This candidate differs from the installed reference
at the declared locus. Reference flanks were not exported for this row. Check the
sequence, strand and coordinates; an alternative allele may require its own
externally prepared context.”

**Empty-search explanation:** “No candidates were found within the selected
reference, PAM and mismatch limits. The search excludes genetic variants and
does not establish absence of off-target sites in an individual's genome.”

No upload control, variant-aware badge or haplotype claim should be enabled until
the corresponding workflow, data contract and checks above are delivered.
