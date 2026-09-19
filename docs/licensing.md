# Licence, attribution, citation and support

Reviewed 19 September 2026. OfftargetPred is a web interface to the published
CRISPert method, using the three supplied, unchanged sequence-only CRISPert-small
checkpoints. The service is free to access and does not require an account.

## Code licence and its limits

The project owner selected the **MIT licence for code they own**. The
[licence](../LICENSE) grants those rights for original OfftargetPred code and
documentation, with copyright `2026 OfftargetPred contributors`. Copies or
substantial portions of that code must retain the copyright and permission
notice. Scientific citation is requested for attribution; it is not an added
condition on the MIT grant.

**This is not a blanket licence for every file, dependency or model used by the
service.** The following have separate status:

| Material                                                        | Status and attribution                                                                                                                                    |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Original OfftargetPred code and documentation                   | MIT, subject to the exclusions in [LICENSE](../LICENSE)                                                                                                   |
| `backend/offtargetpred/tokenizer.py`                            | Unchanged copy from supplied `crispert_small/tokenizer.py`; upstream redistribution permission has not been verified; excluded from the project MIT grant |
| Supplied model weights, training/evaluation data and manuscript | Not distributed by this repository; owner permissions remain unresolved; no MIT grant is made                                                             |
| Published CRISPert paper                                        | Cite the authors and publisher DOI below; the project does not relicense the paper                                                                        |
| CFD parameter tables from crisprScore                           | Separate MIT grant, Copyright (c) 2022, Genentech, Inc.; original notice retained with the resources                                                      |
| Installed software, reference genomes and annotations           | Their own licences and source terms apply; see the [third-party notices](../THIRD_PARTY_NOTICES.md) and source manifests                                  |
| User submissions                                                | The code licence does not grant rights over submitted sequences, observations or other user data                                                          |

The tokenizer's SHA-256 is
`b15aae904e073d53d0c878199a3a04e2eeccb81faeb3e11738dc00bc282cb2e2`.
It is kept unchanged for inference parity. Recording its source and excluding it
from MIT does not supply missing permission. Resolve its distribution rights
before preparing a redistribution archive that contains it. Do not add weights,
datasets, the supplied manuscript, or other unresolved upstream material to an
archive on the strength of the project's MIT licence.

The [provenance guide](science/README.md), [model card](model-card.md), and
[CFD provenance](../backend/offtargetpred/resources/cfd/provenance.json) record
the scientific scope and evidence behind these distinctions. Free access to
the service does not resolve upstream redistribution rights.

## How to cite

Cite the base method when using CRISPert predictions:

> William Jobson Pargeter, Rolf Backofen and Van Dinh Tran (2024).
> CRISPert: A Transformer-Based Model for CRISPR-Cas Off-Target Prediction.
> ECML PKDD, pp. 92–104.
> [doi:10.1007/978-3-031-70368-3_6](https://link.springer.com/chapter/10.1007/978-3-031-70368-3_6).

Also identify the web interface and the exact implementation used:

> OfftargetPred contributors (2026). OfftargetPred: a web interface to
> sequence-only CRISPert-small models. Version 0.2.0 (19 September 2026).
> [Source repository](https://github.com/Alexander-Mitrofanov/OfftargetPred-web-server).

Add the actual release or Git commit, checkpoint hashes and analysis settings
from your run. Version **0.2.0** identifies this web-interface release;
it does not identify a newly trained model or an archival deposit.
No software DOI or Zenodo deposit exists in this record. The DOI above identifies
the CRISPert paper only. The paper's benchmark or optional-feature results do
not automatically describe these exact four-layer sequence-only checkpoints.

[CITATION.cff](../CITATION.cff) provides machine-readable software attribution
and the separate paper reference, following the
[Citation File Format](https://citation-file-format.github.io/). The website
provides citation copy/download controls. The contributor group credits the
software project; manuscript authors and affiliations must be supplied separately.

For CFD results, also cite Doench et al. (2016), _Optimized sgRNA design to
maximize activity and minimize off-target effects of CRISPR-Cas9_, Nature
Biotechnology 34:184–191,
[doi:10.1038/nbt.3437](https://doi.org/10.1038/nbt.3437). Parameter source and
licensing are recorded separately in the CFD provenance file.

## Maintenance and support

The public maintainer contact is the repository account
[Alexander-Mitrofanov](https://github.com/Alexander-Mitrofanov). Report software
problems or request help through
[repository issues](https://github.com/Alexander-Mitrofanov/OfftargetPred-web-server/issues).
Include a brief description, software version and a minimal non-sensitive
example where possible. GitHub issues are public: do not include private job
links, job tokens, confidential sequences or personal data. No issue is created
automatically and the service does not send submissions to GitHub.

No institutional maintenance commitment, fixed response time, or multi-year
availability promise is asserted. A public issue route is not a private support
channel. Current service operation and expiry behavior are described in the
[API documentation](API.md) and [deployment guide](deployment.md).

## Release and archive checklist

This checklist describes remaining release work; it does not claim that a
release, DOI reservation or archive deposit has happened.

- [ ] Resolve the supplied tokenizer's redistribution permission and retain its
      required attribution; review any other copied upstream source.
- [ ] Review the ownership and inclusion of every archive artifact. Keep private
      models, datasets and manuscript excluded unless their owners separately
      authorize distribution and supply applicable terms.
- [ ] Refresh dependency inventories from the actual locked release/build
      environment, including all licence/NOTICE files and binary-vendor notices.
- [ ] Have the maintainer review contributor attribution and citation metadata.
      Set the real release version, date and commit only when the release exists;
      synchronize package metadata, website citation, changelog and `CITATION.cff`.
- [ ] Run the documented checks and preserve checkpoint/reference manifests,
      relevant validation evidence and the release source commit.
- [ ] Prepare a reviewed, minimal archive of distributable code and metadata.
      Obtain authorization from the responsible owner before any archive deposit;
      author permission for an archive has not been provided here.
- [ ] After an authorized archive is actually published, verify the assigned
      software DOI and add it to citation and release records. Keep the CRISPert
      paper DOI separate from the software DOI.
