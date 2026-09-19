"""Verified, offline FP32 inference for the supplied sequence-only checkpoints.

The tokenizer is copied verbatim from Model/crispert_share/crispert_small;
its SHA-256 and all checkpoint SHA-256 values live in models.manifest.json.
No training framework, model downloads, or user-supplied checkpoints are used.
"""

from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path

import torch
import transformers
from transformers import BertConfig, BertForSequenceClassification

from .sequence import ValidationError, normalize_pairs
from .tokenizer import PairTokenizer


MODEL_SHA256 = {
    "k1": "3e7122c71ef17dbc7ff106a4e8fb8bc28f76d9437adb91713bb8c5ad5c097341",
    "k2": "6301fac57abd68a33a5c3297c5370ad68cf60152902ad2d6435f8aa4eef6bd3c",
    "k3": "2cda2ea188794290a16ebf9d04e686fa5de4f61cdda76f6f16c3bdd5bba00dff",
}
PARAMETERS = {"k1": 552962, "k2": 583554, "k3": 1074946}


class ModelError(RuntimeError):
    """A model deployment is incomplete or inconsistent."""


class InferenceEngine:
    def __init__(self, model_root: str | Path, device: str = "cpu", batch_size: int = 256):
        self.model_root = Path(model_root)
        if device == "auto":
            device = "cuda" if torch.cuda.is_available() else "cpu"
        if device not in {"cpu", "cuda", "cuda:0"}:
            raise ModelError("Inference device must be cpu, cuda or auto.")
        if device.startswith("cuda") and not torch.cuda.is_available():
            raise ModelError("CUDA was requested but is unavailable.")
        if not 1 <= batch_size <= 4096:
            raise ModelError("Inference batch size must be between 1 and 4096.")
        self.device = device
        self.batch_size = batch_size
        self._models: dict[str, tuple] = {}

    def _load(self, name: str):
        if name in self._models:
            return self._models[name]
        if name not in MODEL_SHA256:
            raise ValidationError("Choose k1, k2 or k3.")
        path = self.model_root / name / "model.ckpt"
        if not path.is_file():
            raise ModelError(f"Checkpoint {name} is not installed.")
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        if digest != MODEL_SHA256[name]:
            raise ModelError(f"Checkpoint {name} failed SHA-256 verification.")
        checkpoint = torch.load(path, map_location="cpu", weights_only=True)
        cfg = checkpoint["hyper_parameters"]["cfg"]
        k = int(name[1])
        if cfg.get("epi_enabled", False) or cfg.get("epi_dim") or cfg.get("late_cols", []):
            raise ModelError("Only sequence-only checkpoints are supported.")
        expected = {"kmer": k, "vocab_size": 5 + 16 ** k, "max_len": 26 - k,
                    "hidden_size": 128, "num_layers": 4, "num_heads": 4, "intermediate_size": 256}
        if any(cfg.get(key) != value for key, value in expected.items()):
            raise ModelError(f"Checkpoint {name} has an unexpected architecture.")
        # Identical geometry and defaults to the supplied build_bert_config.
        config = BertConfig(
            vocab_size=cfg["vocab_size"], hidden_size=cfg["hidden_size"],
            num_hidden_layers=cfg["num_layers"], num_attention_heads=cfg["num_heads"],
            intermediate_size=cfg["intermediate_size"], max_position_embeddings=cfg["max_len"],
            hidden_dropout_prob=cfg["hidden_dropout_prob"],
            attention_probs_dropout_prob=cfg["attention_probs_dropout_prob"],
            type_vocab_size=1, num_labels=2, pad_token_id=0,
        )
        model = BertForSequenceClassification(config)
        state = checkpoint["state_dict"]
        if not state or any(not key.startswith("model.") for key in state):
            raise ModelError(f"Checkpoint {name} includes unexpected state keys.")
        model.load_state_dict({key[len("model."):]: value for key, value in state.items()}, strict=True)
        if sum(p.numel() for p in model.parameters()) != PARAMETERS[name]:
            raise ModelError(f"Checkpoint {name} has an unexpected parameter count.")
        model.eval().to(self.device)
        tokenizer = PairTokenizer(max_len=cfg["max_len"], k=k)
        self._models[name] = (model, tokenizer)
        return model, tokenizer

    def warmup(self) -> None:
        """Verify every installed model before reporting the worker ready."""
        for name in MODEL_SHA256:
            self._load(name)

    def metadata(self) -> dict:
        return {
            "family": "CRISPert-small sequence-only", "device": self.device,
            "precision": "float32", "default_model": "k1", "sequence_length": 23,
            "runtime": {"torch": torch.__version__, "transformers": transformers.__version__, "cuda": torch.version.cuda},
            "score_definition": "Uncalibrated positive-class softmax; not cleavage frequency or clinical safety.",
            "models": [{"id": name, "kmer": int(name[1]), "parameters": PARAMETERS[name], "sha256": digest}
                       for name, digest in MODEL_SHA256.items()],
        }

    def score(self, pairs: list[dict], models: list[str] | None = None) -> list[dict]:
        names = models if models is not None else ["k1"]
        if not names or len(set(names)) != len(names) or any(name not in MODEL_SHA256 for name in names):
            raise ValidationError("Select one or more distinct models: k1, k2, k3.")
        if not pairs:
            return []
        rows = normalize_pairs(pairs)
        for row in rows:
            row["scores"] = {}
        for name in names:
            model, tokenizer = self._load(name)
            with torch.inference_mode():
                for start in range(0, len(rows), self.batch_size):
                    part = rows[start:start + self.batch_size]
                    ids, masks = tokenizer.encode_batch([r["target"] for r in part], [r["off_target"] for r in part])
                    logits = model(
                        input_ids=torch.tensor(ids, dtype=torch.long, device=self.device),
                        attention_mask=torch.tensor(masks, dtype=torch.long, device=self.device),
                    ).logits
                    scores = torch.softmax(logits, dim=1)[:, 1].cpu().tolist()
                    for row, score in zip(part, scores):
                        if not math.isfinite(score) or not 0 <= score <= 1:
                            raise ModelError("Inference returned an invalid score.")
                        row["scores"][name] = score
        return rows
