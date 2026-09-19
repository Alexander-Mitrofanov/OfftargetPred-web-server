"""Reproduce the supplied K562 held-out references with the production adapter.

Run from WebServer: PYTHONPATH=backend .venv/bin/python tests/benchmark_models.py
The fixture data and training-only metric dependencies are intentionally not
required by the deployed service. Results are printed as JSON for provenance.
"""

import json
from pathlib import Path
import time

import numpy as np
import pandas as pd
from sklearn.metrics import average_precision_score, roc_auc_score
import torch

from offtargetpred.inference import InferenceEngine


def main():
    root = Path(__file__).resolve().parents[1]
    source = root / "Model/crispert_share"
    frame = pd.read_csv(source / "data/k562_dataset_invivo_full.csv")
    pairs = frame.rename(columns={"Guide_sequence": "target", "Target_sequence": "off_target"}).to_dict("records")
    torch.set_num_threads(4)
    engine = InferenceEngine(source / "models", batch_size=512)
    start = time.monotonic()
    rows = engine.score(pairs, ["k1", "k2", "k3"])
    results = {}
    for name, expected in zip(["k1", "k2", "k3"], [0.6476, 0.5369, 0.5533]):
        probabilities = np.asarray([row["scores"][name] for row in rows])
        macro = []
        for _, group in frame.groupby("Guide_sequence"):
            labels = group["label"].to_numpy()
            if 0 < labels.sum() < len(labels):
                macro.append(average_precision_score(labels, probabilities[group.index]))
        measured = float(np.mean(macro))
        results[name] = {"macro_auprc": measured, "reference_macro_auprc": expected,
                         "pooled_auprc": average_precision_score(frame.label, probabilities),
                         "pooled_auroc": roc_auc_score(frame.label, probabilities),
                         "evaluated_guides": len(macro), "passed": abs(measured - expected) < 0.0001}
    report = {"dataset": "k562_dataset_invivo_full", "rows": len(frame), "device": "cpu",
              "torch_version": torch.__version__, "elapsed_seconds": round(time.monotonic() - start, 2),
              "models": results}
    print(json.dumps(report, indent=2))
    if not all(item["passed"] for item in results.values()):
        raise SystemExit("Reference macro AUPRC failed reproduction.")


if __name__ == "__main__":
    main()
