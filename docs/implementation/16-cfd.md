# Improvement 16: local per-site CFD baseline

## Delivery and integration

Implemented a compact, dependency-free SpCas9 CFD scorer. It returns a separate
per-site score on the original CFD 0–1 scale. Higher means greater predicted
relative cleavage activity at that candidate. The result is not a calibrated
probability, a guide-level specificity/risk estimate, or an ensemble with CRISPert.
A zero weight does not establish absence of cleavage.

Owned files:

- `backend/offtargetpred/cfd.py`
- `backend/offtargetpred/resources/cfd/`: original plain-text parameter tables,
  upstream MIT notice, provenance manifest, independent reference vectors, and
  the project-owned vector regeneration utility.
- `tests/test_cfd.py`
- This delivery note.

Coordinator integration (shared files were not edited):

```python
from offtargetpred.cfd import cfd_metadata, score_cfd

row.setdefault("baselines", {})["cfd"] = score_cfd(row["target"], row["off_target"])
analysis_metadata.setdefault("baselines", {})["cfd"] = cfd_metadata()
```

`score_cfd(guide23, candidate23)` returns
`{"score": float, "version": "cfd-spcas9-doench2016-crisprscore-595d9a8-v1"}`.
Unsupported inputs or unavailable/corrupt parameter resources return
`{"score": null, "reason": "...", "version": "..."}`. Both functions perform
only local computation. No user sequence, token, or coordinate is transmitted.
JSON serialization must preserve numeric zero separately from null.

The wheel must include `resources/cfd/*.txt` and `resources/cfd/*.json` under
`offtargetpred` package data. The audit utility `.py` can also be retained in
source distributions. There are no new runtime dependencies or configuration
variables. Tables are SHA-256 verified on first use and held in immutable memory
for the process lifetime. A missing table disables CFD instead of substituting
weights or failing CRISPert inference. `cfd_metadata()["available"]` exposes this.

Display/export CFD separately from the existing model scores and mismatch count.
The optional feature does not change guide or candidate discovery, CRISPert
checkpoints, tokenizer behavior, result row identity, or the search envelope.
Its interpretation is limited to the explicit candidate set already returned.

## Exact scientific contract

- Both arguments are ungapped, aligned DNA **23-mers**: 20 nt spacer followed by
  the actual 3 nt PAM. Lowercase and outer whitespace are normalized.
- Only A/C/G/T are supported. N, other ambiguous bases, gaps, RNA U, non-string
  inputs, and non-23 nt lengths return null with an input-specific reason.
  N is rejected even in a PAM position that otherwise has no numeric effect.
- Both sequences must already be in guide orientation, 5′→3′ with PAM on the
  right. A genomic minus-strand candidate receives **no second reverse complement**.
  This sequence-only interface cannot infer orientation from genomic coordinates.
- Mismatch position 1 is the PAM-distal 5′ base; position 20 is PAM-proximal.
- For each spacer mismatch, multiply its position/base-specific factor. Matches
  contribute 1. Multiply the product by the candidate PAM's **last two bases**.
  The guide PAM and the first base of the candidate PAM do not affect CFD.
  Noncanonical candidate PAMs use their published factors; this does not broaden
  the genome search, which still follows its own NGG constraints.
- Original Doench key notation uses RNA guide base and complementary DNA target
  base. Guide T becomes U internally. For example, guide DNA T vs candidate DNA
  C gives `rU:dG`, **not** `rU:dC`. crisprScore's equivalent table key is `TCp`.
  We transform each pinned table key to the original notation once at load time.

