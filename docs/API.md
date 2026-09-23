# HTTP API

Base path: `/api/v1`. Production serves HTTPS through Tailscale Funnel. The API
itself listens only on `127.0.0.1:8010`. User-data responses use `no-store`.

API origin: `https://offtargetpred-web.tail58d78e.ts.net`.
The dependency-free [Python reference client](../client/README.md) implements
submission, recovery, bounded polling, complete CSV/JSON download, cancellation
and deletion. It stores private access in a 0600 file, never follows redirects
and never automatically retries a submission. The web interface needs no client
installation. An [optional CPU package](../deploy/container/README.md) is provided
with its verification status and externally mounted models.

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
`max_mismatches: 0..6`. Input is FASTA/plain text full 23-base guide-associated
target sequences, or a guide CSV/TSV. Genome search requires unambiguous ACGT
and NGG; it enumerates ungapped candidates then applies the selected models.

Genome requests may include `intended_loci`, a list of at most 10 objects with
`target`, `chromosome`, `start`, `end`, `strand` and `assembly`. The target must
exactly match a submitted 23-nt guide-associated sequence, strand is `+` or `-`,
assembly is `GRCh38`, and coordinates are zero-based half-open 23-base intervals.
This preserves an explicit user selection; it does not infer a unique on-target
site from sequence identity alone.

Initial limits: 5 MiB serialized JSON; 60,000 supplied pairs; 10 genome guides;
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

Status may also include a bounded `progress` object with the current processing
stage and timing. It is operational progress, not a completeness claim; use
`status == "completed"` before consuming final results.

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

Optional row fields include `baselines.cfd` (a score or an explicit unavailable
reason), `annotations` (gene/transcript features and source release), source-tool
identifiers for imported inputs, and the selected intended-locus marker.
Imported coordinates are explicitly user supplied until checked against the
reference. Missing annotations are distinct from confirmed intergenic sequence.
Downloaded JSON retains complete scientific metadata and provenance; API CSV
is a flattened table. Local browser selections, notes and experimental evidence
are part of the browser export bundle and are not uploaded into job storage.

## Reference helpers

Helpers accept `POST`, `Content-Type: application/json`, no job capability, and
at most 8 KiB per request (16 KiB for `/reference-context`). Check the corresponding `features` flag in
`GET /capabilities`; a temporarily unavailable reference returns 503. Admission
is bounded to four simultaneous helper requests and 30 requests/minute/client;
429 includes `Retry-After: 60`. Helper output is not a submitted prediction job.

| Route | JSON request | Purpose |
| --- | --- | --- |
| `/resolve-guide` | `{"spacer":"TGAGACTCTTGCAGTCACAC","chromosome":"1","start":0,"end":1000,"assembly":"GRCh38"}` | Find compatible 23-nt guide-associated sequences with actual NGG PAM in a declared interval; select the intended locus explicitly. |
| `/discover-guides` | `{"chromosome":"1","start":0,"end":1000,"assembly":"GRCh38"}` | Enumerate bounded NGG candidates on both strands from the pinned reference interval. |
| `/discover-genes` | `{"query":"HBB","assembly":"GRCh38"}` | Resolve an exact gene symbol or Ensembl gene/transcript identifier against the pinned annotation. |
| `/reference-context` | `{"records":[{"id":"selected-1","off_target":"TGAGACTCTTGCAGTCACACAGG","chromosome":"1","start":100056,"end":100079,"strand":"+","assembly":"GRCh38","coordinate_system":"0-based half-open"}],"flank_bases":250}` | Check selected candidate sequences against the actual reference and return flanking FASTA plus complete ready/skipped metadata. |

Resolver intervals contain 20–10,000 bases; the exact spacer must lie inside,
and up to three adjacent bases may be read to establish its actual PAM.
Discovery intervals contain 23–20,000 bases and return at most 200 full 23-base
sites wholly inside the interval. Overflow rejects the request instead of
returning a partial list. Gene lookup returns at most 25 matches and requires
an exact supported symbol or identifier; choose a narrower interval when a
gene or transcript span exceeds the discovery limit.

Coordinates in these requests and responses are zero-based, end-exclusive,
forward-reference positions. A returned negative-strand sequence is oriented
with its guide and PAM. The example interval demonstrates the schema and does
not promise a match for the example spacer. Preserve the reference checksum and
coordinate convention in downstream files. Discovery is guide enumeration;
these endpoints do not predict on-target efficiency or cleavage probability.

Reference context accepts 1–20 records and 0–1,000 flanking bases per side.
Returned context is in **forward-reference orientation**, including for a
negative-strand candidate; target offsets identify its full 23-base interval.
Every selection has a ready/skipped result, with a reason for reference mismatch
or unsupported coordinates. Contig-end clipping and ambiguous flank bases are
recorded. FASTA and individual sequence hashes accompany reference provenance.
This prepares sequence for downstream work; it does not design primers or test
amplicon specificity. See [experimental follow-up](experimental-followup.md).

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
