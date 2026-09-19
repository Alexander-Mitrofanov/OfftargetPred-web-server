# CRISPert-small model card

## What the service predicts

The service ranks supplied or discovered candidate sites for a guide using
**CRISPert-small sequence-only** classifiers. Each result is a **CRISPert score**
between zero and one: the positive-class softmax from a two-class classifier.
Higher values mean stronger model support for an off-target label. Scores are
uncalibrated and must not be read as cleavage frequency, percent editing,
clinical safety, or a genome-wide guide specificity score. No score cutoff is
provided and the three model outputs are never silently averaged.

The service supports aligned SpCas9-style sequence pairs. It does not model
bulges or other nucleases. CasKAS, chromatin tracks, other epigenetic signals,
and late-fusion features are not used or requested.

## Input contract

Both sequences contain exactly **23 DNA bases**: a 20 nt protospacer followed
by its 3 nt PAM. The first is the guide-associated target sequence (with the
actual target PAM); the second is the candidate genomic sequence. Both must
already be aligned and oriented 5'-to-3' with PAM last. The service does not
infer alignment, append a PAM, or reverse-complement submitted pairs.

Pair scoring accepts A/C/G/T/N, normalizes case and outer whitespace, and
rejects all gaps, RNA U, other characters, and incorrect lengths. An N produces
an unknown token in every overlapping k-mer containing it; the result carries
an ambiguity warning. The supplied T-cell corpus uses unambiguous bases;
biological performance on N-containing pairs is unverified.

CSV/TSV requires `target` and `off_target`. Recognized alternatives are:

| Meaning | Accepted columns |
|---|---|
| Guide | `target`, `sgRNA`, `Guide_sequence`, `AlignedTarget`, `guide_sequence` |
| Candidate site | `off_target`, `offtarget`, `Target_sequence`, `AlignedText`, `candidate_sequence` |
| Optional ID | `id`, `ID`, `sgRNA_id`, `guide_id` |

In the CRISPR-OFFT convention, `Target_sequence` means the genomic candidate.
Multiple aliases for the same required field are rejected as ambiguous.
Repeated pair IDs are retained with a stable `row_index`; genome-search guide
IDs must be unique. Invalid rows cause a visible validation error rather than
being silently discarded. Candidate PAMs other than NGG are accepted because
they occur in the supplied data. Non-NGG guide-associated PAMs trigger a warning.

## Architecture and checkpoint provenance

Each model uses a directional alphabet of the 16 possible aligned DNA base
pairs. The unchanged supplied tokenizer generates overlapping k-mers over
that alphabet, with CLS and SEP special tokens. A four-layer BERT classifier
uses hidden width 128, four attention heads, feed-forward width 256, and two
output classes.

| Model | k | Vocabulary | Token count | Parameters | README-described pretraining |
|---|---:|---:|---:|---:|---|
| Default | 1 | 21 | 25 | 552,962 | None; trained from scratch |
| Comparison | 2 | 261 | 24 | 583,554 | Artificial masked-language modeling |
| Comparison | 3 | 4,101 | 23 | 1,074,946 | Artificial masked-language modeling |

The original checkpoints remain untouched in `Model/crispert_share/models`.
`models.manifest.json` records their SHA-256 fingerprints. Every load verifies
the exact known digest and architecture, uses `weights_only=True`, rejects
additional feature configurations, strips only the known `model.` state-key
prefix, and requires a strict PyTorch state load. Inference runs in evaluation
mode and FP32 with gradients disabled. Model initialization is local and does
not contact Hugging Face or download any weights.

The production tokenizer at `backend/offtargetpred/tokenizer.py` is a byte-for-
byte copy of the supplied `crispert_small/tokenizer.py`, SHA-256
`b15aae904e073d53d0c878199a3a04e2eeccb81faeb3e11738dc00bc282cb2e2`.
Production inference requires PyTorch and Transformers but not Lightning.
Lightning is used only to independently verify parity with the supplied script.

## Training and interpretation limits

The supplied README identifies `tcell_guideseq.csv` as the full 17-guide T-cell
GUIDE-seq training corpus. The file contains 51,906 rows, but the checkpoints
name an original file, `Tcell_AG+histones+EX_compare_2bit.csv`. Equivalence of the
two files and exact gradient-training/validation row membership are unverified.
The saved validation fraction is 0.2; available code makes a label-stratified
row split and uses balanced training sampling. High scores on the reported
training corpus are not generalization evidence.

The complete five-guide K562 in-vivo benchmark shares **one guide and 981 exact
sequence pairs** with the reported T-cell corpus. It therefore does not
establish fully guide-independent performance. This is observed corpus overlap,
not proof of which rows reached gradient training. The 12-guide K562 DeepCRISPR
and iPSC files have no exact directional guide/pair overlap with the reported
T-cell corpus; their model-selection independence remains unverified. Evaluation
files also share guides with each other. The iPSC file contains **three guides**,
with 0, 1 and 52 positive rows; two guides have positives, contrary to the
supplied README's description.

