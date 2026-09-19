# Independent council: reliability, privacy and operations

Review date: 19 September 2026. Reviewer: independent reliability council agent.

## Verdict

The two software findings are resolved. I found one concrete deployment defect
and agreed with the usability review on one analysis-state defect; both source
corrections now have coordinator-reported acceptance evidence. Release
`91323457d74121147a81eabd6b36f5bc212a186a` is activated as version 0.2.0, with
successful public API, Chromium and Firefox workflow checks. No other P0/P1 reliability or
privacy defect was established in this source review.

This is a web interface for the published CRISPert method. Its reliability case
should establish faithful model execution, usable workflows and maintained
service operation. A new algorithm or new scientific novelty is not a condition
of this engineering verdict. The documented clock and long-term ownership
conditions remain unresolved, so this is not a declaration of fully green
operational readiness or guaranteed NAR acceptance.

## Scope and evidence

I inspected the current working source, including `api.py`, `jobs.py`,
`progress.py`, `worker.py`, reference/discovery/context helpers, annotation and
search verification, frontend capability recovery and exports, service units,
Nginx ingress, installation, monitoring, backup and operational documentation.
I also inspected the relevant contract tests and the container/performance
records rather than relying exclusively on feature descriptions.

The coordinator reports 607 passing backend checks, 163 passing frontend checks,
a successful production build, two passing real-model checks including original
Lightning parity, and two passing opt-in actual-reference checks on de.NBI staging.
These are coordinator execution results, not an independently repeated full
suite by this reviewer. The checked container evidence identifies its image and
source hashes and records 21 real HTTP checks plus a complete CLI cycle. It
explicitly limits that evidence to the tested Podman CPU runtime; Docker Compose
orchestration and genome/GPU container operation are not claimed as tested.

This reviewer did not inspect private job payloads, capabilities or users' data,
and made no production changes. Staging ports 8020/5182 remain distinct from the
production release on port 8010. The release verification below was performed
and reported by the coordinator; this reviewer did not independently repeat it.

## Findings and disposition

### P1: restrictive source permissions could prevent service startup

Before correction, `deploy/install-service.sh` changed the release to
`root:root` and removed group/other write permission without establishing read
access. The current checkout's `backend/offtargetpred/tokenizer.py` was mode
`0660`; an rsync-based release preserving that mode could become `0640 root:root`,
unreadable by the `offtarget` service account. Both the model readiness probe and
normal prediction imports would then fail.

The coordinator added `chmod -R u=rwX,go=rX "$release_dir"` for the public
application release only. Private models and reference artifacts retain their
separate group-only permissions. The coordinator verified imports of the API and
tokenizer as `offtarget` from the prepared release before activation, then verified
the live CUDA worker's readiness. The deployment finding is resolved.

### P1: visiting Help discarded browser-only analysis state

The usability council identified that conditional page rendering unmounted
`AnalysisWorkspace`, losing selections, shortlist notes and imported evidence.
The workspace itself links users to the interpretation guide, so this was an
ordinary supported path to silent loss of analysis work. I concur with that
classification. The coordinator now retains visited workspaces in memory across
navigation. Chromium and Firefox regressions passed for retained selections,
notes/evidence and actual ZIP content through Help and back. Repeated accessibility
audits passed 28 workflow checks and 10 axe scan states per browser with zero
detected violations. The navigation finding is resolved. Refresh and deletion
remain distinct explicit lifecycle events.

### Documentation correction: diagnostics are not an established held-out benchmark

The deployment runbook's acceptance paragraph still referred to a required
"held-out benchmark" at initial review. Training membership is not established
for the supplied evaluation data. I requested wording that calls these
checkpoint diagnostics with documented dataset roles and overlap. The deployment
runbook now uses that wording; the correction is resolved. Numerical parity and
reproducible diagnostic execution are useful acceptance evidence, but they must
not be relabelled independent scientific validation.

## Positive controls verified in source

- **Private access:** random 256-bit job capabilities are compared through their
  hashes; canonical UUIDs constrain job paths. Job IDs alone do not authorize
  access. Deletion revokes access immediately, including when a running child
  still needs to stop. Recovery links use URL fragments, are scrubbed from the
  address bar, and are kept in tab-scoped session storage. The UI states that a
  private link also authorizes download and deletion.
- **Data lifecycle:** payload directories and atomic JSON files are private;
  durable admission and cancellation use SQLite transactions. One supervised
  worker and process-group termination bound concurrent GPU work. Expired access
  is rejected, and worker cleanup removes expired payloads and old orphan
  directories. Cleanup depends on a running worker, as the API documentation
  states; a stopped host is not evidence of timely physical deletion.
