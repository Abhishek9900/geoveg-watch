"""
Per-session, in-memory cache for computed year readings.

Deliberately NOT persisted to disk and NOT shared across sessions: each browser
session gets its own isolated cache namespace (keyed by a session id the frontend
generates and sends per request), so concurrent users never see each other's data
and a server restart simply clears everything. This trades "instant for everyone"
for "simple and correct under concurrent multi-user load," per product decision.
"""

from __future__ import annotations

import time
from collections import OrderedDict
from threading import Lock

from app.models.schemas import YearReading

_TTL_SECONDS = 60 * 30  # 30 minutes of inactivity before a session's cache entries expire
_MAX_SESSIONS = 500  # bound memory use; oldest sessions are evicted first
_MAX_ENTRIES_PER_SESSION = 200

_lock = Lock()
_sessions: "OrderedDict[str, OrderedDict[str, tuple[float, YearReading]]]" = OrderedDict()


def _evict_expired_locked(session_id: str) -> None:
    bucket = _sessions.get(session_id)
    if not bucket:
        return
    now = time.time()
    expired_keys = [k for k, (ts, _) in bucket.items() if now - ts > _TTL_SECONDS]
    for k in expired_keys:
        del bucket[k]


def get_cached(session_id: str, key: str) -> YearReading | None:
    with _lock:
        bucket = _sessions.get(session_id)
        if not bucket:
            return None
        _evict_expired_locked(session_id)
        entry = bucket.get(key)
        if not entry:
            return None
        _sessions.move_to_end(session_id)
        return entry[1]


def set_cached(session_id: str, key: str, value: YearReading) -> None:
    with _lock:
        bucket = _sessions.setdefault(session_id, OrderedDict())
        bucket[key] = (time.time(), value)
        bucket.move_to_end(key)
        if len(bucket) > _MAX_ENTRIES_PER_SESSION:
            bucket.popitem(last=False)
        _sessions.move_to_end(session_id)
        while len(_sessions) > _MAX_SESSIONS:
            _sessions.popitem(last=False)
