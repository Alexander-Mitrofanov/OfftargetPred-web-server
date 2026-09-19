#!/usr/bin/env python3
"""Dependency-free, capability-safe OfftargetPred reference client (Python 3.12+)."""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
import getpass
import ipaddress
import json
import os
from pathlib import Path
import re
import stat
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

DEFAULT_API = "https://offtargetpred-web.tail58d78e.ts.net"
JOB_ID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")
TOKEN = re.compile(r"[A-Za-z0-9_-]{43}")
TERMINAL = {"completed", "failed", "cancelled"}
MAX_DOWNLOAD = 256 * 1024 * 1024


class ClientError(Exception):
    """A safe-to-display error: never includes request URLs, bodies or tokens."""


class APIError(ClientError):
    def __init__(self, status: int, retry_after: float | None = None):
        self.status, self.retry_after = status, retry_after
        messages = {
            404: "Job not found, expired, deleted, or private access invalid.",
            409: "Results are available only after the job completes.",
            413: "Request exceeds the server input-size limit.",
            422: "Input rejected. Check sequence length, PAM, format and selected models.",
            429: "Server admission limit reached. Retry later; nothing was resubmitted.",
            503: "Service or reference temporarily unavailable.",
        }
        delay = f" Retry-After: {retry_after:g} seconds." if retry_after is not None else ""
        super().__init__(f"HTTP {status}: {messages.get(status, 'API request failed.')}" + delay)


class NoRedirects(HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, message, headers, newurl):
        return None


def api_origin(value: str, allow_local_http: bool = False) -> str:
    try:
        parsed = urlsplit(value)
        host, port = parsed.hostname, parsed.port
        local = host == "localhost"
        if host and not local:
            try:
                local = ipaddress.ip_address(host).is_loopback
            except ValueError:
                pass
        if (not host or parsed.username or parsed.password or parsed.path not in ("", "/")
                or parsed.query or parsed.fragment or any(ord(c) < 33 for c in value)
                or parsed.scheme not in ("https", "http")):
            raise ValueError
        if parsed.scheme == "http" and not (allow_local_http and local):
            raise ValueError
        if port == 0:
            raise ValueError
        return f"{parsed.scheme}://{parsed.netloc.lower()}"
    except ValueError:
        raise ClientError("Use an HTTPS API origin without a path; HTTP requires explicit --allow-local-http and a loopback host.") from None


def validate_credentials(value: object, allow_local_http: bool = False) -> dict:
    if (not isinstance(value, dict) or not isinstance(value.get("id"), str)
            or not JOB_ID.fullmatch(value["id"]) or not isinstance(value.get("token"), str)
            or not TOKEN.fullmatch(value["token"]) or not isinstance(value.get("api_origin"), str)):
        raise ClientError("Invalid or incomplete private credentials file. Do not resubmit an uncertain job automatically.")
    return {"id": value["id"], "token": value["token"], "api_origin": api_origin(value["api_origin"], allow_local_http)}


def private_create(path: Path):
    """Refuse overwrite and symlinks; reserve a private destination before mutation."""
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0)
    try:
        fd = os.open(path, flags, 0o600)
        os.fchmod(fd, 0o600)
        return os.fdopen(fd, "wb")
    except OSError:
        raise ClientError("Cannot create private output file: choose a new path in a private directory.") from None


def load_credentials(path: Path, allow_local_http: bool = False) -> dict:
    try:
        fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
        with os.fdopen(fd, "rb") as handle:
            info = os.fstat(handle.fileno())
            if not stat.S_ISREG(info.st_mode) or info.st_mode & 0o077 or info.st_uid != os.getuid():
                raise ClientError("Credentials must be a regular file owned by you with permissions 0600 (chmod 600 FILE).")
            raw = handle.read(8193)
        if len(raw) > 8192:
            raise ValueError
        return validate_credentials(json.loads(raw), allow_local_http)
    except (OSError, ValueError):
        raise ClientError("Cannot read a valid private credentials file.") from None


def retry_seconds(value: str | None) -> float | None:
    if not value:
        return None
    try:
        if value.isdigit():
            return float(int(value))
        target = parsedate_to_datetime(value)
        if target.tzinfo is None:
            target = target.replace(tzinfo=timezone.utc)
        return max(0.0, (target - datetime.now(timezone.utc)).total_seconds())
    except (ValueError, TypeError, OverflowError):
        return None