The README reports run seed 0. Saved `cfg.seed` is 42, but the available code
passes the run seed separately to splitting and model initialization. The
config value neither verifies nor contradicts the reported run seed; the actual
run seed remains unverified. Model performance varies by guide and dataset, so
there is no universal best k. The supplied selection rationale supports k=1 as
the default; the underlying sweep and selection history are not independently
verified. Outputs have not been calibrated to real-world prevalence.

Original dataset accessions, assay details, candidate/label-zero generation,
upstream filtering and permissions remain unresolved. Label-zero rows must not
be treated as proven biological negatives. See the [provenance guide](science/README.md),
[claim/evidence ledger](science/provenance-ledger.json) and
[per-guide role manifest](science/dataset-roles.json) for hashes, evidence and
explicit unknowns. These records describe the evidence available for the service.

The published base method is William Jobson Pargeter, Rolf Backofen and Van Dinh
Tran, *CRISPert: A Transformer-Based Model for CRISPR-Cas Off-Target Prediction*,
ECML PKDD 2024, pp. 92–104, DOI
[10.1007/978-3-031-70368-3_6](https://link.springer.com/chapter/10.1007/978-3-031-70368-3_6).
This web service exposes the supplied four-layer, sequence-only CRISPert-small
checkpoints identified above. The publication establishes the base method;
its historical benchmark and CasKAS results are not asserted for these exact
artifacts. Cite the paper for CRISPert and this service's pinned artifact and
validation records for the deployed implementation.

## Verified numerical behavior

On 2026-09-19, the production adapter matched the supplied Lightning inference
path for all three actual checkpoints within absolute tolerance 1e-6, including
N-containing pairs. Chunking and repeated inference also passed parity tests.

The entire supplied `k562_dataset_invivo_full.csv` (43,132 pairs, 5 guides)
reproduced every reference per-guide macro average precision to four decimals:

| Model | Reproduced macro AUPRC | Supplied reference | Pooled AUPRC |
|---|---:|---:|---:|
| k=1 | 0.647596 | 0.6476 | 0.309324 |
| k=2 | 0.536923 | 0.5369 | 0.230368 |
| k=3 | 0.553342 | 0.5533 | 0.267289 |

These values are average precision as implemented by scikit-learn, called
“AUPRC” in the supplied package. The macro calculation weights each eligible
guide equally and skips groups with only one class. Macro and pooled AP answer
different questions; neither is universally the preferred summary. This is
reference-score reproduction on the full dataset, including its overlapping
guide, and is not a fully guide-independent or untouched independent test.
The [aggregate overlap audit](nar-readiness/dataset-audit.json) accompanies this
benchmark. Results are from CPU
PyTorch 2.4.1 with Transformers 4.46.3; the run took 34.37 seconds on the local
development host. See `docs/validation/model-benchmark.json` and reproduce with:

```bash
PYTHONPATH=backend .venv/bin/python tests/benchmark_models.py
```

Only 91 of the 188 positive K562 rows satisfy NGG and at most four protospacer
substitutions, the deployed genome-search sequence conditions. This is sequence
eligibility only; reference presence, coordinates and actual retrieval were not
measured by that audit. Pair-scoring AP is not end-to-end genome-search recall.

## Optional genome candidate discovery

Genome search is available only after the reference has been provisioned and
verified. It uses Cas-OFFinder 2.4.1, release commit
`9816b94c20c4cba2e79b039e1e2a6dee684b7b66`, with the human GRCh38 primary assembly
from Ensembl release 115. Search supports 1-10 full 23 nt unambiguous guides,
NGG PAM, 0-4 protospacer substitutions, and no bulges. It does not search
alternative assemblies, patient variants, non-NGG PAMs, or uninstalled genomes.

The search query uses the first 20 guide bases plus `NNN` so a candidate PAM is
not incorrectly counted as a protospacer mismatch. The original guide's actual
PAM is restored for scoring. Candidate sequences returned on the minus strand
are already in the guide orientation and are not reverse-complemented again.
Reported mismatch counts are recomputed and validated before inference.

Coordinates are **0-based, half-open** genomic intervals `[start, end)`, including
PAM, with `end = start + 23`. Mismatch-position annotations are separately
**1-based positions within the oriented 23 nt sequence**. Perfect protospacer
matches and exact 23 nt matches remain in the results and are labeled; sequence
matching alone cannot identify a unique intended on-target locus. A job fails
if it exceeds the candidate cap, timeout, or output limits; partial searches
are never advertised as complete.

Cas-OFFinder's [release source and output convention](https://github.com/snugel/cas-offinder/tree/9816b94c20c4cba2e79b039e1e2a6dee684b7b66)
and the [Ensembl human FASTA release directory](https://ftp.ensembl.org/pub/release-115/fasta/homo_sapiens/dna/)
document the external search dependencies. The reference manifest records the
exact file, source, and decompressed SHA-256; each search process verifies the
file hash before using it.
