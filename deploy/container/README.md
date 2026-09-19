# Optional local CPU package

The browser service requires no installation. This recipe is for owners of the
three authorized checkpoints who want to reproduce **supplied-pair scoring** on
Linux amd64. Models and datasets are not distributed in the image or repository.
The tested production deployment remains [the VM/systemd setup](../../docs/deployment.md).

## Verification status

The base image digest was resolved from Docker's official registry on 19 September
2026. Python 3.12 and every runtime dependency are version-pinned; the model code,
tokenizer and expected checkpoint checksums are the same as the VM. CPU and GPU
scores can differ slightly: see [numerical validation](../../docs/validation/README.md).

The coordinator subsequently installed Podman on the de.NBI VM and built this
recipe successfully. `pip check` passed. An unprivileged, read-only CPU API/worker
pair passed 21 real HTTP acceptance checks with all three models, plus the Python
client's complete submission/download/deletion workflow. The worker had no
network and the API bound only to a separate loopback test port. Test containers
were stopped and removed afterwards.

[Container evidence](../../docs/implementation/20-container-checks.json) records
the tested local image ID and exact source fingerprints. This verifies the staged
CPU/pairs image under Podman; Docker Compose orchestration and a published release
image are not claimed. Package versions are pinned, but dependency wheel hashes
are not locked. Re-run the acceptance checks for each new release image.

## Build and run (operator acceptance procedure)

From a clean checkout of the revision being tested, with Docker Compose available:

```bash
export OFFTARGET_SOURCE_REVISION="$(git rev-parse HEAD)"
export OFFTARGET_MODELS=/absolute/private/models
cd deploy/container
docker compose build --pull api
docker compose up -d
```

`OFFTARGET_MODELS` must contain `k1/model.ckpt`, `k2/model.ckpt`, and `k3/model.ckpt`.
The files must be readable by container UID 10001 and are mounted read-only into
the worker. Never put them into the build context or an image. Access rights for
these upstream weights remain separate from the project's MIT licence.

The image runs as UID 10001 with a read-only root filesystem. A private named
volume holds jobs; the worker has no network. The API is bound to host loopback
only. Do not expose it publicly or add a proxy without following the production
deployment's transport and client-IP controls. Reserve at least 20 GiB of free
space on the filesystem holding the job volume; the service otherwise refuses
new submissions. Jobs expire after 24 hours. Stopping containers does not delete
the volume. `docker compose down` stops them without erasing it.

From the repository root, check readiness:

```bash
python3 client/offtargetpred_client.py --api http://127.0.0.1:8010 --allow-local-http health
python3 client/offtargetpred_client.py --api http://127.0.0.1:8010 --allow-local-http capabilities
```

Then follow the [client example](../../client/README.md), adding the local API
arguments before every subcommand and selecting all three models in the request.
Confirm `worker.available`, completed rows with three finite separate scores,
JSON/CSV parity, cancellation, deletion, and 404 after deletion. Compare the
known pairs against the frozen VM outputs with the documented CPU/GPU tolerance.
Record the source revision, built image digest, `pip check`, model SHA-256 values
and smoke results in release evidence before calling the image verified.

This bounded package does not install Cas-OFFinder, a human reference, annotations
or GPU drivers. Its advertised capabilities therefore include pairs only. Genome
search and reference helper reproduction use the documented VM installation;
adding them to a container requires separate resource/runtime acceptance. Galaxy
integration is deferred until there is a concrete user workflow to support.
