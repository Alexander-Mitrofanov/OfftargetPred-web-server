#!/usr/bin/env python3
"""Back up sanitized settings and artifact hashes; restore only into a new directory.

Never copies jobs, sequences, weights, genome bases, SSH keys or Tailscale state.
The JSON checksum detects accidental corruption, not malicious modification.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
from urllib.parse import urlsplit

MAX_JSON = 2 * 1024 * 1024
SHA256 = re.compile(r"^[a-f0-9]{64}$")
RELEASE_ID = re.compile(r"^(?:[a-f0-9]{40}|[a-f0-9]{64}|development|REPLACE_WITH_SOURCE_REVISION)$")
PATH_KEYS = {
    "OFFTARGET_DATA_DIR", "OFFTARGET_MODEL_DIR", "OFFTARGET_CAS_OFFINDER",
    "OFFTARGET_GENOME_DIR", "OFFTARGET_REFERENCE_METADATA", "OFFTARGET_ANNOTATION_DB", "PYTHONPATH",
}
CONFIG_KEYS = PATH_KEYS | {"OFFTARGET_DEVICE", "OFFTARGET_ALLOWED_ORIGINS", "OFFTARGET_RELEASE_ID"}
DEPLOYMENT_FILES = (
    "deploy/offtarget-api.service", "deploy/offtarget-worker.service", "deploy/offtarget-web.nginx",
    "deploy/offtarget-healthcheck.service", "deploy/offtarget-healthcheck.timer", "deploy/healthcheck.py",
    "deploy/backup-configuration.py", "pyproject.toml", "models.manifest.json",
)


def digest(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def canonical(data: dict) -> bytes:
    return json.dumps(data, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode()


def read_json(path: Path) -> dict:
    if path.stat().st_size > MAX_JSON:
        raise ValueError("manifest too large")
    value = json.loads(path.read_text())
    if not isinstance(value, dict):
        raise ValueError("manifest must be an object")
    return value


def validate_config(config: dict, root: Path) -> dict:
    if not isinstance(config, dict) or not set(config) <= CONFIG_KEYS:
        raise ValueError("unexpected runtime settings")
    clean = {}
    for key, value in config.items():
        if not isinstance(value, str) or len(value) > 1024 or any(char in value for char in "\r\n\x00\"'`$\\#\t "):
            raise ValueError("unsafe runtime value")
        if key in PATH_KEYS:
            path = Path(value)
            if not path.is_absolute() or ".." in path.parts or not path.is_relative_to(root):
                raise ValueError("runtime paths must be inside the service volume")
        elif key == "OFFTARGET_RELEASE_ID":
            if not RELEASE_ID.fullmatch(value):
                raise ValueError("invalid release identifier")
        elif key == "OFFTARGET_DEVICE":
            if value not in {"cuda", "cpu"}:
                raise ValueError("unsupported device setting")
        elif key == "OFFTARGET_ALLOWED_ORIGINS":
            for origin in value.split(","):
                url = urlsplit(origin)
                if url.scheme != "https" or not url.hostname or url.netloc != url.hostname or url.path or url.query or url.fragment:
                    raise ValueError("allowed origins must be plain HTTPS hostnames")
        clean[key] = value
    required = {"OFFTARGET_RELEASE_ID", "OFFTARGET_MODEL_DIR", "OFFTARGET_DEVICE"}
    if not required <= clean.keys():
        raise ValueError("required runtime settings are missing")
    return clean


def read_config(path: Path, root: Path) -> tuple[dict, int]:
    if path.stat().st_size > 65536:
        raise ValueError("environment file too large")
    values, omitted = {}, 0
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        key, separator, value = line.partition("=")
        if separator and key in CONFIG_KEYS:
            if key in values:
                raise ValueError("duplicate runtime setting")
            values[key] = value
        else:
            omitted += 1
    return validate_config(values, root), omitted


def artifact(path: Path, role: str, expected: str | None, verify: bool) -> dict:
    if expected is not None and not SHA256.fullmatch(expected):
        raise ValueError("invalid expected checksum")
    present = path.is_file()
    actual = digest(path) if verify and present else None
    return {"role": role, "expected_sha256": expected, "present": present,
            "size_bytes": path.stat().st_size if present else None,
            "verified_sha256": actual, "matches": actual == expected if actual and expected else None}


def create_bundle(root: Path, release: Path, environment: Path, verify: bool) -> dict:
    config, omitted = read_config(environment, root)
    model_manifest = read_json(release / "models.manifest.json")
    models = model_manifest.get("models", {})
    if set(models) != {"k1", "k2", "k3"}:
        raise ValueError("expected three checkpoint identities")
    artifacts = []
    for name in ("k1", "k2", "k3"):
        if models[name].get("path") != name + "/model.ckpt":
            raise ValueError("unexpected checkpoint path")
        artifacts.append(artifact(Path(config["OFFTARGET_MODEL_DIR"]) / name / "model.ckpt", "model_" + name, models[name]["sha256"], verify))
    metadata_file = config.get("OFFTARGET_REFERENCE_METADATA")
    if metadata_file:
        metadata = read_json(Path(metadata_file))
        filename = metadata.get("filename")
        if metadata.get("assembly") != "GRCh38" or not isinstance(filename, str) or Path(filename).name != filename or not config.get("OFFTARGET_GENOME_DIR"):
            raise ValueError("unexpected reference metadata")
        reference = Path(config["OFFTARGET_GENOME_DIR"]) / filename
        artifacts.append(artifact(reference, "reference_fasta", metadata["sha256"], verify))
        artifacts.append(artifact(Path(metadata_file), "reference_manifest", digest(Path(metadata_file)), verify))
        for suffix, role in ((".fai", "fasta_index"), (".fai.json", "fasta_index_manifest")):
            path = Path(str(reference) + suffix)
            if path.is_file():
                artifacts.append(artifact(path, role, digest(path), verify))
    annotation = config.get("OFFTARGET_ANNOTATION_DB")
    if annotation:
        path = Path(annotation)
        manifest_path = path.with_suffix(".json")
        metadata = read_json(manifest_path)
        # Producer metadata keys may evolve; an absent recognized checksum fails verification.
        expected = metadata.get("sha256") or metadata.get("index_sha256") or metadata.get("database_sha256")
        if not isinstance(expected, str):
            raise ValueError("annotation manifest lacks a recognized database checksum")
        artifacts.append(artifact(path, "annotation_index", expected, verify))
        artifacts.append(artifact(manifest_path, "annotation_manifest", digest(manifest_path), verify))
    if config.get("OFFTARGET_CAS_OFFINDER"):
        path = Path(config["OFFTARGET_CAS_OFFINDER"])
        artifacts.append(artifact(path, "cas_offinder", digest(path) if path.is_file() else None, verify))
    files = {name: digest(release / name) for name in DEPLOYMENT_FILES if (release / name).is_file()}
    payload = {
        "schema_version": 1, "created_at": datetime.now(timezone.utc).isoformat(),
        "service_root": str(root), "release_id": config["OFFTARGET_RELEASE_ID"],
        "runtime_config": config, "omitted_environment_entries": omitted,
        "source_file_sha256": files, "artifacts": artifacts, "artifact_bytes_verified": verify,
        "excludes": ["user_jobs", "user_sequences", "model_weights", "genome_bases", "credentials", "tailscale_identity", "ssh_keys"],
    }
    return {"payload": payload, "payload_sha256": hashlib.sha256(canonical(payload)).hexdigest()}


def validate_bundle(bundle: dict) -> dict:
    if set(bundle) != {"payload", "payload_sha256"} or not isinstance(bundle.get("payload"), dict):
        raise ValueError("invalid bundle shape")
    payload = bundle["payload"]
    if hashlib.sha256(canonical(payload)).hexdigest() != bundle.get("payload_sha256"):
        raise ValueError("bundle checksum mismatch")
    if payload.get("schema_version") != 1:
        raise ValueError("unsupported bundle version")
    root_value = payload.get("service_root")
    if not isinstance(root_value, str) or not Path(root_value).is_absolute() or ".." in Path(root_value).parts:
        raise ValueError("invalid service root")
    validate_config(payload.get("runtime_config"), Path(root_value))
    if payload.get("release_id") != payload["runtime_config"]["OFFTARGET_RELEASE_ID"]:
        raise ValueError("inconsistent release identity")
    hashes = payload.get("source_file_sha256")
    if not isinstance(hashes, dict) or not set(hashes) <= set(DEPLOYMENT_FILES) or not all(isinstance(value, str) and SHA256.fullmatch(value) for value in hashes.values()):
        raise ValueError("invalid source hashes")
    items = payload.get("artifacts")
    roles = {"model_k1", "model_k2", "model_k3", "reference_fasta", "reference_manifest", "fasta_index", "fasta_index_manifest", "annotation_index", "annotation_manifest", "cas_offinder"}
    if not isinstance(items, list) or len(items) > 10:
        raise ValueError("invalid artifact list")
    for item in items:
        if not isinstance(item, dict) or item.get("role") not in roles:
            raise ValueError("invalid artifact role")
        for field in ("expected_sha256", "verified_sha256"):
            if item.get(field) is not None and (not isinstance(item[field], str) or not SHA256.fullmatch(item[field])):
                raise ValueError("invalid artifact checksum")
    return payload


def write_new(path: Path, data: str) -> None:
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "w") as stream:
        stream.write(data)
        stream.flush()
        os.fsync(stream.fileno())


def restore(bundle: dict, destination: Path) -> None:
    payload = validate_bundle(bundle)
    # No privileged installation or archive extraction: exactly three fixed files.
    destination.mkdir(mode=0o700, parents=False, exist_ok=False)
    config = payload["runtime_config"]
    write_new(destination / "runtime.env", "".join(key + "=" + config[key] + "\n" for key in sorted(config)))
    write_new(destination / "artifact-verification.json", json.dumps(payload, indent=2, sort_keys=True) + "\n")
    write_new(destination / "RESTORE.txt", "Staged configuration only. Nothing has been installed.\nCheck out release " + payload["release_id"] + ".\nRestore authorized model/reference artifacts separately and verify their SHA-256.\nReview runtime.env and deploy units before activating. User jobs were not backed up.\n")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="action", required=True)
    backup = sub.add_parser("create")
    backup.add_argument("--root", type=Path, default=Path("/srv/crispert"))
    backup.add_argument("--release", type=Path, default=Path("/srv/crispert/current"))
    backup.add_argument("--environment", type=Path, default=Path("/etc/offtarget-web/runtime.env"))
    backup.add_argument("--verify-artifacts", action="store_true", help="read all checkpoint/reference/index bytes to verify hashes")
    backup.add_argument("--output", type=Path, required=True)
    unpack = sub.add_parser("restore")
    unpack.add_argument("bundle", type=Path)
    unpack.add_argument("--destination", type=Path, required=True, help="new, absent directory; never a live service directory")
    args = parser.parse_args()
    try:
        if args.action == "create":
            bundle = create_bundle(args.root, args.release, args.environment, args.verify_artifacts)
            validate_bundle(bundle)
            write_new(args.output, json.dumps(bundle, indent=2, sort_keys=True) + "\n")
            failures = [item["role"] for item in bundle["payload"]["artifacts"] if not item["present"] or (args.verify_artifacts and item["matches"] is not True)]
            print(json.dumps({"created": True, "artifact_bytes_verified": args.verify_artifacts, "artifact_failures": failures}))
            return 1 if failures else 0
        restore(read_json(args.bundle), args.destination)
        print("Configuration restored to the new staging directory; no live files changed.")
        return 0
    except (OSError, ValueError, KeyError, TypeError):
        # Avoid leaking malformed environment values or private paths in tracebacks.
        print("Configuration operation failed: invalid input, missing artifact or unsafe destination.")
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
