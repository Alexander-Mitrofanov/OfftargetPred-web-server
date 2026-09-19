# HTTP API

Base path: `/api/v1`. Production serves HTTPS through Tailscale Funnel. The API
itself listens only on `127.0.0.1:8010`. User-data responses use `no-store`.

## Availability and capabilities

- `GET /health`: version, immutable deployment release ID, configured compute
  device, worker heartbeat and availability. The API can be healthy while the
  worker is unavailable; check `worker.available`.
- `GET /capabilities`: available modes, models, genomes, limits and retention.
  Genome mode appears only when an executable and verified reference manifest
  are installed. The worker verifies the reference checksum before searching.

Model IDs in requests are integers `1`, `2`, `3`. Score keys in results are
`k1`, `k2`, `k3`. The default is model 1. Scores are uncalibrated positive-class
softmax values, not estimated cleavage frequencies.

## Submit

`POST /jobs`, `Content-Type: application/json`:

```json
{
  "mode": "pairs",
  "input": "id,target,off_target\nexample,AAAAAAAAAAAAAAAAAAAAAGG,AAAAAAAAAAAAAAAAAAAATGG\n",
  "format": "csv",
  "models": [1, 2, 3],
  "name": "Example"
}
```

The optional name has a 120-character maximum. `format` can be `csv`, `tsv` or
`text` for pair tables. Text tables still need headers; CSV or TSV delimiters
are recognized. Supported guide and candidate column aliases are documented in
the scientific input guide. All sequences must contain exactly 23 aligned
ACGTN bases including PAM; the entire request fails if any row is invalid.
No invalid rows are silently dropped.

Genome mode instead takes `mode: "genome"`, `assembly: "GRCh38"` and
`max_mismatches: 0..4`. Input is FASTA/plain text full 23-base guide-associated
target sequences, or a guide CSV/TSV. Genome search requires unambiguous ACGT
and NGG; it enumerates ungapped candidates then applies the selected models.

Initial limits: 5 MiB serialized JSON; 10,000 supplied pairs; 10 genome guides;
50,000 genome candidates; 10 queued jobs globally; one active job; one pending
or active job per client IP; 30 submissions per rolling hour. The same IP may
represent several users behind a shared network. Candidate and runtime limits
fail the job rather than returning incomplete scientific results.

Successful response, HTTP 202:

```json
{"id":"<uuid>","token":"<random capability>","status":"queued"}
```

The token is returned once. Send it as `Authorization: Bearer <token>` on every
job-specific request. Keep it out of URLs, logs and analytics. Anyone holding
the capability can access or delete that job. The frontend keeps it in browser
session storage; no public list of jobs exists.

## Job operations

| Method | Route | Result |
| --- | --- | --- |
| GET | `/jobs/{id}` | state, timestamps, mode, selected models, result count and safe error |
| GET | `/jobs/{id}/results` | paginated JSON rows and scientific metadata |
| GET | `/jobs/{id}/download` | all rows as CSV, fixed filename; `?format=json` includes rows and metadata |
| POST | `/jobs/{id}/cancel` | cancel a queued or running job |
| DELETE | `/jobs/{id}` | revoke access immediately and erase the job; HTTP 202 |

States are `queued`, `running`, `cancelling`, `completed`, `failed`, `cancelled`.
Deletion returns `deleting` until a running subprocess stops; access is revoked
immediately. Worker restarts fail interrupted jobs explicitly so they cannot
remain stuck as running. Completed and failed jobs expire 24 hours after
submission. Cleanup runs every 30 seconds while the supervisor runs.

Results support `offset` (default 0), `limit` (default 100, maximum 1000),
`q` (global case-insensitive search over identifiers, sequences and chromosome),
`sort` (`input`, `k1`, `k2`, `k3`, `mismatches`) and `order` (`asc` or `desc`).
Example response:

```json
{
  "total": 1,
  "unfiltered_total": 1,
  "offset": 0,
  "limit": 100,
  "rows": [{"id":"example", "target":"AAAAAAAAAAAAAAAAAAAAAGG", "off_target":"AAAAAAAAAAAAAAAAAAAATGG", "scores":{"k1":0.25}}],
  "metadata": {"calibrated":false, "release_id":"<release>"}
}
```

Genome rows also contain guide ID, chromosome, strand, zero-based half-open
start/end, assembly, mismatch counts and sequence annotations. Scores here are
illustrative. CSV neutralizes spreadsheet formulas in text fields by prefixing
an apostrophe when necessary.

## Errors and access policy

- 404: unknown/expired job, invalid/missing capability, or deleted job; these
  cases are deliberately indistinguishable.
- 409: results requested before completion.
- 413: serialized request too large.
- 415: request is not JSON.
- 422: invalid sequence, format, model, limit or pagination parameter.
- 429: queue/client/submission limit; honor `Retry-After`.
- 503: genome mode unavailable or disk reserve reached.

CORS allows only configured exact frontend origins. Browser submissions with an
unapproved Origin are rejected. A command-line client may omit Origin; CORS is
not authentication. Nginx obtains the real client address from Tailscale's
PROXY-v2 connection, overwrites forwarded address headers, and forwards only
from loopback. Never run this proxy-trusting API on a public socket.

Neither submitted sequences nor bearer tokens should be logged. Preserve
private directory permissions and the persistent queue on the attached volume.
