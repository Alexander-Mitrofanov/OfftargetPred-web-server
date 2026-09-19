# Operating OfftargetPred

This runbook supports a maintained web interface for the published CRISPert
method. It records verified current facts and procedures; it does not establish
a historical uptime rate or an institutional hosting commitment.

## Responsibility and current state

The repository maintainer is [Alexander-Mitrofanov](https://github.com/Alexander-Mitrofanov).
Issues can be reported through the [project issue tracker](https://github.com/Alexander-Mitrofanov/OfftargetPred-web-server/issues).
Do not post a private result link, sequence, access capability, SSH key or account
credential in an issue. No automated email or third-party alert integration is installed.

Still needed from the service owner before asserting long-term journal readiness:

- Named primary and backup operational contacts and a private support route.
- Institutional approval, funding/resource allocation and a five-year maintenance
  commitment. A working de.NBI allocation alone does not establish this commitment.
- An agreed institutional public hostname or documented ownership and renewal
  responsibility for the current Tailscale hostname.
- An approved, separate storage destination for private model/reference recovery
  copies, with licensing and access controls. The configuration bundle below does
  not back up those large artifacts.

Verified on **19 September 2026, 19:17 UTC**, against production release
`e1d3260da0e6125c3cb6e52e82143c05dcf966c5`:

| Check | Observation |
|---|---|
| Attached data volume | `/dev/vdb`, 1,041,529,569,280 bytes = **970 GiB**, ext4, mounted at `/srv/crispert` |
| Filesystem capacity | 953.70 GiB usable filesystem capacity; 941.68 GiB free at this snapshot; 20 GiB service reserve |
| Root disk / memory | 22.35 GiB root free; 54.93 GiB RAM available of 58.86 GiB |
| Services | API, worker, Nginx and tailscaled active |
| API readiness | Local and normal public HTTPS health 200; worker available; matching release IDs |
| GPU | One V100, 16,384 MiB memory, 38 °C, no pending retired pages |
| Public DNS / TLS | Normal resolver returned public IPv4/IPv6 addresses; certificate and hostname verified; 89.82 days until expiry |
| Funnel | Port 443, TLS termination for the documented hostname, PROXY-v2 to `127.0.0.1:8082` |
| Tailscale authentication | Online; key expires **18 March 2027, 15:49:13 UTC**; expiry has not been disabled |
| Time synchronization | **Unresolved:** NTP enabled, timesyncd active, `NTPSynchronized=no`, zero received packets |

The earlier Funnel DNS publication problem was resolved. See the
[incident report](tailscale-dns-report.md). Neither a hosts-file override nor a
forced ingress address was used for the current public checks.

### Clock investigation and recovery

The configured fallback is `ntp.ubuntu.com`. DHCP lease records exposed no NTP
server, and no time-service drop-in supplied one. Bounded UDP/123 queries to the
four resolved Ubuntu IPv4 servers and the officially documented
[Heidelberg university time server](https://www.urz.uni-heidelberg.de/en/service-catalogue/network/time-server)
received no reply. This establishes failed reachability during the test; it does
not prove the location or cause of a firewall policy.

Before changing the VM clock, have the resource owner identify the approved
reachable NTP service and check project/network egress policy for UDP/123. Do not
work around site restrictions or set the clock from an unauthenticated HTTP
header. After the approved source is confirmed, an administrator may configure
it in `/etc/systemd/timesyncd.conf.d/offtarget.conf`, restart **only**
`systemd-timesyncd`, and verify:

```bash
timedatectl show --property=NTP --property=NTPSynchronized
timedatectl timesync-status
sudo python3 /srv/crispert/current/deploy/healthcheck.py --print
```

A time-source change does not require an application restart. Avoid stepping the
clock while jobs run: timestamps control retention and worker heartbeat age.
The readiness monitor deliberately reports failure until synchronization is
confirmed. No time configuration or live service was changed during this audit.

## Readiness monitoring

`deploy/healthcheck.py` uses only the Python standard library and installed
`curl`, `systemctl`, `findmnt`, `timedatectl`, `nvidia-smi` and `tailscale` tools.
Each external probe has a deadline. DNS and TLS run in bounded child processes;
HTTPS validates the normal hostname and certificate. It does not submit jobs or
read the queue, logs, user files, full Tailscale peer details or credentials.

```bash
sudo python3 /srv/crispert/current/deploy/healthcheck.py --print
```

Exit codes are **0 ready**, **1 an observed readiness failure**, **2 invalid
configuration or inability to store state**. HTTP 200 alone is insufficient:
worker availability, service supervision, storage reserve, GPU, time sync,
transport and matching local/public release IDs must also pass. Low RAM, high
GPU temperature, a Tailscale health message or approaching authentication/TLS
expiry is reported separately. The Tailscale key warns at 30 days; certificates
warn at 14 days and fail below 7 days. A missing expiry field means the CLI did
not report a deadline; it is not proof of a long-term authentication policy.

The timer runs approximately every five minutes. It saves one compact, redacted
snapshot to `/var/lib/offtarget-operations/health.json` (root-only, mode 0600)
and writes a journal summary only when a check changes pass/warn/fail status.
Changing free-space numbers do not produce repetitive alerts. `--monitor` exits
zero for an observed outage so systemd does not repeat failure noise; read the
snapshot's `ready` field and transition journal, not just the timer's unit state.
The initial snapshot is reported once. The timer sends no external notification
and cannot detect a powered-off host from that host; an independently hosted
public probe needs an owner-approved destination and policy.

Coordinator activation, after the source is in the selected release:

```bash
sudo install -m 0644 /srv/crispert/current/deploy/offtarget-healthcheck.service /etc/systemd/system/
sudo install -m 0644 /srv/crispert/current/deploy/offtarget-healthcheck.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now offtarget-healthcheck.timer
sudo systemctl start offtarget-healthcheck.service
sudo cat /var/lib/offtarget-operations/health.json
sudo journalctl -u offtarget-healthcheck.service -n 10 --no-pager
```

The service denies access to private job directories, upload bodies, worker
temporary storage and Tailscale identity files. It can query tailscaled's local
socket without copying node identity. It writes only its own state directory.
The timer was prepared, its units validated, and the probes exercised in a
temporary staging unit with the same access restrictions; activation remains a
release step. It is **not** evidence that monitoring has already been operating for days.

## Configuration backup and safe restore

Use the supplied JSON bundle instead of a whole-volume snapshot. A whole-volume
snapshot would include jobs and extend retention beyond the advertised 24 hours.
The script allows only named runtime settings, hashes of release deployment
files, and artifact identities/hashes. Unknown environment entries are omitted.
It never copies model bytes, genome bases, private jobs, SSH keys, tailnet state
or account tokens. It records any omitted environment entry count, so a future
configuration extension must be reviewed deliberately.

```bash
sudo install -d -m 0700 /srv/crispert/backups
sudo python3 /srv/crispert/current/deploy/backup-configuration.py create \
  --verify-artifacts --output /srv/crispert/backups/config-RELEASE-YYYYMMDD.json
```

Choose a new filename: existing files are never overwritten. `--verify-artifacts`
reads the configured checkpoint, reference and optional annotation bytes and
compares recorded digests; this can take time, so run it during a quiet period.
Without the flag, the bundle records declared hashes and file presence but does
**not** claim byte verification. The Cas-OFFinder executable digest records the
installed binary's identity; reproducing its build also requires the pinned
upstream source described in [deployment](deployment.md).

The bundle checksum detects accidental damage. It is not a digital signature.
Copy the root-only bundle to the owner's approved independent backup storage
when that destination is known. A copy on the same volume is useful for a
configuration mistake, but cannot recover a failed/lost volume.

Restore always stages three fixed files in a **new** directory and never writes
to `/etc`, a running service, or artifact paths from the bundle:

```bash
sudo python3 /srv/crispert/current/deploy/backup-configuration.py restore \
  /srv/crispert/backups/config-RELEASE-YYYYMMDD.json \
  --destination /srv/crispert/staging/restore-RELEASE
```

Review `runtime.env`, `artifact-verification.json` and `RESTORE.txt` there. The
source-file hashes identify drift in the deployment templates; the templates
are restored from the recorded Git revision, not copied from arbitrary live
configuration. Environment changes outside the supported allowlist need a
separate reviewed change to the script. No private job recovery is promised.

The production artifacts were hashed and the actual sanitized bundle restored
successfully into `/srv/crispert/staging/operations-restore-check` on 19 September
2026. This tested a configuration restore, **not** a full disaster-recovery
rebuild or a restart of the live machine.

## Rebuild and restore acceptance

1. Recreate Ubuntu 24.04, the V100-compatible proprietary driver and a mounted
   ext4 data volume. Reuse a retained volume only after checking its identity;
   never format an existing volume merely because the mount failed.
2. Check out the exact recorded Git revision. Rebuild pinned runtimes and
   Cas-OFFinder following [deployment](deployment.md). Compare source-file hashes
   in the saved bundle before activation.
3. Retrieve privately authorized original checkpoints from approved storage;
   verify all three digests against `models.manifest.json`. Do not publish them
   with the source release. Recreate the fixed Ensembl reference and optional
   FASTA/annotation indexes with the preparation scripts and matching metadata.
4. Restore the configuration into a new staging directory; review and install
   only validated values. Create fresh private job storage. Expired or lost user
   jobs are not reconstructed from backups.
5. Authenticate the **new** VM to Tailscale through the owner. Never transplant
   `/var/lib/tailscale`, SSH host identity or an old node's credentials. Confirm
   hostname ownership and Funnel permission through the owner's normal process.
6. Run tests, real checkpoint inference, synthetic search and staged browser
   acceptance. Activate the release with the installer, enable the monitor and
   verify normal public DNS/TLS, CORS, real scoring and deletion of a synthetic
   smoke-test job. Reboot acceptance needs a scheduled maintenance interval.
7. Record the revision, exact checks, UTC time and any residual failure. Do not
   claim a full restore or reboot test from a successful HTTP request alone.

## Upgrade, rollback and routine review

Stage every change before touching `/srv/crispert/current`. Keep the previous
verified release and configuration bundle. Check queue/storage compatibility
before upgrading. During an agreed quiet interval, stop admission and drain or
explicitly cancel running jobs, then activate using the deployment installer.
Recheck monitor and browser flows before considering the upgrade complete.

To roll back, stop API and worker, restore the last compatible `current` symlink
and `OFFTARGET_RELEASE_ID`, then restart and rerun health and smoke checks.
Preserve the volume, checkpoints, reference and private queue. If database or
result schema compatibility is unknown, inspect that change first; do not
blindly run an older worker against a new database. The rollback itself can
interrupt a running job, so it belongs to the coordinator's release procedure.

At least monthly, the responsible operator should review capacity, OS/security
updates, failed checks, the chosen dependency versions, backup recoverability,
contact ownership and de.NBI allocation validity. Review authentication before
**16 February 2027** (30 days before the currently reported key expiry) and
renew through the account's policy. TLS renewal is performed by Tailscale; the
monitor checks the certificate actually served. These are runbook obligations,
not recurring Codex tasks or claims that somebody has accepted the obligation.
