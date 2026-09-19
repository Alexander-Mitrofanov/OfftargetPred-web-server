# Deployment council — 19 September 2026

## Evidence inspected

- CasAndra's active standalone guide and Nginx/systemd definitions in
  `/home/alex/CodexProjects/CasAndraProject/web-server`.
- Supplied model package README, dependency list and evaluation entry point.
- Read-only SSH to the CRISPert VM through the existing de.NBI jumphost.

The VM is Ubuntu 24.04.3, kernel `6.8.0-87-generic`, 12 virtual CPUs and 58 GiB
RAM. `/dev/vda1` has 27 GiB free. The ext4 data volume `/dev/vdb` is mounted at
`/srv/crispert` with about 954 GiB available. No NVIDIA driver, Nginx or Tailscale
is installed. `systemd-timesyncd` is active, but its clock is not synchronized.
No remote changes were made by this council investigation.

## Proposed production layout

```text
GitHub Pages: static application, exact allowed CORS origin
       |
       | HTTPS + per-job bearer capability
       v
Tailscale Funnel: public HTTPS, TLS termination on the VM
       |
       | loopback TCP + PROXY protocol v2 (real client IP)
       v
Nginx 127.0.0.1:8082: bounded uploads/rates, no sequence or token logs
       |
       v
API 127.0.0.1:8010: validate, enqueue, authorize, serve results
       |
       v
SQLite WAL + job directories on /srv/crispert
       |
       v
one scientific worker: all three immutable local checkpoints, V100
```

Use a dedicated unprivileged account and systemd services. Keep runtime,
model checkpoints, wheel cache and all jobs on the attached volume. Place
configuration under `/etc/offtarget-web`, preserve it during upgrades and never
include secrets in the repository. The initial checked-in package should be
organized as `backend/`, `frontend/`, `deploy/`, `docs/`, `tests/`, and `examples/`;
retain the original model bundle privately and stage runtime inputs separately.
Create versioned release directories with a `current` symlink and a manifest of
source/checkpoint SHA-256 values. Include the release identifier in API health
and result metadata. Rollback must not delete queued jobs or change model
identities silently.

## Runtime and V100