class Client:
    def __init__(self, origin=DEFAULT_API, *, allow_local_http=False, timeout=30.0, opener=None):
        self.origin = api_origin(origin, allow_local_http)
        if not 0 < timeout <= 120:
            raise ClientError("Request timeout must be greater than 0 and at most 120 seconds.")
        self.timeout = timeout
        self.opener = opener or build_opener(NoRedirects())

    def request(self, method, path, *, payload=None, credentials=None, sink=None, timeout=None):
        # The caller cannot select another origin or inject a capability through a query.
        if not re.fullmatch(r"/api/v1/[a-z0-9/-]+(?:\?format=(?:json|csv))?", path):
            raise ClientError("Unsupported API path.")
        headers = {"Accept": "application/json", "User-Agent": "OfftargetPred-reference-client/1"}
        if credentials:
            checked = validate_credentials(credentials, self.origin.startswith("http:"))
            if checked["api_origin"] != self.origin:
                raise ClientError("Credentials belong to a different API origin.")
            headers["Authorization"] = "Bearer " + checked["token"]
        body = json.dumps(payload).encode("utf-8") if payload is not None else None
        if body is not None:
            if len(body) > 5 * 1024 * 1024:
                raise ClientError("JSON request exceeds the 5 MiB limit.")
            headers["Content-Type"] = "application/json"
        request = Request(self.origin + path, data=body, headers=headers, method=method)
        budget = min(self.timeout, timeout) if timeout is not None else self.timeout
        deadline = time.monotonic() + budget
        try:
            with self.opener.open(request, timeout=budget) as response:
                # Defense in depth for custom transports and unexpected redirect behavior.
                if response.geturl() != request.full_url:
                    raise ClientError("Redirect refused; no alternate endpoint will be contacted.")
                maximum = MAX_DOWNLOAD if sink else 2 * 1024 * 1024
                total, chunks = 0, []
                while True:
                    chunk = response.read(64 * 1024)
                    if time.monotonic() > deadline:
                        raise TimeoutError
                    if not chunk:
                        break
                    total += len(chunk)
                    if total > maximum:
                        raise ClientError("Response exceeded the client's bounded download limit.")
                    if sink:
                        sink.write(chunk)
                    else:
                        chunks.append(chunk)
                if sink:
                    return total
                try:
                    value = json.loads(b"".join(chunks))
                    if not isinstance(value, dict):
                        raise ValueError
                    return value
                except ValueError:
                    raise ClientError("API returned an invalid JSON document.") from None
        except HTTPError as error:
            status, retry = error.code, retry_seconds(error.headers.get("Retry-After"))
            error.close()
            if 300 <= status < 400:
                raise ClientError("Redirect refused. Verify the API origin before trying again.") from None
            raise APIError(status, retry) from None
        except (URLError, OSError, TimeoutError):
            detail = " The request may have reached the server; do not automatically repeat it." if method != "GET" else " Try the same read again later."
            raise ClientError("Network request failed or timed out." + detail) from None

    def submit(self, payload: dict, credentials_path: Path) -> dict:
        # A pending marker remains after an uncertain response. We never silently retry POST.
        with private_create(credentials_path) as handle:
            handle.write(json.dumps({"api_origin": self.origin, "pending": True}).encode())
            handle.flush()
            os.fsync(handle.fileno())
            result = self.request("POST", "/api/v1/jobs", payload=payload)
            saved = validate_credentials({**result, "api_origin": self.origin}, self.origin.startswith("http:"))
            handle.seek(0)
            handle.write(json.dumps(saved, indent=2).encode() + b"\n")
            handle.truncate()
            handle.flush()
            os.fsync(handle.fileno())
        return {key: value for key, value in result.items() if key != "token"}

    def job(self, credentials: dict, action="status", *, sink=None, format="json"):
        if action not in {"status", "cancel", "delete", "download"} or format not in {"csv", "json"}:
            raise ClientError("Unsupported job operation.")
        checked = validate_credentials(credentials, self.origin.startswith("http:"))
        path = "/api/v1/jobs/" + checked["id"]
        method = {"status": "GET", "cancel": "POST", "delete": "DELETE", "download": "GET"}[action]
        if action == "cancel":
            path += "/cancel"
        elif action == "download":
            if sink is None:
                raise ClientError("Downloads require a binary destination.")
            path += "/download?format=" + format
        return self.request(method, path, credentials=checked, sink=sink)

    def poll(self, credentials: dict, *, interval=3.0, max_wait=1000.0, sleep=time.sleep, clock=time.monotonic):
        if not 1 <= interval <= 120 or not 0 < max_wait <= 86400:
            raise ClientError("Poll interval must be 1–120 seconds; wait must be at most 24 hours.")
        checked = validate_credentials(credentials, self.origin.startswith("http:"))
        deadline = clock() + max_wait
        while clock() < deadline:
            wait = interval
            try:
                state = self.request("GET", "/api/v1/jobs/" + checked["id"], credentials=checked,
                                     timeout=max(0.01, deadline - clock()))
                if state.get("status") in TERMINAL:
                    return state
            except APIError as error:
                if error.status != 429:
                    raise
                wait = max(interval, error.retry_after or 60)
            remaining = deadline - clock()
            if wait >= remaining:
                break
            sleep(wait)
        raise ClientError("Polling time limit reached. The job was not cancelled; use status/poll with the saved file later.")


