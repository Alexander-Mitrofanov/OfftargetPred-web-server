# Improvement implementation contracts

The coordinator owns integration in `frontend/src/App.tsx`, `frontend/src/api.ts`,
`backend/offtargetpred/api.py`, `worker.py`, `config.py`, shared package manifests,
and deployment activation. Workers must not modify these files without an explicit
handoff. Each improvement has a dedicated worker and a separate delivery note in
this directory, identifying files, tests, remaining dependencies, and integration.

All three sequence-only checkpoint weights and tokenizer behavior stay unchanged.
Scores remain separate, uncalibrated outputs. User sequences and private job tokens
must never be sent to external services automatically. All generated HTML escapes
user strings. Scientific exports preserve stable `row_index`, guide identity,
assembly and coordinate conventions. No partial search is called complete.

New Python features live in small modules under `backend/offtargetpred/` with
tests in dedicated `tests/test_<feature>.py` files. New UI components live under
`frontend/src/components/` and feature helpers under `frontend/src/features/`.
Components accept props and callbacks; they do not assume backend availability.
Import existing types from `api.ts`; ask the coordinator for shared type additions.
Use component-specific CSS, existing palette and ordinary accessible HTML.

Result rows preserve existing fields. Optional additions:

- `annotations`: `{status: 'annotated'|'unavailable'|'no_coordinates', features:
  [{gene_id, gene_name, transcript_id?, feature, start, end, strand}], categories:
  string[], source?: string, release?: string}`. Intergenic is a confirmed absence
  from a compatible complete annotation, not a synonym for unavailable.
- `baselines`: `{cfd: {score: number|null, reason?: string, version: string}}`.
- `evidence`: user-supplied observations kept separate from predictions.

Analysis metadata is an extensible JSON object and always includes release,
model identities, reference/search scope and warning/limitation information.
Frontend analytical features operate on a complete downloaded result document
`{rows: ResultRow[], metadata: Record<string, unknown>}`; filtering and selection
are explicit derived views. A 50,000-row cap bounds the document. Never compute
whole-result summaries from one page of results.

Use the de.NBI VM for heavy model/data work. Do not change live services while
developing; use `/srv/crispert/staging/nar-v2` or a worker-specific sibling and
separate data directories/ports. Production releases are under coordinator control.
No worker may publish data, model weights, archive deposits or contact third parties.
MIT was selected by the user for code they own; upstream permissions remain separate.
