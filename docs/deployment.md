# Deployment and operations

## Architecture

```text
GitHub Pages static frontend
    HTTPS + Authorization bearer capability
Tailscale Funnel (public TLS endpoint)
    PROXY protocol v2 over loopback
Nginx 127.0.0.1:8082
    HTTP over loopback, trusted client address
API 127.0.0.1:8010  —  SQLite queue and private job directories
    one supervised worker / one job at a time
CRISPert-small FP32 on V100 + Cas-OFFinder OpenCL
```

Only the frontend and service API are public. User data, model weights and the
human reference never go to GitHub Pages. No application port listens on the
VM's non-loopback interface. Tailscale terminates TLS and passes PROXY-v2 so
admission limits use the original client's address. This is the CasAndra
transport arrangement, on its own VM and hostname.

## Host and storage

Ubuntu 24.04 / Python 3.12; NVIDIA Tesla V100 16 GiB, 12 vCPUs, about 60 GiB RAM.
The 30 GiB boot disk holds Ubuntu. A separate 970 GiB ext4 volume is mounted by
UUID at `/srv/crispert`; both services require that mount. Models, reference,
runtime and private data reside on it:

```text
/srv/crispert/releases/REVISION/    root-owned application source
/srv/crispert/current              symlink to active release
/srv/crispert/venv/                Python/CUDA runtime
/srv/crispert/models/k{1,2,3}/      verified model.ckpt files
/srv/crispert/references/GRCh38/    fixed FASTA + reference.json
/srv/crispert/bin/cas-offinder     pinned executable
/srv/crispert/data/                private SQLite queue and job directories
/srv/crispert/tmp/                 worker caches
/srv/crispert/nginx-body/          private transient upload bodies
```

SSH uses the existing de.NBI jumphost and administrator key. Keep SSH keys,
tailnet credentials and job links out of Git and logs. Do not expose the API or
Nginx ports directly. The floating IP from the `public` pool is a private campus
address and is not the Internet HTTPS endpoint.

## Runtime provisioning

The V100 uses NVIDIA's **proprietary 580 server driver**. Open kernel modules
exclude Volta. Use the pinned PyTorch CUDA 12.1 wheel; CUDA 13 libraries dropped
Volta support. `nvidia-smi`'s displayed CUDA version is driver capability, not
the application's CUDA runtime.

```bash
sudo apt-get update
sudo apt-get install --no-install-recommends nvidia-headless-580-server \
  nvidia-utils-580-server python3-venv nginx ocl-icd-opencl-dev clinfo cmake g++
sudo modprobe nvidia
nvidia-smi
clinfo -l
python3 -m venv /srv/crispert/venv
/srv/crispert/venv/bin/python -m pip install torch==2.4.1 \
  --index-url https://download.pytorch.org/whl/cu121
/srv/crispert/venv/bin/python -m pip install transformers==4.46.3 numpy==1.26.4 \
  PyYAML==6.0.3 fastapi==0.139.2 uvicorn==0.51.0
```

