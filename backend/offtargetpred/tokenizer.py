"""Pair-alphabet tokenizer for aligned (sgRNA, off-target) sequence pairs.

Each aligned base pair collapses into one of 16 symbols, one token per
position. The 3-mer step used by the original CRISPert is dropped: at k=1 the
vocabulary is 21 instead of 4101, and masked positions no longer leak into
their neighbours, so MLM needs no neighbour-expansion hack.
"""

from typing import Dict, List, Sequence, Tuple

PAD, UNK, CLS, SEP, MASK = "[PAD]", "[UNK]", "[CLS]", "[SEP]", "[MASK]"
SPECIAL_TOKENS = [PAD, UNK, CLS, SEP, MASK]

# (target base, off-target base) -> single symbol. Diagonal entries (a match)
# keep the base itself; the 12 off-diagonal entries encode which substitution
# occurred, which is what carries the mismatch signal.
ENCODE_DICT: Dict[Tuple[str, str], str] = {
    ("A", "A"): "A", ("A", "C"): "Z", ("A", "G"): "Y", ("A", "T"): "X",
    ("C", "C"): "C", ("C", "A"): "W", ("C", "G"): "V", ("C", "T"): "U",
    ("G", "G"): "G", ("G", "A"): "S", ("G", "C"): "R", ("G", "T"): "L",
    ("T", "T"): "T", ("T", "A"): "Q", ("T", "C"): "P", ("T", "G"): "O",
}

PAIR_SYMBOLS = sorted(set(ENCODE_DICT.values()))
VOCAB: Dict[str, int] = {tok: i for i, tok in enumerate(SPECIAL_TOKENS + PAIR_SYMBOLS)}
IDS_TO_TOKENS: Dict[int, str] = {i: tok for tok, i in VOCAB.items()}

VOCAB_SIZE = len(VOCAB)  # 21
PAD_ID = VOCAB[PAD]
UNK_ID = VOCAB[UNK]
CLS_ID = VOCAB[CLS]
SEP_ID = VOCAB[SEP]
MASK_ID = VOCAB[MASK]

# Ids that MLM must never mask or predict.
SPECIAL_IDS = [VOCAB[t] for t in SPECIAL_TOKENS]


def encode_to_tokens(target: str, off_target: str) -> List[str]:
    """Collapse two aligned sequences into per-position pair-alphabet tokens.

    Unknown pairs (an ``N``, a gap, lowercase soft-masking) become ``[UNK]``
    rather than raising, so rows do not have to be dropped upstream.
    """
    return [ENCODE_DICT.get((t, o), UNK) for t, o in zip(target.upper(), off_target.upper())]


class PairTokenizer:
    """Turns a (target, off_target) pair into padded ids + attention mask."""

    def __init__(self, max_len: int = 25, k: int = 1):
        if max_len < 3:
            raise ValueError("max_len must leave room for [CLS] and [SEP]")
        if k < 1:
            raise ValueError("k must be >= 1")
        self.max_len = max_len
        self.k = k
        self.vocab = VOCAB if k == 1 else build_vocab(k)
        self.vocab_size = vocab_size_for(k)
        self._inv = {v: kk for kk, v in self.vocab.items()}

    @property
    def max_pair_len(self) -> int:
        """Longest alignment that fits once [CLS]/[SEP] are added."""
        return self.max_len - 2

    def encode(self, target: str, off_target: str) -> Tuple[List[int], List[int]]:
        if len(target) != len(off_target):
            raise ValueError(
                "target and off_target must be pre-aligned to equal length, "
                "got {} and {}".format(len(target), len(off_target))
            )
        symbols = encode_to_tokens(target, off_target)
        ids = [CLS_ID] + kmer_ids(symbols, self.k)[: self.max_pair_len] + [SEP_ID]
        mask = [1] * len(ids)
        pad = self.max_len - len(ids)
        if pad:
            ids += [PAD_ID] * pad
            mask += [0] * pad
        return ids, mask

    def encode_batch(
        self, targets: Sequence[str], off_targets: Sequence[str]
    ) -> Tuple[List[List[int]], List[List[int]]]:
        ids, masks = [], []
        for t, o in zip(targets, off_targets):
            i, m = self.encode(t, o)
            ids.append(i)
            masks.append(m)
        return ids, masks

    def decode(self, ids: Sequence[int], skip_special: bool = True) -> str:
        toks = [self._inv.get(int(i), UNK) for i in ids]
        if skip_special:
            toks = [t for t in toks if t not in SPECIAL_TOKENS]
        return "".join(toks)


# ---------------------------------------------------------------------------
# k-mer support
#
# The original CRISPert used k=3 over this same pair alphabet (vocab 16^3+5 =
# 4101). k=1 is the default here because it keeps the embedding table at 21
# rows; k>1 is provided so the choice can be measured rather than assumed.
# ---------------------------------------------------------------------------

GUIDE_LEN = 23
SYM_INDEX = {sym: i for i, sym in enumerate(PAIR_SYMBOLS)}   # symbol -> 0..15


def vocab_size_for(k: int) -> int:
    return len(SPECIAL_TOKENS) + 16 ** k


def seq_len_for(k: int, guide_len: int = GUIDE_LEN) -> int:
    """Token count including [CLS] and [SEP]."""
    return (guide_len - k + 1) + 2


def build_vocab(k: int) -> Dict[str, int]:
    """Full token->id map for k-mers over the pair alphabet."""
    from itertools import product
    vocab = {tok: i for i, tok in enumerate(SPECIAL_TOKENS)}
    for i, combo in enumerate(product(PAIR_SYMBOLS, repeat=k)):
        vocab["".join(combo)] = len(SPECIAL_TOKENS) + i
    return vocab


def kmer_ids(symbols: List[str], k: int) -> List[int]:
    """Per-position pair symbols -> overlapping k-mer ids.

    Any k-mer containing an unrecognised position becomes [UNK].
    """
    if k == 1:
        return [VOCAB.get(s, UNK_ID) for s in symbols]
    out = []
    base = len(SPECIAL_TOKENS)
    for i in range(len(symbols) - k + 1):
        window = symbols[i:i + k]
        if any(w not in SYM_INDEX for w in window):
            out.append(UNK_ID)
            continue
        idx = 0
        for w in window:
            idx = idx * 16 + SYM_INDEX[w]
        out.append(base + idx)
    return out
