# Improvement 24: measured progress, throughput and anonymous fairness

## Delivered behavior

Private job status now reports real coarse stages: preparing the isolated process,
reference search, model scoring, annotation, and saving the complete result. Stage
labels come from an allowlist. There is no estimated percentage or completion
promise. Queue wait and elapsed runtime are computed from durable job timestamps;
finished phase times are measured with a monotonic clock in the child process.
The worker keeps one isolated child per job and retains cancellation, deletion,
timeouts, FIFO admission and the existing queue bounds.

Pair jobs without coordinate metadata, including ordinary pasted sequence pairs,
skip opening and hashing the 1.3 GB local annotation database. They still receive
explicit `no_coordinates` annotations. Empty candidate sets also skip the DB.
Coordinate-bearing rows keep the existing compatible-index verification.

### Files

- `backend/offtargetpred/progress.py`: private atomic stage recording and bounded,
  allowlisted status projection.
- `backend/offtargetpred/worker.py`: stage transitions, phase timings and avoiding
  unused annotation reads. Edited under the coordinator's explicit handoff.
- `backend/offtargetpred/jobs.py`: status projection only; admission and scheduling
  rules are unchanged. Edited under the coordinator's explicit handoff.
- `tests/test_progress.py`: privacy, malformed/bounded progress, cancelled/failed
  status precedence, timings, no-coordinate annotation skip, FIFO and NAT behavior.
- `scripts/measure-performance.py`: bounded isolated VM measurement, GPU samples,
  synthetic admission probe, public example input and source fingerprints.
- `docs/implementation/24-performance-measurements.json`: machine-readable results.

## Status API contract

The existing capability-authorized job response adds:

```json
{
  "progress": {
    "stage": "scoring",
    "message": "Loading the selected models and scoring candidate sequences.",
    "queue_seconds": 1.235,
    "elapsed_seconds": 4.121,
    "phase_seconds": {"preparing": 1.912, "search": 1.11}
  }
}
```

Those example numbers illustrate the schema only. Runtime progress uses actual
measurements. Queue and elapsed times are seconds; phase entries appear after
measurement, so missing phases are not zero-duration phases. A Python exception
can leave an elapsed portion of a failed phase; forcibly terminated processes can
leave only previously recorded phases. Durable status overrides stale progress
for failed, cancelled or cancelling jobs. `complete` means the full result has
been saved; the supervisor then sets the durable job status to `completed`.

Each private progress file is created with mode `0600` inside its existing `0700`
job directory. Public projection reads at most 4 KiB and returns only known stage
labels and finite, nonnegative phase durations up to one day. File contents cannot
supply messages, arbitrary keys, user sequences, tokens or tracebacks. Missing or
malformed progress does not prevent retrieval of the job's durable state. The
file follows the job's ordinary deletion and 24-hour retention lifecycle.

Result metadata adds `timings.queue_seconds` and `timings.phase_seconds`, with an
explicit scope description. `preparing` includes child-process imports;
`search` includes reference verification and Cas-OFFinder; `scoring` includes
checkpoint loading, inference and the separate CFD score; `annotation` includes
verification and local overlap lookup. Result metadata is recorded before final
serialization, so final `writing` duration is available in job status progress.
This avoids circularly measuring serialization of its own final timing value.

Coordinator integration: render the fixed `progress.message` or a human-readable
stage, without a progress bar that suggests an unknown denominator. The coordinator
added `Retry-After` exposure through CORS and status-aware API error guidance;
the worker did not edit API or frontend files.

## Fairness and scope

The anonymous service permits one queued/running job per public IP, 30 submissions
per IP per hour and ten globally queued jobs, with one running job. A lab or
institution behind one NAT shares these limits. This is a deliberate simple
admission bound, **not fairness between individual people**. Independent-IP jobs
enter FIFO order; a second submission from a shared IP must wait for the first
to finish. Users should retain the private recovery link, reuse completed results,
submit a bounded batch when appropriate and retry after the displayed delay.
The service cannot reliably identify distinct people behind a NAT without adding
accounts or another identity mechanism. No fingerprinting or raw-IP logging was
added, and deleting a job still cannot erase its hourly submission history.

Measurements characterize small requests on this VM, not peak capacity or a
latency promise. They use public examples and a separate staging data directory;
they never submit to production or read real users' jobs. The script runs at most
three repetitions of four small cases, kills only its own child after 180 seconds,
and deletes its private synthetic job payloads after each run. The admission probe
does not perform predictions. GPU samples cover the whole device at approximately
250 ms intervals plus command overhead; they can miss brief kernels and are not
process-specific GPU profiling.

No model reuse across job boundaries was introduced. Preserving process isolation
and cancellation is preferable to a speculative cache that retains private state.
Search still verifies the complete reference per isolated job; measured costs can
guide a future immutable-reference attestation design. The API's separate verified
FASTA-index cache is not evidence that the search worker skips verification.

## Verification

### Real VM measurements

On 19 September 2026, Python 3.12.3 and a Tesla V100 16 GB on the 12-CPU de.NBI
VM completed all eight isolated jobs (two repetitions per case):

| Public example workload | Candidates | Child wall time | Scoring phase | Annotation phase |
|---|---:|---:|---:|---:|
| One pair, k1 | 1 | 3.113–3.117 s | 0.351–0.372 s | <0.001 s |
| One pair, all three models | 1 | 3.113–3.114 s | 0.437–0.439 s | <0.001 s |
| 32 pairs, all three models | 32 | 3.108–3.120 s | 0.385–0.452 s | <0.001 s |
| One guide, ≤1 mismatch, all three models | 15 | 28.173–28.308 s | 0.475–0.479 s | 2.889–2.939 s |

The 32 pairs repeat the same sequence with distinct IDs; this tests a small batch,
not a diverse biological dataset. The genome search phase, including SHA-256
verification, took **22.084–22.097 s**, and preparation/imports took roughly
1.94–2.02 s for all workloads. Actual device metadata was `cuda`. Whole-device
samples reached 82% utilization and 2,590 MiB allocated memory; brief scoring
kernels can fall between samples, so low sampled utilization for tiny pair jobs
does not indicate CPU inference. Queue waits of 0.010–0.012 s reflect immediate
manual claims in this isolated test and must not be advertised as public-service
wait times. The supervisor's normal one-second polling cadence and real queue load
can add latency beyond these child-process measurements.

These results support retaining batching and removing unused annotation reads.
They do not establish an improvement ratio against the previous version or justify
changing scheduler concurrency. The measured search cost is much larger than
model scoring for this small example. All five synthetic fairness assertions
passed, including the documented shared-IP restriction.

VM-focused test command:

```sh
PYTHONPATH=/srv/crispert/staging/nar-v2/backend:/srv/crispert/venv/lib/python3.12/site-packages \
  /srv/crispert/staging/test-venv/bin/python -m pytest -q \
  tests/test_progress.py tests/test_jobs.py
```

Result: **28 passed**. This covers durable queue/cancellation semantics as well as
new timing and privacy boundaries. Model weights, tokenization, scoring source and
scientific diagnostic fingerprints are unchanged.

For reproduction, configure the normal staging model/reference/annotation paths
and `PYTHONPATH`, then invoke the measurement script with the production Python
runtime and a new output directory beneath `/srv/crispert/staging`. Service-owned
model/reference files require their existing read permissions. Do not aim the
script at the production data directory or start overlapping GPU workloads when
trying to compare timings. The JSON records the exact source hashes and reference.
