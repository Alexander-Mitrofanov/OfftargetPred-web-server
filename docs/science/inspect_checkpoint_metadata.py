"""Record selected checkpoint metadata after verifying pinned SHA-256 hashes.

Requires the local private model bundle and PyTorch. Loads on CPU with
weights_only=True; performs no inference, training, or artifact modification.
  .venv/bin/python docs/science/inspect_checkpoint_metadata.py --check
  .venv/bin/python docs/science/inspect_checkpoint_metadata.py --write
"""

import argparse
import hashlib
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / "docs/science/checkpoint-metadata.json"
FIELDS = (
    "kmer", "vocab_size", "max_len", "hidden_size", "num_layers", "num_heads",
    "intermediate_size", "seed", "ft_val_split", "n_samples_per_epoch",
    "pretrained_dir", "epi_dim", "epi_enabled", "late_cols", "synth_dir",
    "target_col", "off_target_col", "label_col", "guide_col",
)


def inspect():
    import torch

    manifest = json.loads((ROOT / "models.manifest.json").read_text())
    result = {
        "schema_version": 1,
        "method": "SHA-256 verified against models.manifest.json before torch.load(map_location='cpu', weights_only=True); selected non-weight fields only.",
        "interpretation": "Saved configuration describes an artifact; absent fields are not assumed false. cfg.seed does not identify a separately passed run seed. Neither metadata nor a pretraining directory proves actual training membership or pretraining corpus identity.",
        "models": {},
    }
    for name, model in manifest["models"].items():
        path = ROOT / "Model/crispert_share/models" / model["path"]
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        if digest != model["sha256"]:
            raise ValueError(f"Checkpoint digest mismatch for {name}")
        checkpoint = torch.load(path, map_location="cpu", weights_only=True)
        hyperparameters = checkpoint["hyper_parameters"]
        cfg = hyperparameters["cfg"]
        result["models"][name] = {
            "path": str(path.relative_to(ROOT)),
            "sha256": digest,
            "saved_config": {key: cfg[key] for key in FIELDS if key in cfg},
            "absent_config_fields": [key for key in FIELDS if key not in cfg],
            "original_training_csv_basename": Path(cfg["train_csv"]).name,
            "saved_hyperparameter_pretrained_dir": hyperparameters.get("pretrained_dir"),
            "independently_verified_run_seed": None,
            "row_level_split_manifest_available": False,
        }
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    action = parser.add_mutually_exclusive_group(required=True)
    action.add_argument("--check", action="store_true")
    action.add_argument("--write", action="store_true")
    args = parser.parse_args()
    result = inspect()
    if args.write:
        OUTPUT.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n")
    elif json.loads(OUTPUT.read_text()) != result:
        raise SystemExit("Checkpoint metadata changed; review before updating provenance")
    print("Verified metadata of 3 pinned checkpoints; no model inference performed.")


if __name__ == "__main__":
    main()