def recover(link: str, origin: str) -> dict:
    try:
        parsed = urlsplit(link.strip())
        parts = parse_qs(parsed.fragment, strict_parsing=True)
        if parsed.scheme not in {"https", "http"} or not parsed.netloc or set(parts) != {"job", "token"} or any(len(v) != 1 for v in parts.values()):
            raise ValueError
        return validate_credentials({"id": parts["job"][0], "token": parts["token"][0], "api_origin": origin}, origin.startswith("http:"))
    except ValueError:
        raise ClientError("Invalid private recovery link.") from None


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--api", help="HTTPS API origin; defaults to the public service for new jobs, or the saved origin for existing jobs")
    parser.add_argument("--allow-local-http", action="store_true", help="Permit HTTP only for loopback development")
    parser.add_argument("--timeout", type=float, default=30)
    sub = parser.add_subparsers(dest="command", required=True)
    for command in ("health", "capabilities"):
        sub.add_parser(command)
    submit = sub.add_parser("submit", help="Submit a JSON request once and save its private capability")
    submit.add_argument("request", type=Path)
    submit.add_argument("--credentials", type=Path, required=True)
    recovery = sub.add_parser("recover", help="Paste a private browser recovery link without echoing it")
    recovery.add_argument("--credentials", type=Path, required=True)
    for command in ("status", "poll", "cancel", "delete", "download"):
        child = sub.add_parser(command)
        child.add_argument("--credentials", type=Path, required=True)
        if command == "poll":
            child.add_argument("--interval", type=float, default=3)
            child.add_argument("--max-wait", type=float, default=1000)
        if command == "download":
            child.add_argument("--format", choices=("csv", "json"), default="json")
            child.add_argument("--output", type=Path, required=True)
    reference = sub.add_parser("reference", help="Run a bounded public reference helper from a JSON file")
    reference.add_argument("helper", choices=("resolve-guide", "discover-guides", "discover-genes", "reference-context"))
    reference.add_argument("request", type=Path)
    args = parser.parse_args(argv)
    credentials, destination = None, None
    try:
        if args.command in {"status", "poll", "cancel", "delete", "download"}:
            credentials = load_credentials(args.credentials, args.allow_local_http)
        origin = args.api or (credentials["api_origin"] if credentials else DEFAULT_API)
        client = Client(origin, allow_local_http=args.allow_local_http, timeout=args.timeout)
        if credentials and credentials["api_origin"] != client.origin:
            raise ClientError("--api conflicts with the origin in the private credentials file.")
        if args.command in {"submit", "reference"}:
            with args.request.open("rb") as handle:
                raw = handle.read(5 * 1024 * 1024 + 1)
            if len(raw) > 5 * 1024 * 1024:
                raise ClientError("Request file exceeds 5 MiB.")
            payload = json.loads(raw)
            if not isinstance(payload, dict):
                raise ClientError("Request file must contain one JSON object.")
            result = client.submit(payload, args.credentials) if args.command == "submit" else client.request("POST", "/api/v1/" + args.helper, payload=payload)
        elif args.command == "recover":
            if not sys.stdin.isatty():
                raise ClientError("Recovery requires an interactive terminal so the link is not echoed or logged.")
            value = recover(getpass.getpass("Paste private recovery link (hidden): "), client.origin)
            with private_create(args.credentials) as handle:
                handle.write(json.dumps(value, indent=2).encode() + b"\n")
            result = {"id": value["id"], "saved": True}
        elif args.command == "download":
            with private_create(args.output) as handle:
                destination = args.output
                count = client.job(credentials, "download", sink=handle, format=args.format)
            destination = None
            result = {"downloaded_bytes": count, "format": args.format}
        elif args.command == "poll":
            result = client.poll(credentials, interval=args.interval, max_wait=args.max_wait)
        elif args.command in {"health", "capabilities"}:
            result = client.request("GET", "/api/v1/" + args.command)
        else:
            result = client.job(credentials, args.command)
        print(json.dumps(result, indent=2))
        return 1 if result.get("status") in {"failed", "cancelled"} else 0
    except (ClientError, OSError, ValueError) as error:
        if destination:
            destination.unlink(missing_ok=True)
        # Never print raw transport exceptions, malformed JSON or response bodies.
        print(str(error) if isinstance(error, ClientError) else "Cannot read or write the requested local file.", file=sys.stderr)
        return 2
    except KeyboardInterrupt:
        if destination:
            destination.unlink(missing_ok=True)
        print("Interrupted. A submitted job continues; recover it using the private credentials file.", file=sys.stderr)
        return 130


if __name__ == "__main__":
    raise SystemExit(main())
