"""Small, process-local admission bounds for read-only reference helpers."""
from collections import deque
from contextlib import contextmanager
import hashlib
import hmac
import time


class ToolBusy(Exception):
    pass


class ToolAdmission:
    """Called on the API event loop, before entering a worker thread.

    Counts only admitted requests. No raw address or sequence is retained.
    This supplements ingress limits and is intentionally shared across helpers.
    """

    def __init__(self, salt: str, *, concurrent=4, per_minute=30, clients=2048):
        self.salt = salt.encode()
        self.concurrent = concurrent
        self.per_minute = per_minute
        self.clients = clients
        self.active = 0
        self.history = {}

    @contextmanager
    def admit(self, address: str):
        now = time.monotonic()
        for key, times in list(self.history.items()):
            while times and times[0] <= now - 60:
                times.popleft()
            if not times:
                del self.history[key]
        key = hmac.new(self.salt, address.encode(), hashlib.sha256).digest()
        times = self.history.get(key)
        if self.active >= self.concurrent or (times is not None and len(times) >= self.per_minute):
            raise ToolBusy()
        if times is None:
            if len(self.history) >= self.clients:
                raise ToolBusy()
            times = self.history[key] = deque()
        times.append(now)
        self.active += 1
        try:
            yield
        finally:
            self.active -= 1
