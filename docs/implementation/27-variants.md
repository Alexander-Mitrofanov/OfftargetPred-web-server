# 27 — Variant and haplotype extension assessment

Dedicated worker: `improvement_27_variants`.

**Disposition: explicitly deferred; no variant or haplotype workflow implemented.**
The completed deliverable is a bounded assessment and support wording in
[Genetic variants and haplotypes](../extensions/variants.md). This optional
research/operational extension does not become a release requirement for the
user's convenient web interface to the already published CRISPert tool.

## Reviewed behavior

- Inspected the shared contracts, council backlog, model card, reference/index
  integrity checks, resolver/discovery, coordinate normalization, annotations,
  reference-context endpoint and flank implementation.
- Confirmed that search and sequence context use the pinned reference only; no
  variant dataset or haplotype construction path exists.
- Distinguished compatible externally supplied allele sequences from supported
  variant discovery. The pair validator can accept a valid 23-mer without proving
  its allele identity, locus, alignment history or biological validity.
- Confirmed that imported coordinates remain unverified and annotation is based
  on positional overlap. Full candidate/reference disagreement prevents flank
  export, preserving a skip reason instead of changing the candidate.
- Documented public variant annotation as a separate smaller feature; enumerated
  prerequisites for variant and haplotype search, coordinate mapping, provenance,
  phase/allele combinations, completeness, scoring eligibility and individual-data
  handling. Primary VCF, Ensembl VEP and CRISPRme documentation was consulted.

## Files and integration

- `docs/extensions/variants.md`
- `docs/implementation/27-variants.md`

No shared-code files, model weights, tokenizer, reference, annotation data, public
services or API capability flags changed. No VCF/personal data was downloaded or
uploaded. The coordinator can link the assessment from the support matrix and
record #27 as “assessment complete; extension deferred”, rather than “implemented”.
User-facing support wording is provided in the assessment for selective reuse.

## Verification

Existing reference-context, coordinate metadata and API boundary tests passed
on the de.NBI staging VM: **59 passed, 1 skipped in 0.62 seconds**. The skipped
check is the opt-in full public FASTA test, because `OFFTARGET_DEMO_REFERENCE`
was not set for this focused run. The passing cases include plus/minus strand
agreement, reference-sequence mismatch skips, coordinate bounds and rejection of
forged reference-verification metadata. No tests were added for this
documentation-only assessment, and no variant search, variant-specific model
performance or patient-data handling was evaluated.

```bash
cd /srv/crispert/staging/nar-v2
sudo -n env \
  PYTHONPATH=/srv/crispert/staging/nar-v2/backend:/srv/crispert/venv/lib/python3.12/site-packages \
  /srv/crispert/staging/test-venv/bin/python -m pytest -q \
  tests/test_followup.py tests/test_input_metadata.py tests/test_reference_api.py
```
