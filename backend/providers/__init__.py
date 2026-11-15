"""Snapshot access with a disk cache so UI polling never spends API credits.

Live fetches only happen when the cache is older than ODDS_CACHE_MINUTES
(default 120) or when refresh() is called explicitly.
"""
import json
import os
import threading
import time
from pathlib import Path

# Versioned so a cache written in an older event shape is never read back (v3: events carry "updated").
CACHE = Path(__file__).resolve().parent.parent.parent / ".odds_cache.v3.json"
LIVE_CACHE = CACHE.parent / ".odds_cache.live.json"
BUDGET_FILE = CACHE.parent / ".odds_cache.budget.json"
_lock = threading.Lock()

# Live (in-play) refresh settings. Off by default: every live fetch spends API credits.
LIVE_DEFAULTS = {"enabled": False, "interval_seconds": 30.0, "credits_per_hour": 60.0, "max_price_age": 60.0}
_live_config = dict(LIVE_DEFAULTS)
_budget = None


def _live() -> bool:
    return bool(os.environ.get("ODDS_API_KEY"))


def _ttl() -> float:
    return float(os.environ.get("ODDS_CACHE_MINUTES", "120")) * 60


def _fetch() -> list[dict]:
    from .theoddsapi import snapshot
    return snapshot()


def _now() -> float:
    return time.time()


def _fetch_live() -> list[dict]:
    from .theoddsapi import snapshot
    return snapshot(live_only=True)


def _fetch_cost() -> int:
    from .theoddsapi import fetch_cost
    return fetch_cost()


def _remaining() -> float | None:
    """API credits left on the key, from the last response headers; None if unknown."""
    try:
        return float(cache_info().get("remaining"))
    except (TypeError, ValueError):
        return None


def live_config() -> dict:
    return dict(_live_config)


def set_live(**changes) -> dict:
    """Update known live settings (unknown keys are ignored) and return the new config."""
    for k, v in changes.items():
        if k in LIVE_DEFAULTS and v is not None:
            _live_config[k] = v
    if _budget is not None:
        _budget.credits_per_hour = _live_config["credits_per_hour"]
    return live_config()


def reset_live() -> None:
    """Restore default live settings and drop the in-memory budget (reloaded from BUDGET_FILE on next use)."""
    global _budget
    _live_config.clear()
    _live_config.update(LIVE_DEFAULTS)
    _budget = None


def budget():
    """The live-refresh credit budget, loaded once from BUDGET_FILE so spend survives a restart."""
    global _budget
    if _budget is None:
        from ..engine.live import Budget
        spent = []
        if BUDGET_FILE.exists():
            try:
                spent = json.loads(BUDGET_FILE.read_text())
            except (OSError, ValueError):
                spent = []
        _budget = Budget(_live_config["credits_per_hour"], spent)
        _budget.prune(time.time())
    return _budget


def _record_spend(cost: float, now: float) -> None:
    b = budget()
    b.record(cost, now)
    b.prune(now)
    BUDGET_FILE.write_text(json.dumps([list(x) for x in b.spent]))


def _last_spend() -> float | None:
    spent = budget().spent
    return max(ts for ts, _ in spent) if spent else None


def _next_refresh_in(now: float) -> float | None:
    """Seconds until a live fetch is allowed by both the interval and the budget; None if never."""
    wait_budget = budget().next_allowed(_fetch_cost(), now)
    if wait_budget is None:
        return None
    last = _last_spend()
    wait_interval = 0.0 if last is None else max(0.0, last + _live_config["interval_seconds"] - now)
    return max(wait_budget, wait_interval)


def live_status(now: float | None = None) -> dict:
    from ..engine import live
    now = _now() if now is None else now
    cfg = live_config()
    cost = _fetch_cost()
    rate = live.planned_rate(cost, cfg["interval_seconds"], cfg["credits_per_hour"])
    remaining = _remaining()
    return {**cfg, "cost_per_fetch": cost, "used_last_hour": budget().used(now), "planned_rate": rate,
            "remaining": remaining, "projected_hours": live.projected_hours(remaining, rate),
            "next_refresh_in": _next_refresh_in(now)}


def cache_info() -> dict:
    meta = CACHE.parent / ".odds_meta.json"
    info = {"live": _live(), "age_seconds": None, "ttl_seconds": _ttl()}
    if CACHE.exists():
        info["age_seconds"] = time.time() - CACHE.stat().st_mtime
    if meta.exists():
        info.update(json.loads(meta.read_text()))
    return info


def _overlay(base: list[dict], live_events: list[dict], now: float) -> list[dict]:
    """Replace base events with their live version (same id) and append live-only events.

    Live-cache events that are no longer in play are dropped: their prices are in-game prices
    from a game that has ended, and would otherwise show as pre-game rows.
    """
    from ..engine.live import is_live
    by_id = {e["id"]: e for e in live_events if is_live(e, now)}
    out = [by_id.pop(e["id"], e) for e in base]
    return out + [e for e in live_events if e["id"] in by_id]


def _refresh_live(now: float) -> None:
    """Fetch in-play odds if the interval has passed and the budget allows. Caller holds _lock."""
    last = _last_spend()
    if last is not None and now - last < _live_config["interval_seconds"]:
        return
    cost = _fetch_cost()
    if not budget().can_spend(cost, now):
        return
    # Count the spend before fetching: a fetch that fails part-way has still been charged for the
    # sports it reached, and recording it also stops a failing fetch being retried on every request.
    _record_spend(cost, now)
    try:
        data = _fetch_live()
    except Exception:
        return  # keep serving the previous live prices
    LIVE_CACHE.write_text(json.dumps(data))


def _pregame(force: bool) -> list[dict]:
    """Pre-game snapshot from the disk cache, refetched when older than the TTL. Caller holds _lock."""
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
    elif CACHE.exists():
        return json.loads(CACHE.read_text())
    return data


def get_snapshot(force: bool = False, now: float | None = None) -> list[dict]:
    if not _live():
        from .mock import snapshot
        return snapshot(now=now)
    now = _now() if now is None else now
    with _lock:
        data = _pregame(force)
        if not _live_config["enabled"]:
            return data
        _refresh_live(now)
        if LIVE_CACHE.exists():
            data = _overlay(data, json.loads(LIVE_CACHE.read_text()), now)
        return data
