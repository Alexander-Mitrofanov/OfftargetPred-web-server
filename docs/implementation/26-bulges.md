# 26 — Bulge compatibility assessment and rejection guards

Delivered 19 September 2026 by dedicated worker `improvement_26_bulges`.

**Status: assessment and regression guards delivered; bulge discovery/scoring
deferred.** This respects the user's focus on a usable interface to the published
tool. The existing three fixed-input checkpoints do not establish bulge support.
No new discovery engine, model, live endpoint or unsupported score was added.

## Delivered files

- `docs/extensions/bulges.md`: current support table, audited validation paths,
  short primary-source integration assessment, exact deferred prerequisites,
  proposed help/import/empty-result wording.
- `tests/test_bulge_boundaries.py`: seven focused checks of previously uncovered
  mixed-output boundaries: gap/dot notation, a 24-column gapped alignment,
  unmarked 22/24-base candidates, a nine-column output schema, and a pair API
  submission with a valid prefix followed by a gapped candidate. The last check
  also verifies `bulges: false` and that no job is queued.

## Findings

Existing backend/frontend validators already reject the unsupported inputs.
The search parser fails the whole result on invalid output, and tool adapters
block the whole apply action when any imported alignment is invalid. There was
no implementation defect requiring a change to sequence, inference, tokenizer,
CFD or search code. The new tests protect those all-or-nothing boundaries.

The tokenizer's unknown-token fallback is not scientific evidence of bulge
compatibility. Its public inference entry point validates first. Removing gaps,
trimming or padding would change the supplied alignment. A future discovery-only
extension needs separate alignment/locus identities and explicit missing scores;
the current ranking and export schema must not silently treat them as ordinary
scored 23-mers. Already altered gap-free sequences cannot reveal their history.

## Verification

All checks ran on the authorized de.NBI staging VM; no production changes or
model inference were needed.

From `/srv/crispert/staging/nar-v2`, using the staging test interpreter with
`PYTHONPATH` including `backend` and the installed production dependencies:

```bash
/srv/crispert/staging/test-venv/bin/python -m pytest -q \
  tests/test_bulge_boundaries.py tests/test_search.py tests/test_model.py \
  -m "not model"
```

**30 passed, 2 model tests deselected, 2.93 seconds.** Existing sequence validation
and unchanged-tokenizer checks passed alongside the seven new boundary checks.

```bash
/srv/crispert/staging/node/node-v22.23.2-linux-x64/bin/node \
  --experimental-strip-types --test \
  tests/frontend/toolImports.test.ts tests/frontend/columnMapping.test.ts
```

**36 passed, 0 failed, 0.74 seconds.** This includes gaps, wrong lengths, whole
import rejection, unsupported schemas and no biological sequence guessing.

## Coordinator integration

Link the extension document from the consolidated support matrix or Help. Use
the suggested wording if a concise boundary statement is missing. No API type,
model package or deployment step is required. Mark this item **“assessed and
guarded; optional bulge extension deferred”**, never “bulge support implemented.”
Existing tests automatically collect the added Python file.
