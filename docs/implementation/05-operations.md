# Improvement 05 — Operations, maintenance and recovery

## Delivered

- `deploy/healthcheck.py`: bounded, redacted local/public readiness probes,
  worker-aware even if HTTP is 200, matching release IDs, mount/reserve/root-disk,
  RAM, GPU, NTP, Funnel and authentication/certificate deadlines. Compact local
  JSON state and status-transition-only journal output.
- `deploy/offtarget-healthcheck.service` and `.timer`: hardened read-only probes
  every five minutes; no job/identity access or external notifications.
- `deploy/backup-configuration.py`: safe allowlisted configuration and artifact
  digest bundles; checksum validation and restore into a new directory only.
  No job data, model/reference bytes, SSH keys or Tailscale identities are copied.
- `docs/operations.md`: concrete rebuild, backup/restore, activation, rollback,
  maintenance responsibility, current evidence and unresolved operator inputs.
- `tests/test_operations.py`: 12 focused tests for missing workers, redaction,
  timeouts, private state/transition behavior, credential exclusion, safe restore,
  corruption rejection and unsafe configuration values.

## Verified on the VM

On 19 September 2026 at approximately 19:17 UTC:

- All **12 tests passed** using the staging test runtime.
- `systemd-analyze verify` accepted the service and timer. A temporary staging
  unit also ran the real probes successfully with the proposed filesystem and
  network-family restrictions (1.92 seconds; only NTP readiness failed).
- Real local/public probes passed normal DNS, verified TLS, matching API release,
  worker, services, storage, memory, GPU and Funnel checks.
- `/dev/vdb` is exactly **970 GiB**, mounted ext4 at `/srv/crispert`; 941.68 GiB
  free at the snapshot (953.70 GiB usable filesystem capacity).
- All three production checkpoint hashes and the fixed FASTA matched their
  manifests. A sanitized production configuration bundle was created with full
  artifact verification and restored into a new staging directory successfully.
- No production activation, restart, clock change or private job access occurred.

## Unresolved operational finding

`NTPSynchronized=no`; active timesyncd had received zero packets. The Ubuntu
fallback's four IPv4 NTP servers and officially documented Heidelberg time
server timed out on bounded UDP/123 queries. No NTP setting was supplied by
readable DHCP leases or timesync drop-ins. The health script correctly returns
readiness failure for this. The approved reachable time source / egress policy
needs owner or de.NBI confirmation; a speculative clock change was not applied.
Normal DNS and public HTTPS currently work without overrides.

## Coordinator handoff

Install the two units after these files are included in the active release:

```bash
sudo install -m 0644 /srv/crispert/current/deploy/offtarget-healthcheck.service /etc/systemd/system/
sudo install -m 0644 /srv/crispert/current/deploy/offtarget-healthcheck.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now offtarget-healthcheck.timer
sudo systemctl start offtarget-healthcheck.service
sudo cat /var/lib/offtarget-operations/health.json
```

`--monitor` journals transitions and exits zero for observed outages; consumers
must read `ready` in the JSON. Direct invocation without `--monitor` returns 1
for failed readiness. The snapshot is not a public uptime history. An independent
external monitor, institutional URL/five-year commitment, primary/backup operator
and separate artifact backup location remain owner decisions.

The Tailscale node's currently reported authentication deadline is **18 March
2027, 15:49:13 UTC**. Do not claim expiry was disabled. The monitor warns within
30 days. The live application continued running throughout this work.
