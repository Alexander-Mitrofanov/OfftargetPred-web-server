# Bulges: current boundary and optional extension

Reviewed 19 September 2026. **Status: unsupported; feasibility assessment complete.**
The web interface exposes the supplied, unchanged CRISPert-small checkpoints.
Adding bulge discovery or a new scoring model is an optional future project, not
a prerequisite imposed on this interface to the published tool.

## What the current service accepts

| Path | Current behavior |
| --- | --- |
| Pair scoring | Two equal, ungapped 23-character DNA sequences: 20 positions plus each actual 3-base PAM. Outer whitespace and letter case are normalized. `N` is allowed with an unknown-token warning; it does not encode a bulge. |
| Genome discovery | GRCh38 primary assembly, NGG, both strands, 0–4 protospacer substitutions; no bulges. |
| Tool imports | Supported ungapped formats only. A gap or unsupported column schema blocks applying the whole import. Valid rows can remain visible in the preview, but no partial normalized CSV is produced. |
| CFD baseline | Gapped or non-23-nt inputs receive no score and an unsupported-input reason. |

A bulge means an alignment in which one sequence has one or more unpaired bases.
The alignment position and the number of genomic DNA bases are distinct concepts.
Deleting `-` or `.` from an alignment removes that correspondence; trimming or
padding to 23 characters also changes the sequence or its positional meaning.
Such transformations must never be presented as scoring the original bulged pair.
An already transformed, gap-free 23-mer carries no reliable record of how it was
made: the service cannot detect that history from its characters alone.

The supplied tokenizer maps unsupported aligned pairs to unknown tokens and can
truncate token sequences to its configured length. That low-level behavior does
**not** establish validated bulge support. `InferenceEngine.score` first calls
the strict pair validator, which rejects gaps and lengths other than 23 before
loading a checkpoint. The tokenizer and checkpoints remain unchanged.

## Verified enforcement

- `backend/offtargetpred/sequence.py` validates both guide and candidate, including
  CSV/TSV aliases. It neither removes internal gaps nor trims sequences to fit.
- `backend/offtargetpred/search.py` accepts exactly six output columns and an
  unambiguous 23-base NGG candidate. A malformed later row fails the search; an
  earlier valid prefix is not returned as a successful complete result.
- `frontend/src/input.ts` and `features/columnMapping.ts` check length and allowed
  characters before submission. `features/toolImports.ts` explicitly rejects
  gap symbols and newer/bulge output formats.
- API capabilities and search metadata state `bulges: false`. A pair submission
  containing one valid row followed by a gapped candidate returns HTTP 422 and
  creates no queued job.

Focused regression checks and their VM results are recorded in
[implementation note 26](../implementation/26-bulges.md).

## Possible discovery integrations

CRISPRitz documents an indexed search with separate DNA- and RNA-bulge limits.
It is a plausible source of candidate alignments, subject to an explicit adapter,
pinned reference/index and resource measurements. Discovery capability alone says
nothing about compatibility with these CRISPert checkpoints.
[CRISPRitz official usage](https://github.com/pinellolab/CRISPRitz#333-mismatches--bulges-search)

CRISPRme documents bulge limits, alternative-alignment output and a merged output
that selects representative candidates. An integration would need to preserve
alignment alternatives and disclose merging choices. Its separately supplied
scores cannot be relabelled as CRISPert outputs.
[CRISPRme official usage](https://github.com/pinellolab/CRISPRme#22-functions)

These are documentation-based feasibility observations, not installation,
performance, accuracy or licence-compatibility claims. Neither tool was installed
or run for this assessment. No search runtime or required storage was estimated.

## Prerequisites before enabling an extension

1. **Choose the user workflow.** Establish demand for either discovery with
   explicitly unscored bulged candidates or scoring with a compatible model.
   Keep the current substitution-only mode available with its existing scope.
2. **Define a separate versioned candidate contract.** Preserve raw guide/site
   DNA, the aligned strings or explicit alignment operations, actual PAM, strand,
   assembly, engine/version, reference/index hashes and search parameters.
   Record DNA/RNA bulge type, lengths and positions separately from substitutions.
   Genomic start/end span actual reference bases, not the number of alignment
   columns. Test both orientations and PAM boundaries against the pinned FASTA.
3. **Preserve the candidate universe.** Give every alignment a stable identity
   and link alternatives at the same genomic locus. Report alignment counts and
   unique-locus counts separately. Document any deduplication/merging policy;
   an output limit or timeout must not become a complete-result claim.
4. **Keep unavailable scores explicit.** A discovery-only record needs a null
   CRISPert score plus a reason such as `unsupported_bulged_alignment`. Never
   replace it with zero, pad/strip the alignment, or place it in CRISPert rank
   statistics. Tables, shortlists, plots and exports must disclose scored and
   unscored denominators. Any external score needs its own method and provenance.
5. **Validate discovery independently.** Pin the tool and dependencies, review
   upstream rights, test known synthetic insertion/deletion cases and alternative
   alignments, measure completeness against an independent small reference, and
   measure time, RAM, index disk use, cancellation and bounded queue behavior on
   de.NBI before choosing advertised limits.
6. **Require compatible evidence before scoring.** Document the new model's
   gap representation, supported lengths/bulge positions and training domain;
   evaluate held-out guides with relevant bulged observations and suitable
   candidate denominators. Provide a versioned model card and separate results.
   No such model or validation has been supplied for these three checkpoints.

## Suggested support-matrix and help wording

| Feature | Status | Explanation |
| --- | --- | --- |
| DNA/RNA bulges | Not supported | Genome search finds substitution-only candidates. CRISPert scoring requires two ungapped 23-nt sequences. Do not remove gaps to make an alignment fit. |

For a rejected import: “This table contains gapped alignments or an unsupported
bulge format. No rows have been submitted. Use an ungapped candidate export for
this service; keep bulged candidates for a tool that supports that alignment.”

For an empty search: “No candidates were found within the selected reference,
NGG PAM and mismatch limit. This search excludes bulges and does not establish
the absence of other off-targets.”

These messages describe the implemented scope. They must not advertise an
unscored bulge viewer, bulge-aware search or bulge-aware CRISPert scoring until
the corresponding workflow and checks above have actually been delivered.