- **Public boundaries:** API request sizes, rows, guides, candidates, runtimes,
  helper concurrency and request rates are bounded. Helper schemas reject
  extra fields and inappropriate Boolean coordinates. Responses avoid arbitrary
  model tracebacks and progress-file content. CORS is an origin policy, not
  treated as user authentication. Trusted PROXY-v2 ingress supplies client
  addresses for limits; application ports remain on loopback.
- **Reference integrity:** genome search hashes the exact FASTA it passes to
  Cas-OFFinder. Indexed helpers bind FASTA geometry and hashes to a manifest and
  invalidate verification on file identity changes. Annotation queries use a
  compatible, checksum-verified read-only index. Reference-flank exports verify
  the candidate's complete sequence and declared strand, retain explicit skip
  reasons, and include forward-reference coordinates and hashes.
- **Exports and browser privacy:** external genome links require a click and
  disclose that the locus will be sent. Main analysis exports distinguish full,
  filtered and selected rows, escape spreadsheet formulas and HTML, and remove
  capability fields/links. Local experimental evidence remains separate from
  predictions. No analytics or external script/font dependency was found in the
  reviewed frontend entry point.
- **Operations:** worker network restrictions, immutable runtime/model paths,
  mount requirements, memory limits and private upload storage reduce the effect
  of ordinary failures. Monitoring checks worker availability, not merely HTTP
  200. Configuration backups omit job contents and identity secrets; restore
  creates a new staging directory rather than overwriting live service state.

These controls do not constitute an external penetration test or an unlimited
load test. They are appropriate engineering evidence for the documented bounded
anonymous service.

## Release verification follow-up

The coordinator supplied the following acceptance results for source release
`91323457d74121147a81eabd6b36f5bc212a186a`:

| Check | Reported result |
|---|---|
| Prepared release access | API and tokenizer imports pass as service user `offtarget`; all 194 FASTA contigs/index and the annotation database verify; all three checkpoint SHA-256 values are unchanged. |
| Safe activation | The production queue was empty before activation. |
| Public routing and worker | Local and public health show version 0.2.0, the same release ID and an available CUDA worker, using normal public DNS and TLS. |
| Public API acceptance | All 21 actual HTTP checks pass. |
| Public Chromium workflow | Real supplied pairs and the 15-site genome example, downloads, recovery and deletion pass. |
| Public Firefox workflow | Completed by the coordinator after the initial review: real pairs and 15-site genome search, downloads, recovery, deletion and mobile layout pass. |
| CI and frontend | Application CI and GitHub Pages deployment both succeed. |
| Monitoring | Health timer enabled; snapshot checks pass except the known NTP synchronization failure. |
| Configuration recovery evidence | Verified configuration backup reports an empty artifact-failure list; restoration into a new 0700 directory with 0600 files passes. |

The public release is verified to the stated extent in the
[final integrated release record](../validation/release-0.2.0.json). A
timer's successful exit is not the same as `health.json.ready=true`; the monitor
correctly continues to report the outstanding clock issue. These observations
are current acceptance evidence, not a measured long-term uptime record.

## Owner-managed operational conditions

The following should remain visible in the service's maintenance record. They
are not requests to change model scope or invent new research results.

| Condition | Assessment and required owner action |
|---|---|
| NTP synchronization is unconfirmed | Current probes report `NTPSynchronized=no`. No clock-drift magnitude was established. The owner must identify an approved reachable time source; timestamps affect retention and heartbeat interpretation. Do not assert fully green operational readiness until resolved. |
| Tailscale key expires 18 March 2027, 15:49 UTC | This is a future renewal deadline, not a current outage. Assign renewal ownership before expiry and retain the monitor's expiry warnings. |
| Long-term service responsibility | Name primary/backup contacts, a private support route and institutional resource/five-year maintenance ownership. A running allocation alone does not provide this commitment. |
| External outage detection | The prepared on-host monitor cannot report a powered-off host. An independently hosted probe and notification destination require an agreed operational owner. Do not claim this exists yet. |
| Recovery artifact storage | The configuration backup was deliberately designed without large private model/reference copies or jobs. Confirm a separately authorized recovery location and preservation rights for necessary artifacts. |

Model/data redistribution rights, source archiving and manuscript claims are
covered by the publication council. None should be silently inferred from the
MIT licence for project-owned code.

## Council discussion

I discussed findings with the usability and publication reviewers. We agree that
usable access to a published method is the relevant contribution; faithful score
semantics and dependable user workflows matter more than adding unsupported
scientific scope. The release fixes above are software issues. Maintenance
ownership, unresolved rights and publication evidence remain separately
identified conditions for a journal submission.
