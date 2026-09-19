# Improvement 01 — Model and data provenance

Implemented 19 September 2026. Scope: evidence and artifact documentation for
the web interface to published CRISPert using the supplied small checkpoints.
No new algorithm, superiority claim, retraining or independent benchmark is
required for this improvement. No heavy computation or live-service change was
performed; weights, tokenizer, raw datasets and saved benchmark values are
unchanged.

## Changed files

- `docs/model-card.md`: attributes training and pretraining history to the
  bundle, corrects full-K562 independence and iPSC claims, explains separately
  passed run seed, cites published CRISPert and limits transfer of paper claims
  to the exact small checkpoints. Separates sequence eligibility from retrieval.
- `docs/validation/README.md`: labels existing scores as full-benchmark
  reproduction and links the provenance/overlap evidence.
- `docs/science/README.md`: evidence summary, identities, roles, reproducibility
  instructions and external provenance questions.
- `docs/science/provenance-ledger.json`: 14 stable claim records with source
  hashes, statuses, allowed wording, unsupported inferences and missing evidence;
  includes the base-method citation and full-benchmark/subset definitions.
- `docs/science/dataset-roles.json`: hashes and explicit unknowns for all four
  datasets, plus 37 per-guide occurrence records with consistent hashed 20 nt
  split groups and 23 nt identities. No sequences, rows or coordinates exported.
- `docs/science/checkpoint-metadata.json`: selected saved metadata from the
  three pinned checkpoints; records absent fields separately from null values.
- `docs/science/build_dataset_roles.py`: reuses the aggregate audit parser,
  checks source hashes/counts/overlap, and regenerates or verifies guide roles.
- `docs/science/inspect_checkpoint_metadata.py`: verifies checkpoint digests
  before a CPU `weights_only=True` metadata load; no inference.
- `tests/test_provenance.py`: evidence freshness, role/count completeness,
  shared guide identity, claim boundaries, artifact identity, raw-sequence
  exclusion and optional private-bundle reproduction.

## Verification

All passed locally:

```text
.venv/bin/python -m pytest tests/test_provenance.py -q
7 passed in 0.80s

python3 docs/science/build_dataset_roles.py --check
Dataset roles verified: 4 datasets, 37 guide occurrences; no model inference performed.

.venv/bin/python docs/science/inspect_checkpoint_metadata.py --check
Verified metadata of 3 pinned checkpoints; no model inference performed.
```

The existing `docs/nar-readiness/dataset-audit.json` remains unchanged. Its four
CSV digests/counts and six pairwise overlap records were checked against local
files. Existing `docs/validation/model-benchmark.json` was reused; no new metrics
were inferred or computed. The publisher record for DOI
[10.1007/978-3-031-70368-3_6](https://link.springer.com/chapter/10.1007/978-3-031-70368-3_6)
was checked for base-method bibliographic details.

## Coordinator integration: exact wording

This worker did not modify shared `frontend/src/App.tsx` or root `README.md`.
Line numbers refer to the source before coordinator integration; use the text
anchors if the file has moved.

### About: score interpretation, around line 302

Replace `wins on every held-out dataset` with
`wins on every supplied evaluation dataset`.

### About: checkpoint training section, around lines 383–395

Replace the two current paragraphs with:

```tsx
<p>
  The supplied package identifies the 17-guide T-cell GUIDE-seq file as
  its training corpus. Exact training and validation row membership
  remains unverified. The full K562 benchmark shares one guide and 981
  sequence pairs with that reported corpus, so it does not establish
  fully guide-independent performance.
</p>
<p>
  The package reports run seed 0. Saved config seed 42 does not disprove
  that report: the training code passes run seed separately. The actual
  run seed is unverified. k=1 is the default based on the supplied
  selection rationale; all three scores remain separate. The iPSC file
  contains three guides, two with positive sites, so its small evaluation
  should be interpreted cautiously.
</p>
```

### About: method provenance section, around line 398

Suggested replacement paragraph:

```tsx
<p>
  CRISPert was published by Jobson Pargeter, Backofen and Tran at ECML
  PKDD 2024. This server exposes the supplied four-layer, sequence-only
  CRISPert-small checkpoints. The paper provides the base-method citation;
  its benchmark and CasKAS results are not asserted for these exact
  artifacts. See the{' '}
  <a href="https://link.springer.com/chapter/10.1007/978-3-031-70368-3_6">
    published CRISPert paper
  </a>.
</p>
```

The ledger may be linked through the repository URL used elsewhere in the UI;
do not assume `docs/science` is served as frontend static content.

### Root README: benchmark bullet, around lines 92–93

```markdown
- [Measured model benchmark](docs/validation/model-benchmark.json): exact
  supplied checkpoint performance on the full K562 benchmark. This reproduces
  reference scores; one guide and 981 pairs overlap the reported training corpus.
- [Model/data provenance](docs/science/README.md): source hashes, per-guide roles,
  evidence boundaries and unresolved training/selection history.
```

## Remaining external dependencies

Author/data-owner records are needed to resolve original-to-bundled training
file equivalence, exact gradient/validation membership, run seed, original
pretraining data and complete model-selection history. Original dataset
publication/accession, assay/cell/nuclease, negative-generation, preprocessing
and assembly records are also unverified. The iPSC README description needs
reconciliation with the file. None of these facts were fabricated or silently
promoted to verified status.

The owner selected MIT for their own code; supplied weights, data and upstream
code permissions remain separate and unresolved. This worker published no raw
data or weights and contacted no third parties. These questions limit the
corresponding scientific/redistribution claims; they do not gate interface
improvements within the documented scope.