Install Tailscale using its [signed Ubuntu 24.04 repository](https://pkgs.tailscale.com/stable/).
Sign in with the owner's tailnet; never copy another node's identity or state.
Use `--accept-dns=false` to preserve the site's DNS settings. Account authentication
and tailnet permission for Funnel are required before public activation.

## Model and reference installation

Copy only `models/k1/model.ckpt`, `models/k2/model.ckpt`, and
`models/k3/model.ckpt` from the supplied bundle into `/srv/crispert/models`.
The adapter checks their hard-coded SHA-256 and exact model geometry before use.
No checkpoints are accepted through the public API. There is no runtime model
download or user-supplied executable code.

Pin Cas-OFFinder to **2.4.1**, commit
`9816b94c20c4cba2e79b039e1e2a6dee684b7b66` from
[the upstream repository](https://github.com/snugel/cas-offinder).
Build with CMake/OpenCL and install at `/srv/crispert/bin/cas-offinder`.
The source archive used here has SHA-256
`7417f3d042b59acddbf93905bd366ee9d34020a24b6e5f3dee0c509768c700ee`.

The human reference is the **Ensembl release 115 GRCh38 primary assembly**.
Download the URL fixed in `deploy/prepare-reference.py`. Its publisher's BSD
checksum is `22450 861294`; the script additionally pins the downloaded archive
SHA-256, checks expansion and records the uncompressed checksum and base count.

```bash
python3 deploy/prepare-reference.py /path/to/Homo_sapiens.GRCh38.dna.primary_assembly.fa.gz \
  /srv/crispert/references/GRCh38
```

The installed reference contains 194 contigs / 3,099,750,718 bases. Uncompressed
FASTA SHA-256: `1e74081a49ceb9739cc14c812fbb8b3db978eb80ba8e5350beb80d8ad8dfef3b`.
Search verifies the actual FASTA on each job and passes this exact file to the
search engine. Coordinate starts are zero-based on the forward reference,
end-exclusive; candidate sequences are already oriented with the query.

## Stage and activate

Create a versioned release with `backend/`, `deploy/`, `pyproject.toml`, and the
model manifest; record its Git revision. Verify the actual GPU and synthetic
search before publishing (commands below). Then:

```bash
sudo bash /srv/crispert/releases/REVISION/deploy/install-service.sh \
  /srv/crispert/releases/REVISION REVISION
```

The installer creates a dedicated unprivileged service account, root-owned
software, private job storage, hardened systemd units and the loopback Nginx
configuration. It preserves the existing environment file on subsequent runs.
API memory is bounded at 2 GiB; worker at 32 GiB, without swap; one worker holds
an exclusive lock. Each job runs in a cancellable subprocess and is limited to
15 minutes. Worker networking is disabled, but GPU device access remains enabled.
Nginx bounds uploads and connections and stores transient bodies on the data
volume. Access logs are disabled. Never enable debug/body/authorization logging.

After all private tests pass, enable public transport:

```bash
sudo tailscale up --hostname=offtargetpred-web --operator=ubuntu --accept-dns=false
sudo tailscale funnel --bg --yes --proxy-protocol=2 \
  --tls-terminated-tcp=443 tcp://127.0.0.1:8082
tailscale funnel status
```

## GitHub Pages

Repository: `Alexander-Mitrofanov/OfftargetPred-web-server`.
Set repository variable **OFFTARGET_API_ORIGIN** to the exact public HTTPS
origin from Funnel (no path or trailing slash). Enable Pages with GitHub Actions
as its source, then run **Deploy GitHub Pages**. The workflow will not publish
without an API origin. The frontend is built for `/OfftargetPred-web-server/`.
The backend CORS origin is `https://alexander-mitrofanov.github.io`—origins do
not include repository paths.

## Verification

```bash
python -m pytest -q
PYTHONPATH=backend python tests/integration_search.py \
  --binary /srv/crispert/bin/cas-offinder --device G0
python tests/smoke_api.py --api-origin http://127.0.0.1:8010 \
  --origin https://alexander-mitrofanov.github.io
python tests/smoke_api.py --api-origin https://ACTUAL-FUNNEL-HOST \
  --origin https://alexander-mitrofanov.github.io
```

Public CI runs contract tests without private weights. Operator acceptance must
also run the real model tests, original-framework parity and held-out benchmark,
GPU/CPU parity, synthetic Cas-OFFinder oracle and a real GRCh38 search. Check
the deployed browser's form, private result recovery, CSV/JSON downloads and
mobile layout. Test again after reboot to verify storage, GPU and service startup.

## Privacy, limits and maintenance

The API accepts at most 5 MiB, 10,000 supplied pairs or 10 guides. Search permits
0–4 mismatches and a maximum of 50,000 candidates; overflow fails visibly, with
no misleading partial result. One job per client can be pending; queue size is
10 and each client can submit at most 30 jobs/hour. 20 GiB free space is reserved.

Jobs expire after 24 hours from submission; the worker removes expired payloads
and stale orphan directories. Capability hashes and salted client hashes are
stored in the private database. Clients are never stored as plaintext IPs.
Cancellation terminates the job process group. Deletion immediately revokes its
capability and removes files once active work stops. A supervisor restart marks
interrupted jobs failed instead of duplicating them.

Inspect service state with `systemctl status offtarget-api offtarget-worker`;
use `/api/v1/health` for worker readiness and release ID. Monitor disk capacity,
GPU health, time synchronization and failed services. Do not retain user payloads
in backups beyond the stated retention. Preserve source, models and reference
manifests separately from ephemeral jobs.

Rollback: stop API/worker, point `/srv/crispert/current` at a previously verified
release, update `OFFTARGET_RELEASE_ID`, restart and repeat smoke checks. Review
database compatibility before rolling back across schema changes. Do not delete
the data volume, queue or model files during upgrades.
