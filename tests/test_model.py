"""Scientific contract tests using actual supplied checkpoints, never mock scores."""

import hashlib
import importlib.util
import json
from pathlib import Path

import numpy as np
import pytest
import torch

from offtargetpred.inference import InferenceEngine, MODEL_SHA256, ModelError
from offtargetpred.sequence import ValidationError, normalize_pairs, parse_guides, parse_pairs
from offtargetpred.tokenizer import PairTokenizer


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "Model" / "crispert_share"
GUIDE = "GATGCTCTCCAGAATCACTGCGG"
SITE = "GTTGCTCTTCAGAATCACTGAGG"


@pytest.fixture(scope="module")
def engine():
    torch.set_num_threads(2)
    return InferenceEngine(SOURCE / "models", batch_size=2)


def test_tokenizer_is_exact_supplied_source():
    deployed = (ROOT / "backend/offtargetpred/tokenizer.py").read_bytes()
    manifest = json.loads((ROOT / "models.manifest.json").read_text())
    assert hashlib.sha256(deployed).hexdigest() == manifest["tokenizer_source_sha256"]
    original = SOURCE / "crispert_small/tokenizer.py"
    if original.is_file():
        assert deployed == original.read_bytes()
    for k, length in ((1, 25), (2, 24), (3, 23)):
        ids, mask = PairTokenizer(max_len=length, k=k).encode(GUIDE, SITE)
        assert len(ids) == len(mask) == length
        assert mask == [1] * length
        assert ids[0] == 2 and ids[-1] == 3
        nids, _ = PairTokenizer(max_len=length, k=k).encode("N" + GUIDE[1:], SITE)
        assert nids[1] == 1


@pytest.mark.parametrize("bad", [GUIDE[:-1], GUIDE + "A", GUIDE.replace("T", "U"), "-" + GUIDE[1:], "", None])
def test_rejects_invalid_sequences_without_silent_truncation(bad):
    with pytest.raises(ValidationError):
        normalize_pairs([{"target": bad, "off_target": SITE}])


def test_pair_parser_aliases_metadata_duplicates_and_ambiguity():
    text = f"ID\tGuide_sequence\tTarget_sequence\tchr\nx\t{GUIDE.lower()}\t{SITE}\tchr1\nx\t{'N' + GUIDE[1:]}\t{SITE}\tchr2\n"
    rows = parse_pairs(text, "tsv")
    assert rows[0]["target"] == GUIDE
    assert [r["row_index"] for r in rows] == [1, 2]
    assert rows[1]["warnings"] and rows[0]["chr"] == "chr1"
    with pytest.raises(ValidationError, match="Ambiguous"):
        parse_pairs(f"target,sgRNA,off_target\n{GUIDE},{GUIDE},{SITE}")


def test_guides_require_actual_pam_and_unique_ids():
    assert parse_guides(f">test\n{GUIDE[:20]}\n{GUIDE[20:]}\n", "fasta") == [{"id": "test", "target": GUIDE}]
    with pytest.raises(ValidationError, match="NGG"):
        parse_guides(GUIDE[:20] + "NNN")
    with pytest.raises(ValidationError, match="unique"):
        parse_guides(f">dup\n{GUIDE}\n>dup\n{GUIDE}\n", "fasta")


@pytest.mark.model
def test_outputs_stable_row_mapping_and_separate_models(engine):
    pairs = [{"id": str(i), "target": GUIDE, "off_target": site} for i, site in enumerate([SITE, GUIDE, "N" + SITE[1:]])]
    first = engine.score(pairs, ["k1", "k2", "k3"])
    assert [r["id"] for r in first] == ["0", "1", "2"]
    assert first[1]["exact_match"] and first[2]["warnings"]
    engine.batch_size = 8
    second = engine.score(pairs, ["k1", "k2", "k3"])
    for before, after in zip(first, second):
        assert set(before["scores"]) == {"k1", "k2", "k3"}
        for name in before["scores"]:
            assert 0 <= before["scores"][name] <= 1
            assert before["scores"][name] == pytest.approx(after["scores"][name], abs=1e-6)


@pytest.mark.model
def test_adapter_matches_supplied_lightning_path(engine, monkeypatch):
    # The original training framework is a TEST dependency, never production.
    pytest.importorskip("pytorch_lightning")
    monkeypatch.syspath_prepend(str(SOURCE))
    from crispert_small.config import Config
    from crispert_small.finetune import ClassifierModule
    from crispert_small.tokenizer import PairTokenizer as OriginalTokenizer

    pairs = [{"target": GUIDE, "off_target": s} for s in [SITE, GUIDE, "N" + SITE[1:]]]
    results = engine.score(pairs, ["k1", "k2", "k3"])
    for name in MODEL_SHA256:
        checkpoint = SOURCE / "models" / name / "model.ckpt"
        cfg = Config(**torch.load(checkpoint, map_location="cpu", weights_only=True)["hyper_parameters"]["cfg"])
        module = ClassifierModule.load_from_checkpoint(str(checkpoint), map_location="cpu", cfg=cfg, pretrained_dir=None).eval()
        ids, mask = OriginalTokenizer(max_len=cfg.max_len, k=cfg.kmer).encode_batch([p["target"] for p in pairs], [p["off_target"] for p in pairs])
        with torch.inference_mode():
            expected = torch.softmax(module(torch.tensor(ids), torch.tensor(mask)), dim=1)[:, 1].numpy()
        np.testing.assert_allclose([r["scores"][name] for r in results], expected, atol=1e-6, rtol=1e-6)


def test_unverified_checkpoint_fails_closed(tmp_path):
    folder = tmp_path / "k1"
    folder.mkdir()
    (folder / "model.ckpt").write_bytes(b"not a trusted checkpoint")
    with pytest.raises(ModelError, match="SHA-256"):
        InferenceEngine(tmp_path).score([{"target": GUIDE, "off_target": SITE}])


@pytest.mark.parametrize("models", [[], ["k1", "k1"], ["k4"]])
def test_invalid_model_selection(engine, models):
    with pytest.raises(ValidationError):
        engine.score([{"target": GUIDE, "off_target": SITE}], models)
