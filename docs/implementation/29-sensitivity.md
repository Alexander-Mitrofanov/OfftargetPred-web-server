# 29 — Single-base sequence sensitivity

Implemented for the web interface to the already published CRISPert tool. This
workflow helps researchers inspect the behavior of an existing model; it makes
no claim of new predictive methodology or biological mechanism.

## User workflow

1. Select exactly one candidate in the complete result table, or in a frozen
   public example. Open **Explore single-base sequence sensitivity**.
2. Save the current analysis or its private recovery link. Browser-only evidence
   and selections are not recovered through that link.
3. **Prepare 61-pair sensitivity input** fills the ordinary pair input form with
   the original candidate and every alternative A/C/G/T base at positions 1–20.
   The guide and candidate's actual three-base PAM stay unchanged. Review the
   input and model choices, then submit explicitly; preparation creates no job.
4. Open the same panel on the completed result. Choose a model to view its
   position-by-base score-change table. Expand any cell for full score precision.

The table uses the complete downloaded result document. Its columns are the
candidate's substituted base and its rows are positions in submitted 5′ to 3′
orientation, with position 20 next to the PAM. Original-base cells share the
single original candidate score; they are not 20 additional predictions. A
delta is `substitution score - original score` within one model. Missing,
nonfinite and out-of-range scores remain unavailable, including when the
original score is missing. Scores are never averaged across models or converted
to editing rates.

Synthetic sequences carry no original genomic coordinates, intended-locus flag,
annotation or experimental observations. A substitution can increase or decrease
model output without implying molecular causality, a measured editing-rate
change, guide safety, or that the perturbed sequence exists in a genome. This is
a single-substitution view conditional on one original candidate; it does not
estimate multi-base interactions. N bases, gaps, RNA U and non-23 nt inputs are
unsupported. The normal supplied-model scope and PAM caveats still apply.

## Files and integration contract

- `frontend/src/features/sensitivity.ts`: pure generation, bounded preparation,
  matrix validation and per-model cell calculations.
- `frontend/src/components/SequenceSensitivity.tsx` and `.css`: collapsed,
  keyboard-operable panel, explicit model select label, native table/disclosures,
  original-cell text and restrained teal shading, horizontally scrollable table.
  Colors and typography follow the existing scientific workbench. Color never
  communicates a score direction or biological significance by itself.
- `tests/frontend/sensitivity.test.ts`: 12 focused contract tests.
- `tests/verify_sensitivity_panel.py`: opt-in VM check of the actual deployed
  checkpoints, using a frontend-generated submission and a public source row.
- `tests/browser/sensitivity.py`: Chromium and Firefox check with a public scored
  fixture; no prediction POST requests.

Component props:

```ts
{
  rows: ResultRow[];          // Complete document, never filtered/paginated.
  selectedRows: ResultRow[];  // Preparation requires exactly one selected row.
  onPrepare?: (submission: Submission) => void;
}
```

`prepareSensitivity(row, models?)` returns a normal `pairs`/`csv` submission. The
default model list contains models with finite scores on that original row;
researchers can alter it in the prediction form. The parent handles navigation,
focus and form state. No API mode, inference code, tokenization or checkpoint
changes are needed.

Rows preserve these ordinary CSV metadata fields:

| Field | Meaning |
| --- | --- |
| `sensitivity_schema` | Exact `candidate-substitution-v1` contract |
| `sensitivity_panel` | Stable panel identifier derived from both full sequences |
| `sensitivity_original_candidate` | Original 23 nt candidate |
| `sensitivity_position` | `0` for the original, or positions `1` through `20` |
| `sensitivity_base` | `original`, or the replacement A/C/G/T |
| `sensitivity_original_base` | `original`, or the original base at that position |
| `sensitivity_source_id` | Source candidate identifier, CSV-escaped |
| `sensitivity_source_row` | Source stable row index when recorded |

Every generated pair has a deterministic unique ID and a common
`guide_id=sensitivity-guide`. The parent added these optional fields to the
shared row type and CSV export. The backend already preserves ordinary metadata
and regenerates sequence-derived mismatch annotations. Browser ZIP JSON/CSV
exports retain the complete panel and its provenance.

