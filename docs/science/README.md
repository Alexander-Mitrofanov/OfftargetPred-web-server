# Model and dataset provenance

Reviewed 19 September 2026. These records support an accessible web interface to
the published CRISPert method using the exact supplied sequence-only small
checkpoints. They distinguish implementation fidelity from claims about the
history or biological performance of those artifacts. A new algorithm or a new
superiority claim is not a condition of completing the interface.

## Evidence and permitted interpretation

| Topic | Current evidence | Interpretation |
|---|---|---|
| Model identity | Three pinned checkpoint hashes and unchanged tokenizer hash | Exact artifact identity is known |
| Training corpus | Bundle describes the 17-guide T-cell file as training data | Reported corpus role; actual gradient/validation membership is unknown |
| Original training file | Checkpoints name `Tcell_AG+histones+EX_compare_2bit.csv` | Equivalence to bundled `tcell_guideseq.csv` is unverified |
| Full K562 benchmark | Five-guide reference AP reproduced; one guide and 981 pairs overlap reported training corpus | Reproduction evidence; fully guide-independent performance is not established |
| K562 DeepCRISPR / iPSC | No exact guide/pair overlap with reported T-cell corpus | Independence from original training and model selection is unverified |
| iPSC groups | Three guides with 0, 1 and 52 positives | Two groups have positives; the bundle's two-guide description needs reconciliation |
| Run seed | README reports 0; saved config has 42; code passes a run seed separately | Actual run seed is unknown; config 42 does not disprove run seed 0 |
| Label zero | Binary labels are present; source negative-generation records are absent | Label-zero rows are not proven biological negatives |
| Code/artifact rights | Owner selected MIT for their own code | Separate upstream weights/data/code permissions remain unresolved |

The base-method citation is Jobson Pargeter, Backofen and Tran,
*CRISPert: A Transformer-Based Model for CRISPR-Cas Off-Target Prediction*,
ECML PKDD 2024, pp. 92–104,
[DOI 10.1007/978-3-031-70368-3_6](https://link.springer.com/chapter/10.1007/978-3-031-70368-3_6).
The web service's exact four-layer, sequence-only checkpoints are identified by
their local hashes. The paper's benchmark and optional-feature results do not
automatically apply to those artifacts. See the [model card](../model-card.md).

## Machine-readable records

- [Claim/evidence ledger](provenance-ledger.json): stable claim IDs, evidence IDs,
  source hashes, permitted wording, unsupported inferences and missing records.
  `verified_locally` is limited to the stated local audit or saved validation;
  `reported_only`, `unresolved` and `not_supported` are distinct states.
- [Dataset-role manifest](dataset-roles.json): every supplied guide occurrence
  has counts, a corpus role, cross-dataset overlap, and explicit unknown
  gradient-training, validation and selection membership. Dataset-level fields
  record unverified publication/accession, assay, nuclease, preparation, assembly
  and permissions as `null`, never as a negative result or permission grant.
- [Checkpoint metadata](checkpoint-metadata.json): selected saved configuration
  fields from hash-verified files. Missing fields are recorded as absent, not
  silently converted to false. `cfg.pretrained_dir` and the separate saved
  hyperparameter `pretrained_dir` are preserved separately.
- [Aggregate overlap audit](../nar-readiness/dataset-audit.json): the original
  file-level counts, pair overlap, label transitions and sequence eligibility.
  Existing [benchmark scores](../validation/model-benchmark.json) are unchanged.

Source paths under `Model/` refer to the privately supplied bundle and are not
distributed by this repository. A hash records identity; it does not grant
access or redistribution rights. No raw dataset, pair row, guide sequence,
coordinate or weight is included in the new records. Guide fingerprints are
deterministic identities, not anonymization guarantees.

## Guide identities and roles

The role manifest contains 37 guide occurrences across four files: 17 T-cell,
5 K562 in-vivo, 12 K562 DeepCRISPR and 3 iPSC. A guide fingerprint is SHA-256 of
the uppercased, outer-whitespace-trimmed 23 nt ASCII sequence without a newline.
The split-group fingerprint uses its first 20 bases. Matching split-group
fingerprints across cells and datasets identify guide groups that must stay
together in any future guide split. Direction is retained; reverse complements
are not silently collapsed into one Cas9 target.

`reported_training_corpus` and `supplied_cross_cell_evaluation` describe the
bundle's role assignments. Neither is an invented row-level training split.
Every guide retains `actual_gradient_training_membership`,
`actual_validation_membership` and `model_selection_use` as `unknown`.

Removing the entire overlapping K562 guide leaves four guides, 33,407 pairs and
180 positives disjoint from the reported T-cell corpus by exact guide identity.
No metrics for that subset were computed in this provenance task. Removing
only the 981 shared pairs would leave a repeated guide and would not support a
new-guide claim. Even a whole-guide exclusion cannot establish an untouched
test without the original training and selection history.

Two evaluation overlaps also matter: iPSC/K562 in-vivo share one guide and
5,066 pairs; K562 in-vivo/DeepCRISPR share one guide and 1,020 pairs. Shared pairs
can have discordant labels. Cell context, assay sensitivity and dataset
construction may contribute; the audit does not identify the cause. A
sequence-only model cannot change an identical pair's score based on cell type.

## Reproduce and check

From the repository root, with the supplied bundle already available locally:

```bash
python3 docs/science/build_dataset_roles.py --check
.venv/bin/python docs/science/inspect_checkpoint_metadata.py --check
.venv/bin/python -m pytest tests/test_provenance.py -q
```

The first command reuses the existing aggregate audit's parser and overlap
logic, verifies file hashes and counts, and checks every guide-role record.
The second verifies each checkpoint hash before reading selected metadata with
`torch.load(..., map_location='cpu', weights_only=True)`. These small read-only
checks perform no model inference or training. Public-checkout tests check all
available evidence and skip private source reads when the bundle is absent.
Heavy future model work belongs on the designated VM.

Use `--write` instead of `--check` only after reviewing an intentional artifact
update. Changed evidence hashes must be reconciled with the claims in
`provenance-ledger.json`; the tests reject stale public evidence. The dataset
builder refuses to proceed if the aggregate audit no longer matches the files.
Do not regenerate artifacts merely to suppress evidence of a mismatch.

## Records needed from authors or data owners

The following would resolve remaining provenance questions; they do not block
interface improvements made within the documented scope:

1. Original training/pretraining file hashes, sources and transformations to the
   supplied bundle, plus per-checkpoint training/validation row manifests.
2. Run invocation/logs and seed records; selection and sweep history including
   every dataset used to choose k, checkpoint, seed or preprocessing.
3. Original dataset publications/accessions, experimental assay/cell/nuclease,
   candidate/label-zero generation, row filtering, assembly and coordinates.
4. Reconciliation of the iPSC description with the observed three-guide file.
5. Explicit permissions/licenses for upstream code, weights and datasets.

No missing records have been fabricated, no third party has been contacted, and
this documentation does not authorize redistribution of the supplied bundle.
