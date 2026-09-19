#!/usr/bin/env python3
"""Bounded, read-only operational readiness checks; never inspect private jobs.

The saved state contains only fixed check names and whitelisted numerical/status
fields. Raw command stderr, tailnet peers, health messages and HTTP bodies are
never persisted. This checks current readiness, not historical availability.
"""
from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import ipaddress
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
from urllib.parse import urlsplit

DEFAULT_ORIGIN = "https://offtargetpred-web.tail58d78e.ts.net"
SAFE_ID = re.compile(r"^[A-Za-z0-9_.-]{1,100}$")


def command(args: list[str], timeout: int = 15) -> str:
    result = subprocess.run(args, capture_output=True, text=True, timeout=timeout, check=True)
    if len(result.stdout) > 1024 * 1024:
        raise ValueError("oversized diagnostic response")
    return result.stdout.strip()


def result(status: str, **facts) -> dict:
    return {"status": status, **facts}


def parse_health(body: str) -> dict:
    data = json.loads(body)
    worker = data.get("worker", {})
    available = isinstance(worker, dict) and worker.get("available") is True
    ready = data.get("status") == "ok" and available
    release = data.get("release_id", "unknown")
    return result("pass" if ready else "fail", worker_available=available,
                  release=release if isinstance(release, str) and SAFE_ID.fullmatch(release) else "unknown")


def health(url: str) -> dict:
    # curl's wall-clock deadline includes name resolution; urllib's socket timeout does not.
    body = command(["curl", "--silent", "--fail", "--max-time", "12",
                    "--connect-timeout", "5", "--max-filesize", "65536", "--noproxy", "*", url], 15)
    return parse_health(body)


def services() -> dict:
    names = ["offtarget-api", "offtarget-worker", "nginx", "tailscaled"]
    states = {}
    for name in names:
        try:
            active = command(["systemctl", "is-active", name], 5) == "active"
        except (subprocess.SubprocessError, OSError, ValueError):
            active = False
        states[name] = active
    return result("pass" if all(states.values()) else "fail", active=states)


def storage(root: Path, min_free_gib: int) -> dict:
    mount = json.loads(command(["findmnt", "--json", "--target", str(root), "--output", "TARGET,FSTYPE"], 5))
    entries = mount.get("filesystems", [])
    is_volume = len(entries) == 1 and entries[0].get("target") == str(root) and entries[0].get("fstype") == "ext4"
    usage = shutil.disk_usage(root)
    root_usage = shutil.disk_usage("/")
    ready = is_volume and usage.free >= min_free_gib * 1024 ** 3 and root_usage.free >= 2 * 1024 ** 3
    return result("pass" if ready else "fail", volume_mounted=is_volume,
                  free_gib=round(usage.free / 1024 ** 3, 2), total_gib=round(usage.total / 1024 ** 3, 2),
                  reserve_gib=min_free_gib, root_free_gib=round(root_usage.free / 1024 ** 3, 2))


def memory() -> dict:
    fields = {}
    for line in Path("/proc/meminfo").read_text().splitlines():
        key, _, value = line.partition(":")
        if key in {"MemTotal", "MemAvailable"}:
            fields[key] = int(value.split()[0]) * 1024
    free = fields["MemAvailable"] / 1024 ** 3
    return result("fail" if free < 1 else "warn" if free < 4 else "pass",
                  available_gib=round(free, 2), total_gib=round(fields["MemTotal"] / 1024 ** 3, 2))


def gpu() -> dict:
    rows = command(["nvidia-smi", "--query-gpu=temperature.gpu,memory.total,retired_pages.pending",
                    "--format=csv,noheader,nounits"], 10).splitlines()
    if not rows:
        return result("fail", device_count=0)
    temperatures, memories, pending = [], [], []
    for row in rows:
        temperature, mem, retired = [item.strip() for item in row.split(",")]
        temperatures.append(int(temperature))
        memories.append(int(mem))
        pending.append(retired)
    ready = max(temperatures) < 90 and all(value == "No" for value in pending)
    return result("fail" if not ready else "warn" if max(temperatures) >= 80 else "pass",
                  device_count=len(rows), max_temperature_c=max(temperatures), memory_mib=memories,
                  pending_retired_pages=any(value == "Yes" for value in pending))


def clock() -> dict:
    values = dict(line.split("=", 1) for line in command([
        "timedatectl", "show", "--property=NTPSynchronized", "--property=NTP"], 5).splitlines() if "=" in line)
    synced, enabled = values.get("NTPSynchronized") == "yes", values.get("NTP") == "yes"
    return result("pass" if synced and enabled else "fail", synchronized=synced, ntp_enabled=enabled)


def tailscale(hostname: str, now: datetime) -> dict:
    state = json.loads(command(["tailscale", "status", "--json"], 10))
    own = state.get("Self") or {}
    online = state.get("BackendState") == "Running" and own.get("Online") is True
    expiry = own.get("KeyExpiry")
    days = None
    if expiry:
        parsed = datetime.fromisoformat(expiry.replace("Z", "+00:00"))
        days = round((parsed - now).total_seconds() / 86400, 2)
    funnel = json.loads(command(["tailscale", "funnel", "status", "--json"], 10))
    mapping = funnel.get("TCP", {}).get("443", {})
    enabled = (funnel.get("AllowFunnel", {}).get(hostname + ":443") is True
               and mapping.get("TCPForward") == "127.0.0.1:8082"
               and mapping.get("TerminateTLS") == hostname and mapping.get("ProxyProtocol") == 2)
    health_count = len(state.get("Health") or [])
    failed = not online or not enabled or (days is not None and days <= 0)
    warn = (days is not None and days <= 30) or health_count > 0
    return result("fail" if failed else "warn" if warn else "pass", online=online,
                  funnel_configured=enabled, key_expiry_days=days, health_message_count=health_count)


