"""Reference client contracts; no model files, real jobs or outside requests."""
import importlib.util
import io
import json
import os
from pathlib import Path
from urllib.error import HTTPError, URLError

import pytest

SPEC = importlib.util.spec_from_file_location("reference_client", Path(__file__).parents[1] / "client/offtargetpred_client.py")
client = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(client)
ORIGIN = "https://api.example.test"
CREDS = {"id": "12345678-1234-1234-1234-123456789abc", "token": "x" * 43, "api_origin": ORIGIN}


class Response(io.BytesIO):
    def __init__(self, value, url):
        super().__init__(value if isinstance(value, bytes) else json.dumps(value).encode())
        self.url = url

    def geturl(self):
        return self.url


class Transport:
    def __init__(self, *items):
        self.items = list(items)
        self.requests = []

    def open(self, request, timeout):
        self.requests.append((request, timeout))
        value = self.items.pop(0)
        if isinstance(value, Exception):
            raise value
        return value if isinstance(value, Response) else Response(value, request.full_url)


def api_error(status, retry=None):
    return HTTPError(ORIGIN, status, "unsafe body must never print", {"Retry-After": retry} if retry else {}, io.BytesIO(CREDS["token"].encode()))


@pytest.mark.parametrize("origin", ["http://api.example.test", "https://u:p@api.example.test", ORIGIN + "/api", ORIGIN + "?token=secret", "file:///tmp/a", ORIGIN + "#secret", "https://example.test\n", "https://example.test:0"])
def test_origin_rejects_unsafe_endpoint(origin):
    with pytest.raises(client.ClientError):
        client.Client(origin, allow_local_http=True)


@pytest.mark.parametrize("origin", ["http://127.0.0.1:8020", "http://[::1]:8020", "http://localhost:8020"])
def test_explicit_loopback_exception(origin):
    with pytest.raises(client.ClientError):
        client.Client(origin)
    assert client.Client(origin, allow_local_http=True).origin == origin


def test_submit_reserves_private_file_and_hides_capability(tmp_path):
    path = tmp_path / "private.json"
    transport = Transport({**CREDS, "status": "queued"})
    result = client.Client(ORIGIN, opener=transport).submit({"mode": "pairs", "input": "a"}, path)
    assert "token" not in result
    assert json.loads(path.read_text()) == CREDS
    assert path.stat().st_mode & 0o777 == 0o600
    request, timeout = transport.requests[0]
    assert timeout == 30 and request.method == "POST"
    assert not request.has_header("Authorization")
    assert client.load_credentials(path) == CREDS
    with pytest.raises(client.ClientError):
        client.Client(ORIGIN, opener=transport).submit({}, path)
    assert len(transport.requests) == 1


def test_uncertain_post_never_retried_and_marker_remains(tmp_path):
    transport = Transport(URLError("credential secret"))
    path = tmp_path / "private.json"
    with pytest.raises(client.ClientError, match="do not automatically repeat"):
        client.Client(ORIGIN, opener=transport).submit({}, path)
    assert len(transport.requests) == 1
    assert json.loads(path.read_text())["pending"] is True
    with pytest.raises(client.ClientError, match="incomplete"):
        client.load_credentials(path)


def test_reject_symlink_public_permissions_and_bad_token(tmp_path):
    path = tmp_path / "private.json"
    path.write_text(json.dumps(CREDS))
    os.chmod(path, 0o644)
    with pytest.raises(client.ClientError, match="0600"):
        client.load_credentials(path)
    os.chmod(path, 0o600)
    link = tmp_path / "link"
    link.symlink_to(path)
    with pytest.raises(client.ClientError):
        client.load_credentials(link)
    with pytest.raises(client.ClientError):
        client.private_create(link)
    with pytest.raises(client.ClientError):
        client.validate_credentials({**CREDS, "token": "x\r\nAuthorization:"})


@pytest.mark.parametrize("action,method,suffix", [("status", "GET", ""), ("cancel", "POST", "/cancel"), ("delete", "DELETE", "")])
def test_job_contract_uses_header_and_exact_origin(action, method, suffix):
    transport = Transport({"status": "completed"})
    cli = client.Client(ORIGIN, opener=transport)
    cli.job(CREDS, action)
    request, _ = transport.requests[0]
    assert request.method == method
    assert request.full_url == ORIGIN + "/api/v1/jobs/" + CREDS["id"] + suffix
    assert CREDS["token"] not in request.full_url
    assert request.get_header("Authorization") == "Bearer " + CREDS["token"]
    with pytest.raises(client.ClientError, match="different API origin"):
        cli.job({**CREDS, "api_origin": "https://other.test"})
    assert len(transport.requests) == 1


