# Scientific council: CRISPert sequence-only service

Date: 2026-09-19. Scope: read-only review of `Model/crispert_share`, its 13-page manuscript, checkpoint metadata, tokenizer, inference code, and supplied datasets.

## Decision

Build a candidate-pair scoring service for SpCas9-style aligned 23 nt sequence pairs (20 nt protospacer plus 3 nt PAM). Offer k=1 (default), k=2, and k=3; optionally score a batch with all three, preserving separate results. This package contains no reference genome, candidate finder, or genome-search index. Do not present a genome search or guide-wide specificity score unless a separate real search pipeline is implemented. CasKAS, epigenetic tracks, and late-fusion inputs are excluded.

## Verified checkpoint contract

Each local Lightning 2.4 checkpoint loads using `torch.load(..., map_location="cpu", weights_only=True)`. Each contains 73 tensors, all prefixed `model.`, and no epigenetic/late-fusion parameters. Hyperparameters omit `epi_enabled` and `late_cols`, so Config defaults resolve them to false and empty. All models have 4 BERT layers, hidden width 128, 4 attention heads, intermediate width 256, 2 output classes, and 1 token type.

| Model | Vocabulary | Input tokens incl. CLS/SEP | Parameters | SHA-256 |
|---|---:|---:|---:|---|
| k1 | 21 | 25 | 552,962 | `3e7122c71ef17dbc7ff106a4e8fb8bc28f76d9437adb91713bb8c5ad5c097341` |
| k2 | 261 | 24 | 583,554 | `6301fac57abd68a33a5c3297c5370ad68cf60152902ad2d6435f8aa4eef6bd3c` |
| k3 | 4,101 | 23 | 1,074,946 | `2cda2ea188794290a16ebf9d04e686fa5de4f61cdda76f6f16c3bdd5bba00dff` |

The supplied README says k1 is scratch-trained, k2/k3 use artificial MLM pretraining, and all were fine-tuned using the full 17-guide T-cell set. It calls these seed 0 runs, but saved cfg.seed is 42. Do not assert seed provenance as independently verified. The T-cell CSV is training data, not a held-out benchmark.

## Input and inference

- Input consists of a guide-associated target sequence and aligned candidate genomic sequence, both 23 nt, represented 5'-to-3' in the same orientation with PAM last. Do not complement, align, append a made-up PAM, or strip PAM automatically.
- Use supplied `crispert_small.tokenizer.PairTokenizer(max_len=cfg.max_len, k=cfg.kmer)` unchanged. It maps each aligned pair to one of 16 directional symbols, then overlapping k-mers. Each k-mer containing N maps to UNK.
- Accept uppercase/lowercase DNA A/C/G/T/N; normalize outer whitespace and case. Reject gaps, RNA U, non-IUPAC letters, 20/22/24 nt sequences, missing fields, and empty requests with row-level actionable errors. Surface N warnings.
- **Found defect:** README claims invalid characters and non-23 nt rows are dropped, but `data.filter_alignable` only checks equal lengths. The tokenizer truncates equal overlong pairs. The web API must enforce its own strict validation rather than calling the permissive CSV loader.
- All supplied datasets have 23 nt ACGT pairs. Guide PAMs are NGG; candidate PAMs include many non-NGG triplets. Therefore do not hard reject candidate non-NGG PAMs. A guide non-NGG warning is reasonable.
- Model score is `softmax(logits, dim=1)[:,1]`. Call it **CRISPert score**, an uncalibrated classification score in [0,1]. It is not measured cleavage frequency, a calibrated probability, a clinical safety judgment, or validated guide-level specificity. No undocumented threshold or ensemble should be added.

## Manuscript interpretation

The embedded manuscript, “CRISPert: A Transformer-based Model for CRISPR-Cas Off-target Prediction,” explains pair encoding, masked-token pretraining, candidate classification, and optional CasKAS concentration features (sections 3.1-3.5; Figures 1-2 visually inspected). Its architecture is a larger 12-layer model, and its DeepCRISPR/CasKAS experiments differ from these supplied small 4-layer checkpoints. Treat the paper as method background; do not advertise its 0.72 AUC-PR as the deployed checkpoint performance. CasKAS features and manuscript CasKAS improvement claims do not apply to this service.

## Production implementation recommendation

Load only the three server-owned fixed checkpoints, verify SHA-256 against a manifest, reject feature-bearing configs, construct `BertForSequenceClassification` through supplied `build_classifier(cfg, pretrained_dir=None)`, require every state key to start `model.`, strip the prefix, then `load_state_dict(strict=True)`. This avoids training-only Lightning, pandas, sklearn and torchmetrics runtime dependencies. Keep torch, transformers and PyYAML pinned. Use model.eval(), torch.inference_mode(), bounded batches, FP32 by default, one inference worker and offline Hugging Face configuration. Do not accept arbitrary checkpoint paths or uploaded model files.

## Required validation

1. Token ids and masks match supplied tokenizer for all k values, including Ns and mismatch direction.
2. Production outputs match the supplied Lightning evaluation path on representative records for all three models (CPU tolerance approximately 1e-6; explicit GPU tolerance measured).
3. Full held-out k562_invivo reference per-guide macro AUPRC reproduces 0.6476 / 0.5369 / 0.5533 (within rounding), or document any discrepancy; do not use T-cell memorization as evidence.
4. Exact 23 nt length, missing/empty/invalid character errors, duplicate ids/rows, stable input-result association, finite bounded scores, and deterministic repeated inference.
5. Chunked batches equal single-batch results; all-three scoring preserves independent model columns and metadata.
6. Fail closed for checkpoint checksum/state/config mismatch, missing models, or feature-dependent checkpoint.

## Remaining dependencies

No model-science blocker for candidate scoring. Genome-wide search is separate engineering and data provisioning. Local Python has torch 2.11 CPU and no transformers; build an isolated test environment with torch2.4.1/transformers4.46.3 (plus Lightning2.4 only for parity) to validate the adapter. Deployment council notes V100 compatibility requires CUDA 12-compatible torch, not a CUDA13 build.
