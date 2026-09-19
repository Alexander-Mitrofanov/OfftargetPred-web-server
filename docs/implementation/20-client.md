# Improvement 20 — API client and local reproducibility package

## Delivered

- `client/offtargetpred_client.py`: dependency-free Python 3.12+ CLI/library for
  health/capabilities, one-shot submission, status, bounded polling, full JSON/CSV
  binary downloads, cancellation, deletion, recovery and reference helpers.
- Private 0600 credential files are reserved before submission, validated on
  reuse, bound to the exact API origin and refused if symlinked or group/world
  readable. No token CLI argument, printed submission token or redirect-following.
- HTTPS by default; a deliberate loopback-only HTTP option supports staging.
  HTTP 404 is actionable without distinguishing private job existence. Polling
  GETs honor numeric/date `Retry-After`; mutations are never automatically retried.
  Uncertain submissions retain a private pending marker and explain why retrying
  might duplicate work. Bounded request timeout, polling duration and downloads.
- `client/README.md` and synthetic `example-pairs.json` provide a complete submit,
  poll, download and deletion workflow. `docs/API.md` now documents reference
  tools, intended loci, optional result fields and browser-local export scope.
- `deploy/container/` contains an optional Linux amd64 CPU/pairs-only Dockerfile,
  Compose recipe and exact runtime version pins. Official Python base digest is
  recorded. Default-deny `.dockerignore` excludes private data, models and Git
  history. Models mount read-only into the unprivileged, networkless worker;
  the API binds host loopback. No image or model artifact was published.

## Verification

On the authorized VM, isolated from production:

```text
python -m pytest -q tests/test_client.py
31 passed in 0.19s
```

Coverage includes origin/header isolation, POST uncertainty and no retry,
redirect refusal, 0600/symlink checks, exact binary CSV/JSON preservation,
expiry, rate-limit waits, bounded polling, malformed/oversized responses,
recovery parsing and removal of incomplete downloads. A real read-only CLI
request to staging `http://127.0.0.1:8020/api/v1/health` returned worker available,
release `nar-v2-staging`, configured CUDA. GPU job smoke is left to the
coordinator's combined release acceptance to avoid competing measurement jobs.

The official Docker registry returned the Python 3.12.11 slim-bookworm index
digest `sha256:519591d6871b7bc437060736b9f7456b8731f1499a57e22e6c285135ae657bf7`.
The VM has neither Docker nor Podman. **Container build/runtime acceptance is
therefore pending**, clearly stated in its README; a working image, dependency
wheel hashes and built-image digest are not claimed. GPU and genome reproduction
continue to use the verified VM deployment. External checkpoint rights remain
unresolved and weights remain private. Galaxy is deferred until a concrete user
workflow justifies it; it is not required to use the published tool's web UI.

## Integration

The coordinator may link `client/README.md`, `client/offtargetpred_client.py` and
`docs/API.md` from the website. No shared API/frontend/package manifest edits
were required. If the reference-context helper is added later, extend the
client's explicit helper allowlist and API schema documentation at integration.
The source-version-labelled container should be built from a clean release
checkout, not the current uncommitted implementation workspace.

## Coordinator container and client acceptance

The coordinator installed Podman on the authorized VM after the initial worker
handoff. The optional image built successfully with `pip check` passing. Source
read permissions are set explicitly in the image so a private build checkout's
file modes cannot prevent the unprivileged runtime from importing code. The
fully qualified official image reference also avoids interactive registry choice.

The actual CPU container passed all 21 HTTP smoke checks, including real scores
from all three checkpoints, authorization, exports, cancellation and deletion.
The Python CLI then independently submitted, polled, downloaded JSON/CSV and
deleted a real job; capability and output files were 0600, the token was not
printed, and a subsequent status read returned404. Only temporary containers and
separate staging job storage were used. Containers were stopped and removed.

See `20-container-checks.json` for image/source fingerprints and exact limits.
This supersedes the earlier statement that no container engine was available.
Docker Compose orchestration remains untested; no image or weights were published.