@pytest.mark.parametrize("format,payload", [("csv", b'id,target\r\n"a,b",ACGT\r\n'), ("json", b'{"metadata":{"name":"\xc3\xa9"},"rows":[]}')])
def test_download_exact_bytes(format, payload):
    transport = Transport(payload)
    sink = io.BytesIO()
    count = client.Client(ORIGIN, opener=transport).job(CREDS, "download", sink=sink, format=format)
    assert sink.getvalue() == payload and count == len(payload)
    assert transport.requests[0][0].full_url.endswith("?format=" + format)


@pytest.mark.parametrize("status", [301, 302, 307, 308])
def test_redirect_refusal(status):
    transport = Transport(api_error(status))
    with pytest.raises(client.ClientError, match="Redirect refused"):
        client.Client(ORIGIN, opener=transport).job(CREDS)
    assert len(transport.requests) == 1
    assert client.NoRedirects().redirect_request(None, None, status, "", {}, "https://attacker.test") is None


def test_expiry_has_safe_actionable_error():
    with pytest.raises(client.APIError, match="expired") as caught:
        client.Client(ORIGIN, opener=Transport(api_error(404))).job(CREDS)
    assert caught.value.status == 404
    assert CREDS["token"] not in str(caught.value)


def test_poll_honors_retry_after_and_stops_at_completion():
    transport = Transport(api_error(429, "60"), {"status": "running"}, {"status": "completed"})
    now, pauses = [0.0], []

    def sleep(seconds):
        pauses.append(seconds)
        now[0] += seconds

    result = client.Client(ORIGIN, opener=transport).poll(CREDS, max_wait=100, clock=lambda: now[0], sleep=sleep)
    assert result["status"] == "completed" and pauses == [60, 3]
    assert all(request.method == "GET" for request, _ in transport.requests)


def test_poll_time_bound_and_no_automatic_post_retry():
    transport = Transport(api_error(429, "600"))
    with pytest.raises(client.ClientError, match="Polling time limit"):
        client.Client(ORIGIN, opener=transport).poll(CREDS, max_wait=1, sleep=lambda _: pytest.fail("should not sleep"))
    assert len(transport.requests) == 1
    transport = Transport(api_error(429, "60"))
    with pytest.raises(client.APIError) as caught:
        client.Client(ORIGIN, opener=transport).job(CREDS, "cancel")
    assert caught.value.retry_after == 60 and len(transport.requests) == 1


def test_recovery_keeps_secrets_out_of_url_requests():
    link = "https://frontend.test/repo/#job=" + CREDS["id"] + "&token=" + CREDS["token"]
    assert client.recover(link, ORIGIN) == CREDS
    with pytest.raises(client.ClientError):
        client.recover(link + "&token=duplicate", ORIGIN)
    with pytest.raises(client.ClientError):
        client.recover(link + "&unexpected=x", ORIGIN)


def test_cli_failure_removes_partial_download(tmp_path, monkeypatch, capsys):
    credentials = tmp_path / "credentials.json"
    credentials.write_text(json.dumps(CREDS))
    os.chmod(credentials, 0o600)
    output = tmp_path / "result.json"

    def fail(self, *args, **kwargs):
        kwargs["sink"].write(b"partial")
        raise client.ClientError("Network request failed")

    monkeypatch.setattr(client.Client, "job", fail)
    assert client.main(["download", "--credentials", str(credentials), "--output", str(output)]) == 2
    assert not output.exists()
    assert CREDS["token"] not in capsys.readouterr().err


def test_response_limits_and_malformed_json(monkeypatch):
    with pytest.raises(client.ClientError, match="invalid JSON"):
        client.Client(ORIGIN, opener=Transport(b"not json")).job(CREDS)
    monkeypatch.setattr(client, "MAX_DOWNLOAD", 2)
    with pytest.raises(client.ClientError, match="bounded download"):
        client.Client(ORIGIN, opener=Transport(b"123")).job(CREDS, "download", sink=io.BytesIO())


def test_retry_after_numeric_date_invalid():
    assert client.retry_seconds("60") == 60
    assert client.retry_seconds("Wed, 21 Oct 2015 07:28:00 GMT") == 0
    assert client.retry_seconds("bad") is None


def test_path_injection_and_cross_origin_transport_rejected():
    cli = client.Client(ORIGIN, opener=Transport(Response({}, "https://other.test")))
    with pytest.raises(client.ClientError, match="Unsupported API path"):
        cli.request("GET", "//other.test/path")
    with pytest.raises(client.ClientError, match="Redirect refused"):
        cli.job(CREDS)
