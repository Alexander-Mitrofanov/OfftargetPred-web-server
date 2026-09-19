# Integrated release verification

This record distinguishes implemented interface behavior from publication claims.
The contribution is an accessible web workflow for the published CRISPert method.
The three supplied sequence-only checkpoints and tokenization are unchanged.

## Staging environment

All model inference, reference preparation, builds and browser acceptance checks
run on the de.NBI V100 VM. Staging uses separate job storage and loopback API/UI
ports 8020/5182. Production remains on 8010 until release activation. The pinned
GRCh38 Ensembl 115 primary assembly and complete annotation index are local.

## Cross-feature checks completed

Final VM verification on 19 September 2026: 607 non-model backend tests passed;
the two opt-in real-FASTA checks subsequently passed; both real-checkpoint tests
passed after installing the declared reference-framework dependencies in the
isolated test environment. This is 611 passing backend/model checks across those
runs. The parity test explicitly loads the original checkpoint onto CPU to match
its CPU inputs; production inference code and all checkpoints are unchanged.
All 163 frontend tests and the production build passed.

- All three real models and CFD score a browser-submitted pair job; the complete
  result document feeds summaries, comparisons, selection and downloads.
- A real genome search returns 15 candidates with separate k1/k2/k3/CFD scores,
  local annotations and the explicitly selected intended locus.
- Full, filtered and selected exports contain their respective complete views;
  Python `zipfile` independently verifies ZIP CRC and data preservation.
- Imported assay evidence remains separate from model predictions. The browser
  check preserves duplicated and unmatched observations, matching declarations
  and SHA-256 in `experimental-evidence.json`, with a result JSON reference.
- Public-reference examples work with the API blocked. They cover ordinary
  output, multiple exact matches, no hits and a missing-PAM input error.
- Column mapping and tool-import validation preserve row identity and explicit
  coordinate provenance; user-supplied coordinates are not called verified.
- Chromium and Firefox accessibility audits cover keyboard operation, 320/390 px
  layouts, error recovery and private links. Exact checked states and remaining
  manual checks are in [the accessibility report](15-recovery.md).
- Final audits after the council's navigation fix pass 28 workflow/layout checks
  and 10 axe scan states per browser, with no detected violations or JavaScript
  errors. The separate navigation regression preserves selection reasons and
  imported observations through Help/About and back, then verifies ZIP contents.
- The real staging browser flow scores all three models on GPU, recovers after
  refresh, downloads provenance, finds the expected 15 reference candidates and
  deletes both acceptance jobs. CPU container and CLI evidence remains separately
  identified by the tested image/source hashes in [the container record](20-container-checks.json).

## Publication evidence boundaries

Frozen aggregate diagnostics characterize the exact deployed checkpoints; they
do not establish a new method or a leakage-free independent benchmark. The
reported training corpus overlaps one K562 guide; actual training membership is
unresolved. Public-reference examples demonstrate workflow and interpretation,
not experimental validation or a completed biological utility study.

Human usability and assistive-technology checks remain recommended follow-ups;
they are not claimed as completed or as universally mandated participant studies.
Model/data permissions, named institutional ownership and a five-year maintenance
commitment require owner input. The manuscript needs an appropriate software
archive, either an eligible repository deposit or supplementary material under
the journal policy. An archive DOI must be real before it is cited. The final
independent council assesses these separately from working software.
