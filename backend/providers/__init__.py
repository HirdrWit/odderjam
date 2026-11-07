"""Snapshot access with a disk cache so UI polling never spends API credits.

Live fetches only happen when the cache is older than ODDS_CACHE_MINUTES
(default 120) or when refresh() is called explicitly.
"""
import json
import logging
import os
import threading
import time
from pathlib import Path

CACHE = Path(__file__).resolve().parent.parent.parent / ".odds_cache.json"
_lock = threading.Lock()
log = logging.getLogger(__name__)
MOCK_HISTORY_SECONDS = 300  # mock odds change every call; only keep one snapshot per 5 minutes


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


def _store(data: list[dict], min_gap: float = 0) -> None:
    """Save a fetched snapshot to the odds history and fill any closing lines now due.
    Skips the save if the newest stored snapshot is under min_gap seconds old.
    History problems must never stop odds from being served."""
    from datetime import datetime, timedelta, timezone

    from .. import history
    try:
        last = history.last_fetched_at()
        if min_gap and last and last > history.ts(datetime.now(timezone.utc) - timedelta(seconds=min_gap)):
            return
        history.record(data)
        history.capture_closing()
    except Exception:
        log.exception("could not store odds history")


def get_snapshot(force: bool = False) -> list[dict]:
    if not _live():
        from .mock import snapshot
        data = snapshot()
        _store(data, 0 if force else MOCK_HISTORY_SECONDS)
        return data
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
            _store(data)
        elif CACHE.exists():
            return json.loads(CACHE.read_text())
        return data
