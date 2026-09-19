"""Durable bounded queue. Payload files and capabilities never enter logs."""
from contextlib import contextmanager
from datetime import datetime, timezone
import hashlib
import hmac
import json
import os
from pathlib import Path
import secrets
import shutil
import sqlite3
import time
import uuid

from .config import Settings


class QueueFull(Exception):
    pass


class ClientLimit(Exception):
    pass


class StorageFull(Exception):
    pass


class NotFound(Exception):
    pass


def iso(timestamp):
    return datetime.fromtimestamp(timestamp, timezone.utc).isoformat() if timestamp else None


def write_json(path: Path, value):
    """Private atomic writes within a private job directory."""
    temporary = path.with_suffix(path.suffix + ".tmp")
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(descriptor, "w") as handle:
        json.dump(value, handle, separators=(",", ":"), allow_nan=False)
        handle.flush()
        os.fsync(handle.fileno())
    temporary.replace(path)


class JobStore:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.root = settings.data_dir
        self.root.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.jobs_root = self.root / "jobs"
        self.jobs_root.mkdir(exist_ok=True, mode=0o700)
        self.database = self.root / "queue.sqlite3"
        with self.connect() as db:
            db.executescript("""
                PRAGMA journal_mode=WAL;
                CREATE TABLE IF NOT EXISTS jobs (
                    id TEXT PRIMARY KEY, token_hash TEXT NOT NULL,
                    client_hash TEXT NOT NULL, status TEXT NOT NULL,
                    mode TEXT NOT NULL, name TEXT NOT NULL, models TEXT NOT NULL,
                    created REAL NOT NULL, started REAL, finished REAL,
                    expires REAL NOT NULL, error TEXT, result_count INTEGER,
                    cancel_requested INTEGER NOT NULL DEFAULT 0,
                    delete_requested INTEGER NOT NULL DEFAULT 0
                );
                CREATE INDEX IF NOT EXISTS jobs_status ON jobs(status, created);
                CREATE INDEX IF NOT EXISTS jobs_client ON jobs(client_hash, created);
                CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS submissions (client_hash TEXT NOT NULL, created REAL NOT NULL);
                CREATE INDEX IF NOT EXISTS submissions_client ON submissions(client_hash, created);
            """)
            db.execute("INSERT OR IGNORE INTO metadata VALUES ('client_salt', ?)", (secrets.token_hex(32),))
            self.salt = db.execute("SELECT value FROM metadata WHERE key='client_salt'").fetchone()[0]
        self.database.chmod(0o600)

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.database, timeout=15)
        db.row_factory = sqlite3.Row
        try:
            yield db
            db.commit()
        except BaseException:
            db.rollback()
            raise
        finally:
            db.close()

    def directory(self, job_id: str) -> Path:
        try:
            if str(uuid.UUID(job_id)) != job_id:
                raise ValueError()
        except (ValueError, AttributeError):
            raise NotFound() from None
        return self.jobs_root / job_id

    def submit(self, payload: dict, client_ip: str, name: str = ""):
        if shutil.disk_usage(self.root).free < self.settings.min_free_bytes:
            raise StorageFull()
        now = time.time()
        client = hmac.new(self.salt.encode(), client_ip.encode(), hashlib.sha256).hexdigest()
        job_id, token = str(uuid.uuid4()), secrets.token_urlsafe(32)
        directory = self.directory(job_id)
        try:
            with self.connect() as db:
                db.execute("BEGIN IMMEDIATE")
                queued = db.execute("SELECT count(*) FROM jobs WHERE status='queued'").fetchone()[0]
                if queued >= self.settings.max_queued:
                    raise QueueFull()
                pending = db.execute("SELECT count(*) FROM jobs WHERE client_hash=? AND status IN ('queued','running')", (client,)).fetchone()[0]
                count = db.execute("SELECT count(*) FROM submissions WHERE client_hash=? AND created>?", (client, now - 3600)).fetchone()[0]
                if pending or count >= self.settings.max_submissions_hour:
                    raise ClientLimit()
                directory.mkdir(mode=0o700)
                write_json(directory / "input.json", payload)
                db.execute("INSERT INTO jobs (id,token_hash,client_hash,status,mode,name,models,created,expires) VALUES (?,?,?,'queued',?,?,?,?,?)", (job_id, hashlib.sha256(token.encode()).hexdigest(), client, payload["mode"], name, json.dumps(payload["models"]), now, now + self.settings.retention_hours * 3600))
                db.execute("INSERT INTO submissions VALUES (?,?)", (client, now))
        except BaseException:
            shutil.rmtree(directory, ignore_errors=True)
            raise
        return {"id": job_id, "token": token, "status": "queued"}

    def get(self, job_id: str):
        self.directory(job_id)
        with self.connect() as db:
            row = db.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone()
        if not row:
            raise NotFound()
        return dict(row)

    def authorize(self, job_id: str, token: str):
        try:
            row = self.get(job_id)
        except NotFound:
            hmac.compare_digest("0" * 64, hashlib.sha256(token.encode()).hexdigest())
            raise
        if row["expires"] < time.time() or row["delete_requested"] or not hmac.compare_digest(row["token_hash"], hashlib.sha256(token.encode()).hexdigest()):
            raise NotFound()
        return row

    def public(self, row):
        return {"id": row["id"], "status": "cancelling" if row["cancel_requested"] and row["status"] == "running" else row["status"], "mode": row["mode"], "name": row["name"], "models": json.loads(row["models"]), "created_at": iso(row["created"]), "started_at": iso(row["started"]), "finished_at": iso(row["finished"]), "expires_at": iso(row["expires"]), "error": row["error"], "result_count": row["result_count"]}

    def claim(self):
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            # The supervisor holds the exclusive worker file lock as well.
            if db.execute("SELECT 1 FROM jobs WHERE status='running'").fetchone():
                return None
            row = db.execute("SELECT id FROM jobs WHERE status='queued' AND expires>? ORDER BY created LIMIT 1", (time.time(),)).fetchone()
            if not row:
                return None
            db.execute("UPDATE jobs SET status='running',started=? WHERE id=?", (time.time(), row[0]))
            return row[0]

    def finish(self, job_id: str, status: str, error=None, count=None):
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("SELECT cancel_requested,delete_requested FROM jobs WHERE id=?", (job_id,)).fetchone()
            if not row:
                return
            if row[0]:
                status, error, count = "cancelled", None, None
            db.execute("UPDATE jobs SET status=?,finished=?,error=?,result_count=? WHERE id=?", (status, time.time(), error, count, job_id))
            deleting = row[1]
        if deleting:
            self.erase(job_id)
        elif status != "completed":
            (self.directory(job_id) / "results.json").unlink(missing_ok=True)

    def cancel(self, job_id: str, delete=False):
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("SELECT status FROM jobs WHERE id=?", (job_id,)).fetchone()
            if not row:
                raise NotFound()
            running = row[0] == "running"
            # A delayed cancel request must never revoke an earlier deletion.
            db.execute("UPDATE jobs SET cancel_requested=1,delete_requested=max(delete_requested,?) WHERE id=?", (int(delete), job_id))
            if row[0] == "queued":
                db.execute("UPDATE jobs SET status='cancelled',finished=? WHERE id=?", (time.time(), job_id))
        if delete and not running:
            self.erase(job_id)
        return running

    def erase(self, job_id: str):
        directory = self.directory(job_id)
        with self.connect() as db:
            db.execute("DELETE FROM jobs WHERE id=? AND status!='running'", (job_id,))
            remains = db.execute("SELECT 1 FROM jobs WHERE id=?", (job_id,)).fetchone()
        if not remains:
            shutil.rmtree(directory, ignore_errors=True)

    def cleanup(self):
        with self.connect() as db:
            rows = db.execute("SELECT id FROM jobs WHERE expires<?", (time.time(),)).fetchall()
            db.execute("DELETE FROM submissions WHERE created<?", (time.time() - 3600,))
        for row in rows:
            try:
                self.cancel(row[0], delete=True)
            except NotFound:
                pass  # A simultaneous user deletion already finished.
        # A process can die after writing a private payload but before committing
        # its queue row, or after removing the row but before unlinking files.
        # Reap only old, well-formed job directories so active submissions cannot
        # race this cleanup path.
        cutoff = time.time() - self.settings.retention_hours * 3600
        with self.connect() as db:
            known = {row[0] for row in db.execute("SELECT id FROM jobs")}
        for directory in self.jobs_root.iterdir():
            try:
                if directory.name in known or directory.is_symlink() or not directory.is_dir():
                    continue
                self.directory(directory.name)
                if directory.stat().st_mtime < cutoff:
                    shutil.rmtree(directory)
            except (NotFound, FileNotFoundError):
                continue

    def recover(self):
        """Called only while holding the exclusive worker lock after restart."""
        with self.connect() as db:
            rows = db.execute("SELECT id FROM jobs WHERE status='running'").fetchall()
        for row in rows:
            self.finish(row[0], "failed", "The worker restarted. Please submit the job again.")

    def heartbeat(self):
        with self.connect() as db:
            db.execute("INSERT OR REPLACE INTO metadata VALUES ('worker_heartbeat', ?)", (str(time.time()),))

    def worker_offline(self):
        with self.connect() as db:
            db.execute("INSERT OR REPLACE INTO metadata VALUES ('worker_heartbeat', '0')")

    def worker_status(self):
        with self.connect() as db:
            row = db.execute("SELECT value FROM metadata WHERE key='worker_heartbeat'").fetchone()
        timestamp = float(row[0]) if row else 0
        return {"available": time.time() - timestamp < self.settings.worker_stale_seconds, "last_heartbeat": iso(timestamp)}
