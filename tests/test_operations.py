"""Operational probes are tested without contacting services or reading job data."""
import importlib.util
import json
from pathlib import Path
import stat
import subprocess

import pytest

ROOT = Path(__file__).resolve().parents[1]


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, ROOT / "deploy" / filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


health = load("operations_healthcheck", "healthcheck.py")
backup = load("operations_backup", "backup-configuration.py")


def test_http_200_without_worker_is_not_ready():
    assert health.parse_health('{"status":"ok","worker":{"available":false}}')["status"] == "fail"
    assert health.parse_health('{"status":"ok","worker":{"available":true},"release_id":"abc"}')["status"] == "pass"


def test_health_response_drops_arbitrary_fields_and_release_injection():
    value = health.parse_health(json.dumps({"status": "ok", "worker": {"available": True},
                                          "release_id": "private\nsecret", "sequence": "PRIVATE_SEQUENCE", "token": "SECRET"}))
    assert value == {"status": "pass", "worker_available": True, "release": "unknown"}


def test_guarded_timeout_does_not_expose_command_or_stderr():
    def fail():
        raise subprocess.TimeoutExpired(["secret-command", "PRIVATE"], 3, stderr="TOKEN")
    assert health.guarded(fail) == {"status": "fail", "reason": "timeout"}


def test_state_is_private_and_only_status_transitions_count(tmp_path):
    path = tmp_path / "health.json"
    state = {"ready": True, "checks": {"storage": {"status": "pass", "free_gib": 100}}}
    assert health.save_state(state, path)
    state["checks"]["storage"]["free_gib"] = 99
    assert not health.save_state(state, path)
    state["checks"]["storage"]["status"] = "fail"
    assert health.save_state(state, path)
    assert stat.S_IMODE(path.stat().st_mode) == 0o600


def test_state_refuses_symlink(tmp_path):
    original = tmp_path / "original"
    original.write_text("{}")
    link = tmp_path / "link"
    link.symlink_to(original)
    with pytest.raises(ValueError):
        health.save_state({}, link)
    assert original.read_text() == "{}"


@pytest.fixture
def bundle(tmp_path):
    root = tmp_path / "volume"
    root.mkdir()
    release = root / "release"
    release.mkdir()
    modeldir = root / "models"
    models = {}
    for name in ("k1", "k2", "k3"):
        path = modeldir / name / "model.ckpt"
        path.parent.mkdir(parents=True)
        path.write_bytes(b"PRIVATE_CHECKPOINT_BYTES")
        models[name] = {"path": name + "/model.ckpt", "sha256": backup.digest(path)}
    (release / "models.manifest.json").write_text(json.dumps({"models": models}))
    jobs = root / "data"
    jobs.mkdir()
    (jobs / "private-job.json").write_text('{"sequence":"PRIVATE_SEQUENCE","token":"PRIVATE_TOKEN"}')
    environment = tmp_path / "runtime.env"
    environment.write_text(f"OFFTARGET_MODEL_DIR={modeldir}\nOFFTARGET_DATA_DIR={jobs}\nOFFTARGET_RELEASE_ID={'a' * 40}\nOFFTARGET_DEVICE=cuda\nAUTH_TOKEN=PRIVATE_SECRET\nTAILSCALE_AUTH_KEY=PRIVATE_KEY\n")
    return backup.create_bundle(root, release, environment, True)


def test_bundle_never_copies_private_bytes_or_unknown_settings(bundle):
    encoded = json.dumps(bundle)
    for forbidden in ("PRIVATE_CHECKPOINT_BYTES", "PRIVATE_SEQUENCE", "PRIVATE_TOKEN", "PRIVATE_SECRET", "PRIVATE_KEY", "AUTH_TOKEN"):
        assert forbidden not in encoded
    assert bundle["payload"]["omitted_environment_entries"] == 2
    assert all(item["matches"] is True for item in bundle["payload"]["artifacts"])


def test_restore_only_creates_fixed_private_files_in_new_directory(bundle, tmp_path):
    destination = tmp_path / "restore"
    backup.restore(bundle, destination)
    assert sorted(path.name for path in destination.iterdir()) == ["RESTORE.txt", "artifact-verification.json", "runtime.env"]
    assert stat.S_IMODE(destination.stat().st_mode) == 0o700
    assert all(stat.S_IMODE(path.stat().st_mode) == 0o600 for path in destination.iterdir())
    with pytest.raises(FileExistsError):
        backup.restore(bundle, destination)


def test_corrupt_bundle_does_not_create_restore_directory(bundle, tmp_path):
    bundle["payload"]["release_id"] = "b" * 40
    destination = tmp_path / "restore"
    with pytest.raises(ValueError, match="checksum"):
        backup.restore(bundle, destination)
    assert not destination.exists()


@pytest.mark.parametrize("value", ["/etc/shadow", "/srv/crispert/../private", "/srv/crispert/$(secret)", "/srv/crispert/x\nSECRET=abc"])
def test_runtime_config_rejects_escape_and_shell_injection(value):
    config = {"OFFTARGET_RELEASE_ID": "a" * 40, "OFFTARGET_DEVICE": "cuda", "OFFTARGET_MODEL_DIR": value}
    with pytest.raises(ValueError):
        backup.validate_config(config, Path("/srv/crispert"))
