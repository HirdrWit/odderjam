"""Snapshot access with a disk cache so UI polling never spends API credits.

Live fetches only happen when the cache is older than ODDS_CACHE_MINUTES
(default 120) or when refresh() is called explicitly.
"""
import json
import os
import threading
import time
from pathlib import Path

# Versioned so a cache written in an older event shape is never read back.
CACHE = Path(__file__).resolve().parent.parent.parent / ".odds_cache.v2.json"
_lock = threading.Lock()
# Called with each newly fetched live snapshot (see on_fetch). Never causes a fetch itself.
_listeners: list = []


def on_fetch(fn) -> None:
    """Register fn(events) to run after every successful live fetch."""
    if fn not in _listeners:
        _listeners.append(fn)


def off_fetch(fn) -> None:
    if fn in _listeners:
        _listeners.remove(fn)


def _fetched(data: list[dict]) -> None:
    for fn in list(_listeners):
        threading.Thread(target=fn, args=(data,), daemon=True).start()


def _live() -> bool:
    return bool(os.environ.get("ODDS_API_KEY"))


def _ttl() -> float:
    return float(os.environ.get("ODDS_CACHE_MINUTES", "120")) * 60


def _fetch() -> list[dict]:
    from .theoddsapi import snapshot
    return snapshot()


def cache_info() -> dict:
    meta = CACHE.parent / ".odds_meta.json"
    info = {"live": _live(), "age_seconds": None, "ttl_seconds": _ttl()}
    if CACHE.exists():
        info["age_seconds"] = time.time() - CACHE.stat().st_mtime
    if meta.exists():
        info.update(json.loads(meta.read_text()))
    return info


def peek_snapshot() -> list[dict]:
    """The latest snapshot already on hand (mock data or the disk cache). Never fetches."""
    if not _live():
        from .mock import snapshot
        return snapshot()
    with _lock:
        return json.loads(CACHE.read_text()) if CACHE.exists() else []


def get_snapshot(force: bool = False) -> list[dict]:
    if not _live():
        from .mock import snapshot
        return snapshot()
    with _lock:
        fresh = CACHE.exists() and time.time() - CACHE.stat().st_mtime < _ttl()
        if fresh and not force:
            return json.loads(CACHE.read_text())
        try:
            data = _fetch()
        except Exception:
            if CACHE.exists():  # keep serving stale data rather than failing
                return json.loads(CACHE.read_text())
            raise
        if data:
            CACHE.write_text(json.dumps(data))
            _fetched(data)
        elif CACHE.exists():
            return json.loads(CACHE.read_text())
        return data
