# Changelog

## 0.2.0 — 2026-09-19

This release develops the web workflow around the three unchanged published
sequence-only CRISPert-small checkpoints. It does not introduce a new prediction
model or calibrated cleavage probability.

- Guided column mapping and explicit import formats for existing candidate tools.
- Reference-based spacer/PAM resolution, exact gene/transcript lookup and bounded
  interval discovery, with explicit intended-locus selection.
- Local Ensembl 115 annotations, per-guide summaries, model-rank comparisons and
  transparent candidate shortlists; optional CFD baseline scores stay separate.
- Browser-local experimental observation matching, preserving ambiguity,
  duplicates and unmatched observations.
- An embedded local genomic context view, explicit external genome-browser links
  and coordinate-aware BED exports.
- Full analysis ZIP with complete and filtered results, selected candidates,
  notes, evidence, provenance, citation and licence.
- Interactive frozen examples that work during backend outages, and a diagnostic
  evidence page with explicit dataset overlap limitations.
- Accessible result controls, strict private-link recovery and clipboard fallback.
- Measured job stages, operational monitoring and configuration backup/restore.
- Reference-verified flanking sequences for explicitly selected candidates.
- Explicit sequence-sensitivity jobs and separate per-model perturbation maps.
- A documented Python API client and a tested optional CPU container recipe.
- Selections and browser-local observations survive in-app Help navigation.
- MIT licence for project-owned code; explicit third-party/model/data boundaries.

See [the numbered implementation record](docs/implementation/README.md) for
feature scope, tests and deferred research extensions, and
[integration evidence](docs/implementation/INTEGRATION.md) for combined checks.
