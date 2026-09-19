# Python reference client

This optional, single-file Python 3.12+ client uses only the standard library.
The [web interface](https://alexander-mitrofanov.github.io/OfftargetPred-web-server/)
requires no local software. This client is useful for reproducible scripts and
downloading complete results. See the [HTTP API](../docs/API.md) for the schema.

## One complete analysis

Run from the repository root on Linux/macOS. Use a private working directory
outside the repository for credentials, input sequences and results:

```bash
umask 077
mkdir -m 700 "$HOME/offtargetpred-private"
python3 client/offtargetpred_client.py health
python3 client/offtargetpred_client.py submit client/example-pairs.json \
  --credentials "$HOME/offtargetpred-private/example-access.json"
python3 client/offtargetpred_client.py poll \
  --credentials "$HOME/offtargetpred-private/example-access.json" --max-wait 1000
python3 client/offtargetpred_client.py download --format json \
  --credentials "$HOME/offtargetpred-private/example-access.json" \
  --output "$HOME/offtargetpred-private/example-results.json"
python3 client/offtargetpred_client.py download --format csv \
  --credentials "$HOME/offtargetpred-private/example-access.json" \
  --output "$HOME/offtargetpred-private/example-results.csv"
python3 client/offtargetpred_client.py delete \
  --credentials "$HOME/offtargetpred-private/example-access.json"
```

Replace the supplied synthetic example with your own JSON request file. No token
is printed or accepted as a command-line argument. Submission creates a new
0600 credentials file and refuses to overwrite existing files. Downloads preserve
the server's exact UTF-8 bytes and also create 0600 files without overwriting.
The JSON download contains the complete rows and provenance; CSV contains the
full table. Browser-only selections, notes and imported assay evidence are
exported using the web interface's analysis bundle, not this server download.

`status` prints one read; `poll` waits for a terminal state; `cancel` stops queued
or running work; `delete` revokes access immediately and requests erasure. All
four take the same `--credentials` argument. `poll` returns nonzero on a failed
or cancelled job. Stopping the client or hitting its time limit leaves the job
running, so the same saved access file can be reused later. A completed result
must be downloaded before the 24-hour expiry measured from submission.

## Recovery, limits and failures

To recover a job from the browser's private recovery link:

```bash
python3 client/offtargetpred_client.py recover \
  --credentials "$HOME/offtargetpred-private/recovered-access.json"
```

Paste the link at the hidden interactive prompt. Do not paste it into shell
arguments, tickets, Git, logs or notebooks. The fragment is parsed locally and
is never requested as a URL. Recovery does not contact the frontend. It does not
extend retention or recover a lost capability. For a different service, supply
its `--api` origin explicitly before `recover`; the link's frontend hostname
does not determine the API origin. `status` verifies the recovered access.

The client uses HTTPS, refuses redirects (including same-host redirects), binds
saved credentials to their exact API origin, uses a 30-second request timeout,
and bounds downloads to 256 MiB. `--timeout SECONDS` can raise individual request
timeouts up to 120 seconds. Polling defaults to 3 seconds and stops after 1,000
seconds; `--max-wait` can be at most 86,400 seconds. A 429 response exposes
`Retry-After` in the Python API. Polling GETs honor it automatically; mutation
requests are never retried. HTTP 404 intentionally combines expired, deleted,
unknown and invalid-access cases.

A failed submission may already have reached the server. The credentials file
is reserved **before** submission and stays marked `pending` if a response was
not safely saved. Do not retry an uncertain submission automatically: the API
has no idempotency key or account-based job lookup. A missing capability cannot
be reconstructed; orphan jobs expire normally. For a definite HTTP rejection
(for example 422), correct the input and choose a new credentials filename for
an explicit new attempt. A definite 429 requires waiting for `Retry-After`.

For a local development service only:

```bash
python3 client/offtargetpred_client.py --api http://127.0.0.1:8020 \
  --allow-local-http capabilities
```

`--allow-local-http` is required on subsequent operations using saved HTTP
credentials too. It permits only loopback IPs or `localhost`. The client accepts
an API **origin**, not `/api/v1`; it adds the API path itself. Native Windows ACL
handling is not implemented; use Linux/macOS or WSL for the enforced POSIX private
file permissions.

## Reference helpers and Python use

The `reference` command sends one bounded helper request from a JSON file:

```bash
python3 client/offtargetpred_client.py reference discover-genes gene-request.json
python3 client/offtargetpred_client.py reference discover-guides interval-request.json
python3 client/offtargetpred_client.py reference resolve-guide spacer-request.json
```

Request schemas, exact coordinates and helper limits are documented in the
[API reference](../docs/API.md#reference-helpers). These requests resolve only
the service's pinned reference; no third-party sequence service is contacted.
Check `/capabilities` before use and explicitly select the intended locus.

For Python scripts, import the adjacent module and keep credentials in memory
or a private file. Do not print the `load_credentials()` result:

```python
from pathlib import Path
from offtargetpred_client import Client, load_credentials

credentials = load_credentials(Path("/private/directory/access.json"))
client = Client(credentials["api_origin"])
state = client.poll(credentials, max_wait=1000)
if state["status"] == "completed":
    with Path("/private/directory/results.json").open("xb") as destination:
        client.job(credentials, "download", format="json", sink=destination)
```

Set `umask 077` for programmatic file creation too, or use the module's
`private_create(Path(...))` helper. `APIError.status` and `.retry_after` are safe
structured fields. Do not substitute raw transport logging; it could expose
the Authorization header. The client sends no analytics and makes no automatic
remote calls beyond the selected API. For an optional locally mounted model
runtime, see the [CPU package recipe and verification status](../deploy/container/README.md).
