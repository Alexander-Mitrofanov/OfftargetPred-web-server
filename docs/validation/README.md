# Validation and launch status

Validated on 19 September 2026. Application release:
`e1d3260da0e6125c3cb6e52e82143c05dcf966c5`.

## Completed checks

| Check | Result |
|---|---|
| Local backend/scientific tests | 40 passed |
| Public GitHub CI | 38 passed; two private-model tests excluded; frontend built |
| Original Lightning inference versus production adapter | All three models agree within 1e-6 |
| V100 GPU versus CPU inference | Maximum absolute difference 0.0 on acceptance inputs |
| Supplied held-out K562 benchmark | All three supplied reference AP values reproduced |
| Cas-OFFinder synthetic oracle | Exact hit sets at 0, 1, 2 mismatches; both strands; zero hits; descriptive FASTA headers |
| Real human GRCh38 search | Expected chromosome 1 site recovered; 15 candidates, all three models, 28.14 seconds after reboot |
| Real private API acceptance | 21 checks passed, including authorization, CORS, sorting, downloads, cancellation and deletion |
| Nginx PROXY-v2 gateway | The same 21 real API checks passed through the production gateway |
| VM restart | Data volume mounted, GPU initialized, API/worker/Nginx started and worker ready without intervention |
| Browser against actual GPU API | Submission, three-model results, JSON export, refresh recovery, deletion and 390px layout passed |
| Published frontend through explicit public relay override | Both pair scoring and real GRCh38 search passed; this diagnostic bypasses the missing DNS lookup only, with certificate verification retained |
| Public HTTPS API with normal DNS | All 21 acceptance checks passed |
| Published frontend with normal DNS | Both prediction workflows, three GPU models, real GRCh38 locus, downloads, refresh, deletion and mobile layout passed |

The synthetic GPU parity cases are numerical checks, not evidence that GPU/CPU
outputs will always be bit-identical. The real-genome runtime is one acceptance
query at one mismatch; it is not a general speed promise or biological accuracy
measurement. The model card describes scientific limitations and evaluation.

Machine-readable evidence:

- [Held-out benchmark](model-benchmark.json)
- [GPU parity](gpu-validation.json)
- [Synthetic search oracle](search-validation.json)
- [Human reference acceptance](live-genome.json)
- [Private API acceptance](private-api.json)
- [Public HTTPS API acceptance](public-api.json)
- [Public browser acceptance with normal DNS](public-browser.json)
- [Live browser acceptance](live-browser.json)
- [Published frontend/relay diagnostic](public-relay-browser.json)
- [Public relay API diagnostic](public-relay-api.json)
- [Restart and gateway acceptance](restart.json)
- [Installed Python/CUDA packages](runtime-cuda.txt)

Published frontend revision: `18a3a5e10d884aceb2cf2bb66f420794b1029281`.
[Application checks](https://github.com/Alexander-Mitrofanov/OfftargetPred-web-server/actions/runs/35454266203)
and [GitHub Pages deployment](https://github.com/Alexander-Mitrofanov/OfftargetPred-web-server/actions/runs/35454266205)
both passed. Subsequent documentation commits do not change these application
revisions.

## Public launch status

The backend is deployed on the dedicated de.NBI VM. GitHub contains the service,
frontend, workflows and documentation. GitHub Pages is configured to use GitHub
Actions, with HTTPS enforced. The owner authenticated Tailscale 1.102.4, and
Funnel is running at `offtargetpred-web.tail58d78e.ts.net:443` with a valid
certificate. The frontend is published at
<https://alexander-mitrofanov.github.io/OfftargetPred-web-server/>.

**Public launch verified:** all 21 API checks and both browser prediction
workflows passed with normal public DNS and certificate verification enabled.
The browser test used the published GitHub Pages URL, the actual V100 worker,
all three models and the pinned GRCh38 reference. Its genome search returned
15 candidates including the expected chromosome 1 locus. Acceptance jobs were
deleted, and no test jobs remained on the server.

Initial DNS publication was delayed approximately 24 minutes. All four
authoritative nameservers subsequently published the hostname. See the
[resolved DNS incident](../tailscale-dns-report.md) for diagnostic evidence;
the earlier relay-override reports are superseded for launch acceptance by the
normal-DNS reports above. No external support report was submitted.

The VM's time service is active but NTP synchronization was not established:
the tested university and Ubuntu NTP servers did not answer UDP port 123 from
this VM. Resolve the permitted NTP route with the cloud administrator and verify
`timedatectl show -p NTPSynchronized`. This remains an operational follow-up.