def public_dns(hostname: str) -> dict:
    # Isolated resolver process supplies a hard deadline even if the resolver hangs.
    body = command([sys.executable, "-c", "import socket,json,sys; print(json.dumps(sorted(set(x[4][0] for x in socket.getaddrinfo(sys.argv[1],443,type=socket.SOCK_STREAM)))))", hostname], 10)
    addresses = [ipaddress.ip_address(address) for address in json.loads(body)]
    normal = bool(addresses) and all(address.is_global for address in addresses)
    return result("pass" if normal else "fail", address_count=len(addresses),
                  families=sorted({address.version for address in addresses}), all_addresses_public=normal)


def public_tls(hostname: str) -> dict:
    code = """import socket,ssl,sys,json,time
with socket.create_connection((sys.argv[1],443),timeout=6) as sock:
 with ssl.create_default_context().wrap_socket(sock,server_hostname=sys.argv[1]) as secure:
  cert=secure.getpeercert()
  print(json.dumps({'days':(ssl.cert_time_to_seconds(cert['notAfter'])-time.time())/86400}))
"""
    days = round(float(json.loads(command([sys.executable, "-c", code, hostname], 12))["days"]), 2)
    return result("fail" if days < 7 else "warn" if days < 14 else "pass", verified=True, expiry_days=days)


def guarded(check) -> dict:
    try:
        return check()
    except subprocess.TimeoutExpired:
        return result("fail", reason="timeout")
    except (OSError, subprocess.SubprocessError, ValueError, TypeError, KeyError, AttributeError):
        return result("fail", reason="check_failed")


def collect(root: Path, origin: str, min_free_gib: int) -> dict:
    url = urlsplit(origin)
    if url.scheme != "https" or not url.hostname or url.netloc != url.hostname or url.path not in {"", "/"} or url.query or url.fragment:
        raise ValueError("public origin must be an HTTPS hostname without credentials, port or path")
    now = datetime.now(timezone.utc)
    checks = {
        "api_worker": lambda: health("http://127.0.0.1:8010/api/v1/health"),
        "services": services, "storage": lambda: storage(root, min_free_gib), "memory": memory,
        "gpu": gpu, "clock": clock, "tailscale": lambda: tailscale(url.hostname, now),
        "public_dns": lambda: public_dns(url.hostname), "public_tls": lambda: public_tls(url.hostname),
        "public_https": lambda: health(origin.rstrip("/") + "/api/v1/health"),
    }
    with ThreadPoolExecutor(max_workers=6) as pool:
        values = list(pool.map(guarded, checks.values()))
    outcomes = dict(zip(checks, values))
    passed = all(value["status"] != "fail" for value in values)
    # Different releases at the same origin indicate a routing/activation problem.
    if outcomes["api_worker"].get("release") != outcomes["public_https"].get("release"):
        outcomes["public_https"] = result("fail", reason="release_mismatch")
        passed = False
    return {"schema_version": 1, "checked_at": now.isoformat(), "ready": passed, "checks": outcomes}


def signature(state: dict) -> dict:
    return {key: value.get("status") for key, value in state.get("checks", {}).items()}


def save_state(state: dict, destination: Path) -> bool:
    previous = {}
    if destination.exists():
        if destination.is_symlink() or destination.stat().st_size > 65536:
            raise ValueError("unsafe state destination")
        previous = json.loads(destination.read_text())
    destination.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=".health-", dir=destination.parent)
    try:
        with os.fdopen(fd, "w") as stream:
            json.dump(state, stream, sort_keys=True, indent=2)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, destination)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
    return signature(previous) != signature(state)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path("/srv/crispert"))
    parser.add_argument("--public-origin", default=DEFAULT_ORIGIN)
    parser.add_argument("--min-free-gib", type=int, default=20)
    parser.add_argument("--state", type=Path)
    parser.add_argument("--print", dest="print_state", action="store_true", help="print only the redacted current snapshot")
    parser.add_argument("--monitor", action="store_true", help="journal transitions; exit zero for observed unhealthy state")
    args = parser.parse_args()
    if not 1 <= args.min_free_gib <= 1000:
        parser.error("reserve must be 1–1000 GiB")
    try:
        state = collect(args.root, args.public_origin, args.min_free_gib)
        changed = save_state(state, args.state) if args.state else True
    except (ValueError, OSError):
        print("Operational check failed: invalid configuration or state storage", file=sys.stderr)
        return 2
    if args.print_state:
        print(json.dumps(state, indent=2, sort_keys=True))
    elif changed:
        print(json.dumps({"checked_at": state["checked_at"], "ready": state["ready"], "checks": signature(state)}, sort_keys=True))
    return 0 if args.monitor or state["ready"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
