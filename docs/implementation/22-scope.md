# 22 — Selective search-scope assessment

Delivered 19 September 2026 by dedicated worker `improvement_22_scope`.

**Status: assessment and aggregate evidence delivered; search expansion deferred.**
The current GRCh38 primary-assembly, NGG, 0–4-substitution, both-strand discovery
mode remains unchanged. This improvement does not claim a new supported assembly,
PAM mode, mismatch range or biological validation. The decision follows the user's
priority: make the published tool easy to use without creating unrelated research
requirements or implying features that have not been implemented.

## Files

- `docs/search-scope.md`: current support table, exact scope, evidence limits,
  extension acceptance plan and suggested interface/API wording.
- `docs/validation/audit_search_scope.py`: standard-library, aggregate-only audit
  of four SHA-256-verified supplied CSV files; no raw sequences/coordinates/IDs
  exported, no genome search, inference, download or live-service changes.
- `docs/validation/search-scope.json`: full aggregate counts for NGG, NAG, NGA,
  other PAMs, strict unambiguous filters and thresholds 0–6/20; file/script hashes.
- `tests/test_search_scope.py`: seven checks, including unknown bases, PAM versus
  protospacer substitutions, 4/5 boundary, duplicates, invalid inputs, partition
  conservation, monotonic thresholds and compatibility with the earlier audit.

## Findings

The current sequence filter includes 91/188 full-K562, 117/118 K562-DeepCRISPR and
37/53 iPSC positive rows. With NGG and at most six substitutions, the corresponding
counts are 177/188, 118/118 and 52/53. Adding NAG while retaining four substitutions
gives 100/188, 117/118 and 38/53. These are counts within supplied candidate files,
not measured genome-retrieval recall or new biological performance claims.

For full K562, NGG ≤4 includes 1,253 supplied rows and NGG ≤6 includes 19,384.
This illustrates a different candidate universe, but does not predict whole-genome
cost. No expanded search was run. Existing one-guide/one-mismatch VM performance
measurements are linked with their limits; there is no extrapolated runtime promise.

Both wider ungapped SpCas9 mismatch/PAM searches and separately pinned GRCh37/mouse
workflows remain explicit follow-up decisions. The latter additionally require
matching annotation/coordinate integration, transfer checks and user demand.
The shared App, API, search implementation, runtime limits and weights were untouched.

## Verification and reproduction

The audit ran on the de.NBI staging VM using the existing private supplied files.
Its 139,200 rows were read locally on that VM; only aggregate JSON was retrieved.
Seven tests passed there in 0.03 seconds. The generated report matches all four
previously published dataset hashes, row/positive totals and NGG≤4 positive counts.

From `/srv/crispert/staging/nar-v2`:

```bash
/srv/crispert/staging/test-venv/bin/python docs/validation/audit_search_scope.py \
  > docs/validation/search-scope.json
/srv/crispert/staging/test-venv/bin/python -m pytest tests/test_search_scope.py -q
```

The generator rejects a changed source fingerprint. It can accept a different
private bundle directory with `--data-root`, but all files must still match the
approved audit hashes. Access to the private files is needed only to regenerate
counts; aggregate consistency and synthetic boundary tests require no private data.

## Coordinator integration

Link `docs/search-scope.md` from Help/model documentation if useful. The concise
form, zero-hit and pair-scoring wording is supplied in that document. Keep the
status register honest: **“scope assessment implemented; expansions deferred”**,
not “expanded search implemented.” No shared type additions or service activation
are needed. The API's existing rejection of unsupported assemblies and mismatch
limits remains the authoritative boundary.
