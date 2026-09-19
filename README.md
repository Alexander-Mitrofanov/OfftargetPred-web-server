# OfftargetPred

A CRISPR off-target prediction web server using three supplied, sequence-only
CRISPert-small models. Its workflow is inspired by
[CRISPRoff](https://rth.dk/resources/crispr/crisproff/); its deployment follows
the CasAndra pattern: **GitHub Pages frontend + de.NBI backend**.

## What it does

- **Score candidate pairs:** paste or upload CSV/TSV containing aligned 23-base
  guide and candidate DNA sequences, including PAMs.
- **Discover candidates:** search human GRCh38 primary assembly for NGG sites
  within 0–4 protospacer mismatches, then score those sites. This mode requires
  the verified reference and Cas-OFFinder installation.
- Choose **k=1, k=2 or k=3**, or compare them separately. k=1 is the default.
- Inspect highlighted mismatches, sort/filter results and download predictions.
- Recover a job through its private link, cancel work or delete results.

Scores are uncalibrated positive-class softmax outputs, **not measured cleavage
frequencies, clinical safety assessments or CRISPRoff specificity scores**.
CasKAS/epigenetic features are neither requested nor used. There is no retraining.
Search does not include bulges, non-NGG PAMs, alternate haplotypes or individual
variants. Perfect protospacer matches remain visible; a unique on-target locus
is not inferred.

## Layout

```text
backend/offtargetpred/   inference, validation, search, API and durable job worker
frontend/               accessible React/TypeScript static application
deploy/                 systemd, Nginx, reference preparation and deployment
docs/                   model card, API, operations, council and validation
tests/                  scientific, API, queue and integration checks
models.manifest.json    exact identities of the three model checkpoints
Model/crispert_share/   original private input bundle (not tracked or published)
```

Model weights, training/evaluation data, the supplied manuscript, reference
genomes, environments and user jobs are intentionally excluded from Git. The
original bundle is retained unchanged in the local workspace.

## Development

Python 3.12 and Node.js 22+ are supported. Create an isolated environment and
install the CPU PyTorch wheel before the application:

```bash
python3 -m venv .venv
.venv/bin/python -m pip install torch==2.4.1 --index-url https://download.pytorch.org/whl/cpu
.venv/bin/python -m pip install -e '.[test,reference]'
.venv/bin/pytest -q
```

Run the API and worker in separate terminals with the same settings:

```bash
export OFFTARGET_DATA_DIR="$PWD/tmp/dev-data"
export OFFTARGET_MODEL_DIR="$PWD/Model/crispert_share/models"
export OFFTARGET_DEVICE=cpu
export OFFTARGET_ALLOWED_ORIGINS=http://localhost:5173
python -m offtargetpred.api
# In another terminal with the same environment:
python -m offtargetpred.worker
```

Then run the frontend:

```bash
cd frontend
npm ci
VITE_API_URL=http://localhost:8010 npm run dev
```

The full model tests require the original supplied `Model/crispert_share/`
bundle at that location. Public CI runs `pytest -m 'not model'` without private
weights. `OFFTARGET_MODEL_DIR` configures the application runtime.

No genome selector is enabled until a verified reference is configured. Read
[deployment](docs/deployment.md) to enable it and set up the production server.

## Documentation and scientific evidence

- [Model card](docs/model-card.md): architecture, limitations, checkpoint identity.
- [API](docs/API.md): requests, private job authorization and lifecycle.
- [Deployment](docs/deployment.md): provisioning, releases, Pages and operations.
- [Council decision](docs/council/decision.md): scope and implementation reasoning.
- [Validation and launch status](docs/validation/README.md): measured checks and
  remaining public activation steps.
- [Measured model benchmark](docs/validation/model-benchmark.json): exact supplied
  checkpoint performance on the held-out K562 set.

The manuscript supplied with the models describes an older 12-layer architecture
and experiments involving CasKAS. This service uses the supplied four-layer small
models. Paper headline metrics must not be treated as measurements of this service.

## Data handling

Jobs are private capabilities: keep the full result link confidential. The
capability is stored in the link fragment and sent to the API as a bearer header;
only its hash is stored server-side. Inputs and results expire 24 hours after
submission. Deletion revokes access immediately and cancels running work.
There are no email notifications, analytics, third-party sequence submissions or
public job listings. See the API and deployment documentation for resource limits.