Do not install a floating latest CUDA stack. V100 is Volta; CUDA 13 removed
offline compilation and library support for Volta. Use a CUDA 12.x PyTorch
build, initially the package's tested PyTorch 2.4.1 CUDA 12.1 wheel, then verify
`torch.cuda.is_available()`, GPU name and a real forward pass.
[NVIDIA CUDA release notes](https://docs.nvidia.com/cuda/archive/13.0.2/cuda-toolkit-release-notes/index.html)
and [PyTorch previous versions](https://docs.pytorch.org/get-started/previous-versions/).

Use a supported **proprietary** NVIDIA server driver (R580 package if available
in this Ubuntu archive), not the open GPU kernel modules that exclude Volta.
Record the installed package and driver versions. The CUDA version displayed by
`nvidia-smi` describes driver capability; validate the actual torch CUDA runtime
separately. No full CUDA toolkit is needed for prebuilt PyTorch wheels.

Science council confirms production inference can omit Lightning, pandas and
scikit-learn: load trusted checkpoint tensors with `weights_only=True`, strip
the exact `model.` prefix, construct the supplied BERT architecture and strict
load its state dictionary. Production dependencies can be torch, transformers,
NumPy and PyYAML plus the API framework. Keep Lightning only in the parity test
environment. This avoids the supplied Python-3.8-era NumPy/pandas pins that do
not install unchanged on Ubuntu's Python 3.12.

Never deserialize user-uploaded models, accept user-supplied filesystem paths,
or fetch model code from the internet during requests. All three models are
small, so CPU operation remains a useful diagnosed fallback, not an excuse to
silently report GPU execution when the driver is unavailable. Run ordinary
float32 inference first; do not introduce mixed precision before parity checks.

## Public API, privacy and fairness

Recommended initial limits, to adjust after representative measurement:

| Item | Starting policy |
| --- | --- |
| Request | 10,000 pair rows and 5 MiB serialized body |
| Inputs | exact 23 nt ACGTN, including PAM, no silent drops |
| Queue | one active job, at most 10 queued globally |
| Per client | one pending/active job, 30 submissions/hour |
| Inference | bounded batches, at most 4 CPU threads, 15-minute timeout |
| API cgroup | 1 CPU, 1 GiB hard RAM |
| Worker cgroup | 8 CPUs, 16 GiB hard RAM; one V100 process |
| Retention | delete inputs/results after 24 h; user deletion available |
| Disk reserve | reject new submissions under 20 GiB free |

Generate a cryptographically random bearer capability per submitted job, return
it once and store only a verifier hash. Require it on job status, results,
download and deletion. UUIDs alone are not authorization. Keep capabilities out
of query strings, URLs, access logs and error reports. No account/login system
is required for anonymous research scoring, but per-job authorization is.
CORS should allow only the exact GitHub Pages origin; it is browser policy,
not an authentication mechanism. Nginx must overwrite forwarded client headers
from PROXY protocol and the API must trust only its local proxy.

Use `Cache-Control: no-store` for all user data, no analytics, no captured
sequences/labels in logs, fixed downloadable filenames, and CSV formula
neutralization for uploaded identifiers. Do not expose filesystem paths,
tracebacks, environment values, queue contents or other users' jobs publicly.
Job states need atomic transitions, crash recovery, cancellation and cleanup
that cannot race a running worker. Restarted jobs must either be safely
requeued or explicitly failed, never permanently left as running.

Nginx and API bind only loopback. The API can use `PrivateDevices=yes`; the GPU
worker cannot copy that restriction unchanged from CasAndra, because NVIDIA
device nodes must remain visible. Restrict GPU worker device access explicitly
where practical, leave only job/temp storage writable, and prevent worker
outbound networking once scientific inputs are local. No external IP listener
is needed beyond the existing SSH route and Tailscale-managed transport.

## Authentication and external dependencies

Tailscale is not currently installed/authenticated on this VM. Preparing and
testing the API can proceed independently. Public publication will require a
user-authorized Tailscale login or an already authorized device credential;
never borrow another server's node state or private identity. The operator
may also need to authorize Funnel in the tailnet policy. Official requirements
include MagicDNS, HTTPS and the Funnel node attribute.
[Tailscale Funnel requirements](https://tailscale.com/docs/features/tailscale-funnel).

Match CasAndra's transport command after authentication:

```bash
sudo tailscale funnel --bg --yes --proxy-protocol=2 \
  --tls-terminated-tcp=443 tcp://127.0.0.1:8082
```

[Tailscale CLI reference](https://tailscale.com/docs/reference/tailscale-cli/funnel).
The floating IP `172.16.61.196` is private and is not a browser-facing API URL.
Set the Pages deployment variable to the verified HTTPS Funnel origin, rebuild
and perform a real browser submission/download from the deployed Pages site.

## Implementation and release gates

1. Complete scientific parity, input policy and API contract.
2. Implement bounded queue, worker, authorization and static frontend.
3. Run unit/integration tests covering invalid input, unauthorized reads,
   wrong-origin browser calls, all models, downloads, deletion and restarts.
4. Build reproducible installers, pinned requirements, service definitions,
   Nginx configuration, verification and rollback instructions.
5. Install narrowly scoped prerequisite packages/driver, fix NTP reachability,
   stage the application and checkpoints, verify private CPU/GPU inference.
   If reboot is needed, verify the data mount and all services afterwards.
6. Authenticate Tailscale, expose only the loopback edge, configure Pages and
   test the complete public workflow.
7. Document operational limits, deployment identity, scientific limitations,
   retention and any remaining user action accurately.

### Council reconciliation: optional genome candidate discovery

The parent is investigating Cas-OFFinder 2.4 with an immutable GRCh38 primary
assembly (NGG, up to four mismatches, no bulges) in addition to supplied-pair
scoring. This is a separate workload: give discovery its own maximum guides,
candidate output count/bytes, longer bounded timeout and queue policy rather
than applying the 10,000-row pair limits blindly. Cache the fixed reference on
the data volume and record download URL, assembly release and checksum.
Expose supported modes/genomes and actual per-mode limits via `/capabilities`;
the frontend must not advertise discovery before the reference and executable
pass verification.

Cas-OFFinder uses OpenCL, so a working CUDA torch forward pass does not verify
its accelerator path. Inspect the installed NVIDIA OpenCL ICD and execute
Cas-OFFinder's own device discovery and a small known-answer search. A PoCL CPU
OpenCL platform is a possible explicit fallback, but must be benchmarked on
the full reference before public admission limits are chosen. Keep this
dependency optional until candidate enumeration parity and bounded resource
behavior are demonstrated. These discovery details remain proposals, not
claims of installed functionality.

The earlier combined OS-upgrade/install action was rejected by automatic
approval review. The current instruction explicitly requests implementation;
the parent should submit specific, reviewable deployment actions using that
authorization rather than repeating an unrelated broad OS upgrade. If a
particular action is rejected again, retain private/local progress and report
the exact rejected action and reason. Interactive Tailscale authentication is
an actual external dependency, not permission to copy existing credentials.