The source model and input conventions are documented by
[Doench et al. (2016)](https://doi.org/10.1038/nbt.3437), the
[crisprScore author implementation](https://github.com/crisprVerse/crisprScore/blob/595d9a8ad1f4ba95ee2dca20786921f89be3004c/R/getCFDScores.R),
and [Broad's CFD description](https://portals.broadinstitute.org/gpp/public/software/sgrna-scoring-help).

## Parameter redistribution audit

Audit date: **19 September 2026**. Parameter source is
`crisprVerse/crisprScore`, commit
`595d9a8ad1f4ba95ee2dca20786921f89be3004c`. The two text tables were copied
byte-for-byte from `inst/cfd_cas9/`; the accompanying
[process.R](https://github.com/crisprVerse/crisprScore/blob/595d9a8ad1f4ba95ee2dca20786921f89be3004c/inst/cfd_cas9/process.R)
shows those columns becoming the runtime CFD weights. The source tree was
inspected for CFD-specific license files and exclusions.

The [upstream README license section](https://github.com/crisprVerse/crisprScore/blob/595d9a8ad1f4ba95ee2dca20786921f89be3004c/README.md#license)
declares MIT for the project as a whole and identifies `inst/python` as the
location of underlying Python implementations and their individual licenses.
The CFD text tables live in `inst/cfd_cas9`, outside that subtree. No separate
CFD restriction or exclusion appeared in the inspected tree. The
[upstream LICENSE](https://github.com/crisprVerse/crisprScore/blob/595d9a8ad1f4ba95ee2dca20786921f89be3004c/LICENSE)
is retained unchanged as `LICENSE.crisprScore.txt`, including the Genentech 2022
copyright, permission grant, retention condition and disclaimer.
This records the upstream distribution terms supporting this vendoring decision;
the user's MIT choice for their own code is not used as permission for the data.

The Broad portal currently has separate
[portal terms](https://portals.broadinstitute.org/gpp/public/analysis-tools/sgrna-design),
including commercial-use restrictions. We did not download our distributed
parameters from that portal or treat its availability as a redistribution grant.
No original Broad/Doench Python code or pickle files are redistributed here.
The separate temporary reference audit below does not assert a new license for
those reference artifacts.

`resources/cfd/provenance.json` preserves source URLs/commit, license rationale,
all inspected author-file hashes, bundled-file hashes and numerical-audit details.

| Distributed artifact | SHA-256 |
|---|---|
| `cfd.mm.scores.cas9.txt` (240 factors) | `636e1d8e65f429db8c578036a673cb4516e896c05f594e3ab134734aab84dafc` |
| `cfd.pam.scores.cas9.txt` (16 factors) | `3f83c4f659cda48795312c080f8528984a3ce25f9b2475d79cb80b4835fb3b45` |
| `LICENSE.crisprScore.txt` | `023d7b6c330e5e1d769d28b329a1b4efcac23d36f169394cebc58b60dbd3dc11` |

## Independent numerical validation

The oracle is the
[Doench calculator distributed in CRISPOR](https://github.com/maximilianh/crisporWebsite/blob/486659fb3594f57fa108698a5f2a1f3ae649968c/CFD_Scoring/cfd-score-calculator.py)
at commit `486659fb3594f57fa108698a5f2a1f3ae649968c`; its adjacent
[README attributes CFD to John Doench](https://github.com/maximilianh/crisporWebsite/blob/486659fb3594f57fa108698a5f2a1f3ae649968c/CFD_Scoring/README.txt).
We executed the unchanged `revcom` and `calc_cfd` function bodies in a temporary
audit environment using the original reference parameter dictionaries. Only the
Python 2 CLI was omitted and its file loader replaced with data-only pickle
deserialization that forbids Python globals. The local scorer and bundled
crisprScore parameters are not used to generate expected results.

The audit compared all 240 transformed mismatch factors and 16 PAM factors
against the original dictionaries. Keys match completely. Maximum absolute
differences were `1.1102230246251565e-16` (mismatch) and
`5.551115123125783e-17` (PAM), attributable to decimal/binary float representation.

| Temporary reference artifact | SHA-256 |
|---|---|
| `cfd-score-calculator.py` | `75a034b1af0f89ad21b8653e854750495315c972adb86d9dd1bfb31179d181bc` |
| `mismatch_score.pkl` | `c58e9c1a85f01e423c35fd02aa5a27a23ab27e95c2e98abdcfc71cf4b2667f4b` |
| `pam_scores.pkl` | `ae486444a9135e3acc1f1b9a3973f1069e84efe7a1738a87d10d523bfb46b37e` |

The 280 archived numerical vectors cover all 12 substitutions at all 20
positions, all 16 PAM dinucleotides, exact matches, both first-PAM/guide-PAM
invariance conventions, 2/3/5/20 mismatch products, and plus/minus genomic loci
with already-oriented inputs. Fixtures include expected numeric zero. Examples:

| Case | Reference score |
|---|---:|
| Exact spacer and NGG candidate PAM | `1.0` |
| T→C mismatch at position 1, NGG | `0.857142857` |
| T→C mismatch at position 20, NGG | `0.090909091` |
| Exact spacer, NAG candidate PAM | `0.259259259` |
| A→C at positions 1 and 20 in `ATCGATGCTGATGCTAGATA`, NGG | `0.19480519453896103` |

To reproduce the fixture file, obtain the three hash-pinned reference artifacts
above from the stated commit into a temporary directory. Then run from the
project root:

```bash
python backend/offtargetpred/resources/cfd/generate_reference_vectors.py \
  /tmp/cfd-reference /tmp/reference_vectors.json
cmp /tmp/reference_vectors.json backend/offtargetpred/resources/cfd/reference_vectors.json
python -m pytest -q tests/test_cfd.py
```

Validation: **318 tests passed** locally on Python 3.12.7, including every
independent numerical vector at absolute tolerance `1e-12` (relative tolerance
zero), input-specific null reasons, normalization, metadata serialization,
resource hashes, and fail-closed missing/corrupt resources. These are lightweight
unit/reference calculations; no model inference or production mutation occurred.
No new predictive-performance claim or external comparative study is made.

Coordinator acceptance checks: confirm the built wheel contains the resource
files (the shared package-data rule now includes them) and connect the optional
result/metadata fields. No unresolved parameter-redistribution blocker was found
in this source audit.
