# Third-party notices

Inventory reviewed 19 September 2026 from the installed development environment.
The project-owned [MIT licence](LICENSE) does not replace any terms below.
This inventory records installed versions, including development and reference
validation packages; it is not a claim that every package ships to web users.
Package versions are a local snapshot, not a substitute for release lock files.
Retain original licence and NOTICE files when distributing their components.

## Supplied CRISPert artifacts: permission unresolved

`backend/offtargetpred/tokenizer.py` is an unchanged copy of the supplied
`Model/crispert_share/crispert_small/tokenizer.py` (SHA-256
`b15aae904e073d53d0c878199a3a04e2eeccb81faeb3e11738dc00bc282cb2e2`).
Its upstream redistribution permission has not been verified. It is excluded
from the OfftargetPred MIT grant; this notice does not supply missing permission.
The supplied model weights, datasets and manuscript are not published in this
repository, and their redistribution permissions remain unresolved. No rights
to those artifacts or to the CRISPert publication are granted here.

The base-method attribution is William Jobson Pargeter, Rolf Backofen and
Van Dinh Tran (2024), *CRISPert: A Transformer-Based Model for CRISPR-Cas
Off-Target Prediction*, ECML PKDD, pp. 92–104,
[doi:10.1007/978-3-031-70368-3_6](https://link.springer.com/chapter/10.1007/978-3-031-70368-3_6).
See [licensing and attribution](docs/licensing.md) and the
[model card](docs/model-card.md) for exact artifact scope.

## CFD parameter tables

The two tables in `backend/offtargetpred/resources/cfd/` are distributed from
[crisprVerse/crisprScore](https://github.com/crisprVerse/crisprScore/tree/595d9a8ad1f4ba95ee2dca20786921f89be3004c/inst/cfd_cas9),
commit `595d9a8ad1f4ba95ee2dca20786921f89be3004c`, under its separate MIT licence:
Copyright (c) 2022, Genentech, Inc. The upstream notice is retained unchanged in
[LICENSE.crisprScore.txt](backend/offtargetpred/resources/cfd/LICENSE.crisprScore.txt).
The [provenance record](backend/offtargetpred/resources/cfd/provenance.json)
contains source URLs, hashes, the inspected licence scope and validation evidence.
No upstream Python calculator or pickle is bundled. Cite the underlying method:
Doench et al. (2016), *Optimized sgRNA design to maximize activity and minimize
off-target effects of CRISPR-Cas9*, Nature Biotechnology 34:184–191,
[doi:10.1038/nbt.3437](https://doi.org/10.1038/nbt.3437).

## Browser runtime attribution

The installed production browser dependencies are React 19.3.0, React DOM
19.3.0 and Scheduler 0.28.0. Each installed package carries the identical MIT
notice below, reproduced unchanged. Build tools and their separate notices
are listed in the frontend inventory. The website makes this document
available as a download so these runtime notices accompany the interface.

```text
MIT License

Copyright (c) Meta Platforms, Inc. and affiliates.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Frontend package inventory

Read from installed `package.json` files and `frontend/package-lock.json`.
Notice paths below are relative to each package directory in
`frontend/node_modules/`. `Metadata only` means no top-level licence file was
found in that installed package; it is not a finding that no terms apply.
Development packages may include further bundled dependencies covered by their
own third-party notices (notably TypeScript, Prettier, Rollup and Vite).

| Package | Installed version | Use | Declared licence | Local notice file(s) |
|---|---|---|---|---|
| `@babel/code-frame` | 7.29.7 | development | MIT | `LICENSE` |
| `@babel/compat-data` | 7.29.7 | development | MIT | `LICENSE` |
| `@babel/core` | 7.29.7 | development | MIT | `LICENSE` |
| `@babel/generator` | 7.29.8 | development | MIT | `LICENSE` |
| `@babel/helper-compilation-targets` | 7.29.7 | development | MIT | `LICENSE` |
| `@babel/helper-globals` | 7.29.7 | development | MIT | `LICENSE` |
| `@babel/helper-module-imports` | 7.29.7 | development | MIT | `LICENSE` |
| `@babel/helper-module-transforms` | 7.29.7 | development | MIT | `LICENSE` |
| `@babel/helper-plugin-utils` | 7.29.7 | development | MIT | `LICENSE` |
| `@babel/helper-string-parser` | 7.29.7 | development | MIT | `LICENSE` |
| `@babel/helper-validator-identifier` | 7.29.7 | development | MIT | `LICENSE` |
| `@babel/helper-validator-option` | 7.29.7 | development | MIT | `LICENSE` |
| `@babel/helpers` | 7.29.7 | development | MIT | `LICENSE` |
| `@babel/parser` | 7.29.9 | development | MIT | `LICENSE` |
| `@babel/plugin-transform-react-jsx-self` | 7.29.7 | development | MIT | `LICENSE` |
| `@babel/plugin-transform-react-jsx-source` | 7.29.7 | development | MIT | `LICENSE` |
| `@babel/template` | 7.29.7 | development | MIT | `LICENSE` |
| `@babel/traverse` | 7.29.8 | development | MIT | `LICENSE` |
| `@babel/types` | 7.29.8 | development | MIT | `LICENSE` |
| `@esbuild/linux-x64` | 0.28.2 | development | MIT | Metadata only |
| `@jridgewell/gen-mapping` | 0.3.13 | development | MIT | `LICENSE` |
| `@jridgewell/remapping` | 2.3.5 | development | MIT | `LICENSE` |
| `@jridgewell/resolve-uri` | 3.1.2 | development | MIT | `LICENSE` |
| `@jridgewell/sourcemap-codec` | 1.6.0 | development | MIT | `LICENSE` |
| `@jridgewell/trace-mapping` | 0.3.31 | development | MIT | `LICENSE` |
| `@napi-rs/lzma-linux-x64-gnu` | 1.5.1 | development | MIT | Metadata only |
| `@rolldown/pluginutils` | 1.0.0-rc.3 | development | MIT | `LICENSE` |
| `@rollup/rollup-linux-x64-gnu` | 4.63.4 | development | MIT | Metadata only |
| `@types/babel__core` | 7.20.5 | development | MIT | `LICENSE` |
| `@types/babel__generator` | 7.27.0 | development | MIT | `LICENSE` |
| `@types/babel__template` | 7.4.4 | development | MIT | `LICENSE` |
| `@types/babel__traverse` | 7.28.0 | development | MIT | `LICENSE` |
| `@types/estree` | 1.0.9 | development | MIT | `LICENSE` |
| `@types/node` | 24.13.6 | development | MIT | `LICENSE` |
| `@types/react` | 19.3.0 | development | MIT | `LICENSE` |
| `@types/react-dom` | 19.3.0 | development | MIT | `LICENSE` |
| `@vitejs/plugin-react` | 5.2.0 | development | MIT | `LICENSE` |
| `baseline-browser-mapping` | 2.11.25 | development | Apache-2.0 | `LICENSE.txt` |
| `browserslist` | 4.29.0 | development | MIT | `LICENSE` |
| `caniuse-lite` | 1.0.30001810 | development | CC-BY-4.0 | `LICENSE` |
| `convert-source-map` | 2.0.0 | development | MIT | `LICENSE` |
| `csstype` | 3.2.3 | development | MIT | `LICENSE` |
| `debug` | 4.4.3 | development | MIT | `LICENSE` |
| `electron-to-chromium` | 1.5.433 | development | ISC | `LICENSE` |
| `esbuild` | 0.28.2 | development | MIT | `LICENSE.md` |
| `escalade` | 3.2.0 | development | MIT | `license` |
| `fdir` | 6.5.0 | development | MIT | `LICENSE` |
| `gensync` | 1.0.0-beta.2 | development | MIT | `LICENSE` |
| `js-tokens` | 4.0.0 | development | MIT | `LICENSE` |
| `jsesc` | 3.1.0 | development | MIT | `LICENSE-MIT.txt` |
| `json5` | 2.2.3 | development | MIT | `LICENSE.md` |
| `lru-cache` | 5.1.1 | development | ISC | `LICENSE` |
| `ms` | 2.1.3 | development | MIT | `license.md` |
| `nanoid` | 3.3.19 | development | MIT | `LICENSE` |
| `node-releases` | 2.0.56 | development | MIT | `LICENSE` |
| `picocolors` | 1.1.1 | development | ISC | `LICENSE` |
| `picomatch` | 4.0.7 | development | MIT | `LICENSE` |
| `postcss` | 8.5.28 | development | MIT | `LICENSE` |
| `prettier` | 3.6.2 | development | MIT | `LICENSE`, `THIRD-PARTY-NOTICES.md` |
| `react` | 19.3.0 | runtime | MIT | `LICENSE` |
| `react-dom` | 19.3.0 | runtime | MIT | `LICENSE` |
| `react-refresh` | 0.18.0 | development | MIT | `LICENSE` |
| `rollup` | 4.63.4 | development | MIT | `LICENSE.md` |
| `scheduler` | 0.28.0 | runtime | MIT | `LICENSE` |
| `semver` | 6.3.1 | development | ISC | `LICENSE` |
| `source-map-js` | 1.2.1 | development | BSD-3-Clause | `LICENSE` |
| `tinyglobby` | 0.2.17 | development | MIT | `LICENSE` |
| `typescript` | 5.9.3 | development | Apache-2.0 | `LICENSE.txt`, `ThirdPartyNoticeText.txt` |
| `undici-types` | 7.18.2 | development | MIT | `LICENSE` |
| `update-browserslist-db` | 1.3.3 | development | MIT | `LICENSE` |
| `vite` | 7.3.6 | development | MIT | `LICENSE.md` |
| `yallist` | 3.1.1 | development | ISC | `LICENSE` |

## Python package inventory

Read from installed Python distribution metadata and licence files in `.venv`.
Paths below are relative to the installed `site-packages` directory. The table
includes runtime, optional reference-validation, test and packaging tools;
these packages are installed separately and are not vendored by this source
repository. Full upstream files, including additional bundled-component terms,
remain authoritative. NumPy, SciPy, pandas, PyTorch, SymPy, setuptools and other
packages carry additional vendor notices; a package's primary licence does not
cover every bundled component. In particular the NumPy/SciPy binary notices
include GCC runtime GPL exceptions and LGPL components. Preserve all of those
notices with binary distributions.

| Package | Installed version | Recorded licence | Local notice file(s) |
|---|---|---|---|
| `aiohappyeyeballs` | 2.7.1 | PSF-2.0 | `aiohappyeyeballs-2.7.1.dist-info/licenses/LICENSE` |
| `aiohttp` | 3.14.3 | Apache-2.0 AND MIT | `aiohttp-3.14.3.dist-info/licenses/LICENSE.txt`, `aiohttp-3.14.3.dist-info/licenses/vendor/llhttp/LICENSE` |
| `aiosignal` | 1.4.0 | Apache-2.0 | `aiosignal-1.4.0.dist-info/licenses/LICENSE` |
| `annotated-doc` | 0.0.5 | MIT | `annotated_doc-0.0.5.dist-info/licenses/LICENSE` |
| `annotated-types` | 0.8.0 | MIT | `annotated_types-0.8.0.dist-info/licenses/LICENSE` |
| `anyio` | 4.15.1 | MIT | `anyio-4.15.1.dist-info/licenses/LICENSE` |
| `attrs` | 26.1.0 | MIT | `attrs-26.1.0.dist-info/licenses/LICENSE` |
| `certifi` | 2026.7.22 | MPL-2.0 | `certifi-2026.7.22.dist-info/licenses/LICENSE` |
| `charset-normalizer` | 3.5.1 | MIT | `charset_normalizer-3.5.1.dist-info/licenses/LICENSE` |
| `click` | 8.5.0 | BSD-3-Clause | `click-8.5.0.dist-info/licenses/LICENSE.txt` |
| `cloudpickle` | 3.1.2 | BSD-3-Clause | `cloudpickle-3.1.2.dist-info/licenses/LICENSE` |
| `fastapi` | 0.139.2 | MIT | `fastapi-0.139.2.dist-info/licenses/LICENSE` |
| `filelock` | 3.32.3 | MIT | `filelock-3.32.3.dist-info/licenses/LICENSE` |
| `frozenlist` | 1.8.0 | Apache-2.0 | `frozenlist-1.8.0.dist-info/licenses/LICENSE` |
| `fsspec` | 2026.7.0 | BSD-3-Clause | `fsspec-2026.7.0.dist-info/licenses/LICENSE` |
| `h11` | 0.16.0 | MIT | `h11-0.16.0.dist-info/licenses/LICENSE.txt` |
| `hf-xet` | 1.6.0 | Apache-2.0 | `hf_xet-1.6.0.dist-info/licenses/LICENSE` |
| `httpcore` | 1.0.9 | BSD-3-Clause | `httpcore-1.0.9.dist-info/licenses/LICENSE.md` |
| `httpx` | 0.28.1 | BSD-3-Clause | `httpx-0.28.1.dist-info/licenses/LICENSE.md` |
| `huggingface_hub` | 0.36.2 | Apache-2.0 | `huggingface_hub-0.36.2.dist-info/licenses/LICENSE` |
| `idna` | 3.20 | BSD-3-Clause | `idna-3.20.dist-info/licenses/LICENSE.md` |
| `iniconfig` | 2.3.0 | MIT | `iniconfig-2.3.0.dist-info/licenses/LICENSE` |
| `Jinja2` | 3.1.6 | BSD-3-Clause | `jinja2-3.1.6.dist-info/licenses/LICENSE.txt` |
| `joblib` | 1.6.0 | BSD-3-Clause | `joblib-1.6.0.dist-info/licenses/LICENSE.txt` |
| `lightning-utilities` | 0.15.3 | Apache-2.0 | `lightning_utilities-0.15.3.dist-info/licenses/LICENSE` |
| `MarkupSafe` | 3.0.3 | BSD-3-Clause | `markupsafe-3.0.3.dist-info/licenses/LICENSE.txt` |
| `mpmath` | 1.3.0 | BSD-3-Clause | `mpmath-1.3.0.dist-info/LICENSE` |
| `multidict` | 6.9.0 | Apache-2.0 | `multidict-6.9.0.dist-info/licenses/LICENSE` |
| `networkx` | 3.6.1 | BSD-3-Clause | `networkx-3.6.1.dist-info/licenses/LICENSE.txt` |
| `numpy` | 1.26.4 | BSD-3-Clause; additional bundled-component terms | `numpy-1.26.4.dist-info/LICENSE.txt` |
| `packaging` | 26.3 | Apache-2.0 OR BSD-2-Clause | `packaging-26.3.dist-info/licenses/LICENSE`, `packaging-26.3.dist-info/licenses/LICENSE.APACHE`, `packaging-26.3.dist-info/licenses/LICENSE.BSD` |
| `pandas` | 2.2.3 | BSD-3-Clause; additional bundled-component terms | `pandas-2.2.3.dist-info/LICENSE` |
| `pip` | 24.2 | MIT | `pip-24.2.dist-info/LICENSE.txt` |
| `pluggy` | 1.6.0 | MIT | `pluggy-1.6.0.dist-info/licenses/LICENSE` |
| `propcache` | 0.5.4 | Apache-2.0 | `propcache-0.5.4.dist-info/licenses/LICENSE`, `propcache-0.5.4.dist-info/licenses/NOTICE` |
| `pydantic` | 2.13.5 | MIT | `pydantic-2.13.5.dist-info/licenses/LICENSE` |
| `pydantic_core` | 2.46.5 | MIT | `pydantic_core-2.46.5.dist-info/licenses/LICENSE` |
| `Pygments` | 2.21.0 | BSD-2-Clause | `pygments-2.21.0.dist-info/licenses/LICENSE` |
| `pytest` | 9.1.1 | MIT | `pytest-9.1.1.dist-info/licenses/LICENSE` |
| `python-dateutil` | 2.9.0.post0 | Apache-2.0 and BSD-3-Clause (file-specific) | `python_dateutil-2.9.0.post0.dist-info/LICENSE` |
| `pytorch-lightning` | 2.4.0 | Apache-2.0 | `pytorch_lightning-2.4.0.dist-info/LICENSE` |
| `pytz` | 2026.3.post1 | MIT | `pytz-2026.3.post1.dist-info/LICENSE.txt` |
| `PyYAML` | 6.0.3 | MIT | `pyyaml-6.0.3.dist-info/licenses/LICENSE` |
| `regex` | 2026.9.10 | Apache-2.0 AND CNRI-Python | `regex-2026.9.10.dist-info/licenses/LICENSE.txt` |
| `requests` | 2.34.2 | Apache-2.0 | `requests-2.34.2.dist-info/licenses/LICENSE`, `requests-2.34.2.dist-info/licenses/NOTICE` |
| `safetensors` | 0.8.0 | Apache-2.0 | `safetensors-0.8.0.dist-info/licenses/LICENSE` |
| `scikit-learn` | 1.5.2 | BSD-3-Clause | `scikit_learn-1.5.2.dist-info/COPYING` |
| `scipy` | 1.17.1 | BSD-3-Clause; additional bundled-component terms | `scipy-1.17.1.dist-info/LICENSE.txt` |
| `setuptools` | 78.1.0 | MIT; additional bundled-component terms | `setuptools-78.1.0.dist-info/licenses/LICENSE` |
| `six` | 1.17.0 | MIT | `six-1.17.0.dist-info/LICENSE` |
| `starlette` | 1.6.0 | BSD-3-Clause | `starlette-1.6.0.dist-info/licenses/LICENSE.md` |
| `sympy` | 1.14.0 | BSD-3-Clause; additional bundled-component terms | `sympy-1.14.0.dist-info/licenses/LICENSE` |
| `threadpoolctl` | 3.7.0 | BSD-3-Clause | `threadpoolctl-3.7.0.dist-info/licenses/LICENSE` |
| `tokenizers` | 0.20.3 | Apache-2.0 (metadata; no installed notice file) | Metadata only |
| `torch` | 2.4.1+cpu | BSD-3-Clause; additional bundled-component terms | `torch-2.4.1+cpu.dist-info/LICENSE`, `torch-2.4.1+cpu.dist-info/NOTICE` |
| `torchmetrics` | 1.5.2 | Apache-2.0 | `torchmetrics-1.5.2.dist-info/LICENSE` |
| `tqdm` | 4.70.1 | MPL-2.0 AND MIT | `tqdm-4.70.1.dist-info/licenses/LICENCE` |
| `transformers` | 4.46.3 | Apache-2.0 | `transformers-4.46.3.dist-info/LICENSE` |
| `typing-inspection` | 0.4.4 | MIT | `typing_inspection-0.4.4.dist-info/licenses/LICENSE` |
| `typing_extensions` | 4.16.0 | PSF-2.0 | `typing_extensions-4.16.0.dist-info/licenses/LICENSE` |
| `tzdata` | 2026.4 | Apache-2.0 | `tzdata-2026.4.dist-info/licenses/LICENSE`, `tzdata-2026.4.dist-info/licenses/licenses/LICENSE_APACHE` |
| `urllib3` | 2.8.0 | MIT | `urllib3-2.8.0.dist-info/licenses/LICENSE.txt` |
| `uvicorn` | 0.51.0 | BSD-3-Clause | `uvicorn-0.51.0.dist-info/licenses/LICENSE.md` |
| `yarl` | 1.25.1 | Apache-2.0 | `yarl-1.25.1.dist-info/licenses/LICENSE`, `yarl-1.25.1.dist-info/licenses/NOTICE` |

## External executables and reference resources

Cas-OFFinder 2.4.1 (commit
`9816b94c20c4cba2e79b039e1e2a6dee684b7b66`) is a separately provisioned search
executable. Its [upstream release](https://github.com/snugel/cas-offinder/tree/9816b94c20c4cba2e79b039e1e2a6dee684b7b66)
terms apply independently; it is not covered by OfftargetPred's MIT grant.
Reference genomes and annotation files are also provisioned separately and are
not included in this repository. Their source manifests and provider terms
must accompany any intended redistribution. This document does not grant
rights over them. See the [deployment guide](docs/deployment.md).

## Updating this inventory

At release time, regenerate the inventory from the exact frontend lock file
and installed Python environment, inspect licence changes and vendor notices,
and retain all required notices in the distributable artifact. This snapshot
does not resolve the supplied tokenizer, model or dataset permissions and does
not assert that a public source archive is ready for redistribution.