`inspectSensitivity(rows)` returns `absent`, `invalid` with a reason, or `valid`
with one panel. It requires exactly 61 rows, exactly one original, all 60 unique
substitutions, unchanged guide/PAM, matching full sequences and every relevant
matrix label/ID. It rejects duplicate, missing, mixed or forged labels and
inconsistent source provenance. Genomic coordinates, a designated intended locus
or genomic annotation claims also invalidate a synthetic panel. The order of
rows is immaterial. These are structural checks; metadata does not authenticate
externally edited scores or source identifiers.

## Verification on the de.NBI VM

19 September 2026, V100, unchanged k1/k2/k3 checkpoints:

- Twelve focused frontend tests passed, including all panel shape/identity
  failure modes, metadata escaping, fixed PAM, absent scores and per-model delta
  calculations. The integrated TypeScript/Vite production build passed.
- A panel was generated by the actual TypeScript helper from zero-based row 2
  of the existing public `reference-walkthrough.json` example, then parsed and
  normalized by the backend's ordinary CSV pipeline.
- Two complete 61-row passes through all three deployed models took 0.382 s
  after Python startup. Repeated scores were identical for all 183 predictions.
  The original candidate's score was also identical to its frozen public result
  in each model. This small software check is not a general runtime guarantee.
- The TypeScript reconstruction of the real GPU result produced all 240 cells
  (20 positions × 4 bases × 3 models), with every delta equal to the corresponding
  score minus the same model's original score.
- Chromium and Firefox passed reconstruction, separate model selection,
  keyboard disclosure/cell values, 390 px and 320 px layout, preparation from
  both scored results and frozen examples, 61-row prefill and heading focus.
  Both runs produced zero prediction POST requests and zero page errors.

| Model | Original score | Largest repeated-score difference | Original vs frozen difference |
| --- | ---: | ---: | ---: |
| k1 | 0.9957929849624634 | 0 | 0 |
| k2 | 0.9935278296470642 | 0 | 0 |
| k3 | 0.9959030747413635 | 0 | 0 |

These values are uncalibrated model outputs from one public software example.
They are not experimental measurements or a model quality comparison.

### Reproduce the check

From the staged checkout on the VM, use its Node 22 runtime to generate the
submission directly from the frontend helper:

```bash
node --experimental-strip-types --input-type=module <<'JS'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { prepareSensitivity } from './frontend/src/features/sensitivity.ts';
mkdirSync('output', { recursive: true });
const source = JSON.parse(readFileSync('frontend/public/demonstrations/reference-walkthrough.json', 'utf8')).rows[2];
writeFileSync('output/sensitivity-submission.json', JSON.stringify(prepareSensitivity(source)));
JS
```

Use the service's Python environment and an account authorized to read the
protected checkpoints. Offline flags prevent any model downloads:

```bash
sudo -n env HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1 \
  PYTHONPATH=/srv/crispert/staging/nar-v2/backend \
  /srv/crispert/venv/bin/python tests/verify_sensitivity_panel.py \
  --submission output/sensitivity-submission.json \
  --models /srv/crispert/models \
  --source-document frontend/public/demonstrations/reference-walkthrough.json \
  --source-row 2 --output-directory output

node --experimental-strip-types --test tests/frontend/sensitivity.test.ts
PLAYWRIGHT_BROWSERS_PATH=/srv/crispert/staging/browsers \
  /srv/crispert/staging/test-venv/bin/python tests/browser/sensitivity.py \
  --document output/sensitivity-results.json
```

The model check writes `output/sensitivity-results.json` and an aggregate
`output/sensitivity-check.json`. The browser check supplies the public result to
intercepted job reads, checks ordinary example preparation independently, and
asserts that no POST request occurs. These generated verification artifacts are
not a new public benchmark dataset and do not include private job credentials.

## Remaining scope

No new training, calibration, alternative nuclease/PAM model, causal attribution
claim, multi-base interaction analysis, genome existence claim or special API
mode is introduced. A fresh NAR council should assess whether this optional
collapsed aid improves usability without distracting from the primary task.
