"""Snapshot access with a disk cache so UI polling never spends API credits.

Live fetches only happen when the cache is older than ODDS_CACHE_MINUTES
(default 120) or when refresh() is called explicitly.
"""
import json
import logging
import os
import threading
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

# Versioned so a cache written in an older event shape is never read back (v3: events carry "updated").
CACHE = Path(__file__).resolve().parent.parent.parent / ".odds_cache.v3.json"
LIVE_CACHE = CACHE.parent / ".odds_cache.live.json"
BUDGET_FILE = CACHE.parent / ".odds_cache.budget.json"
_lock = threading.Lock()


class ProviderError(RuntimeError):
    """The odds provider failed or could not be reached. `status` is the HTTP status, or None for network errors."""

    def __init__(self, message: str, status: int | None = None):
        super().__init__(message)
        self.status = status


_provider_error: dict | None = None
_partial_failure: int | None = None  # a sport failed in the latest fetch that otherwise returned data
FAIL_BACKOFF_SECONDS = 60.0


def record_provider_error(status: int | None) -> None:
    """Remember the latest provider failure (HTTP status, or None for a network error) for the freshness strip."""
    global _provider_error
    _provider_error = {"status": status, "at": time.time()}


def clear_provider_error() -> None:
    global _provider_error
    _provider_error = None


def describe_failure(status: int | None) -> str:
    """Plain-English reason for a provider failure."""
    if status in (401, 403):
        return "the API key is invalid or out of credits"
    if status == 429:
        return "rate limited"
    if status is None:
        return "offline or timed out"
    return f"it answered with an error ({status})"


log = logging.getLogger(__name__)
MOCK_HISTORY_SECONDS = 300  # mock odds change every call; only keep one snapshot per 5 minutes

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

# Live (in-play) refresh settings. Off by default: every live fetch spends API credits.
LIVE_DEFAULTS = {"enabled": False, "interval_seconds": 30.0, "credits_per_hour": 60.0, "max_price_age": 60.0}
_live_config = dict(LIVE_DEFAULTS)
_budget = None


def _live() -> bool:
    return bool(os.environ.get("ODDS_API_KEY"))


def _ttl() -> float:
    return float(os.environ.get("ODDS_CACHE_MINUTES", "120")) * 60


def _fetch() -> list[dict]:
    from .exchanges import enrich
    from .theoddsapi import snapshot
    return enrich(snapshot())


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


def _correct_spend(real: float | None) -> None:
    """Swap the estimate just recorded for the real cost, when the response headers gave one."""
    if real is None:
        return
    b = budget()
    b.set_last_cost(real)
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
    from .theoddsapi import PROP_MARKETS  # lazy: keeps httpx out of mock mode
    info = {"live": _live(), "age_seconds": None, "ttl_seconds": _ttl(), "prop_markets": PROP_MARKETS}
    if CACHE.exists():
        info["age_seconds"] = time.time() - CACHE.stat().st_mtime
    try:
        info.update(json.loads(meta.read_text()))
    except (OSError, ValueError):
        pass  # missing or truncated meta file: show no credit figures rather than failing
    if _provider_error:
        info["provider_error"] = dict(_provider_error)
    return info


def _store(data: list[dict], min_gap: float = 0) -> None:
    """Save a fetched snapshot to the odds history and fill any closing lines now due.
    Skips the save if the newest stored snapshot is under min_gap seconds old.
    History problems must never stop odds from being served."""
    from .. import history  # local import: history imports providers.books, which would be circular
    try:
        last = history.last_fetched_at()
        if min_gap and last and last > history.ts(datetime.now(timezone.utc) - timedelta(seconds=min_gap)):
            return
        history.record(data)
        history.capture_closing()
    except Exception:
        log.exception("could not store odds history")


def peek_snapshot() -> list[dict]:
    """The latest pre-game snapshot already on hand (mock data or the disk cache). Never fetches."""
    if not _live():
        from .mock import snapshot
        return snapshot()
    with _lock:
        return json.loads(CACHE.read_text()) if CACHE.exists() else []


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
    # Record the estimate before fetching, so a failing fetch still counts toward the interval and
    # is not retried on every request. The real cost (empty responses are free) replaces it after.
    _record_spend(cost, now)
    try:
        data = _fetch_live()
    except Exception:
        _correct_spend(_real_cost())
        return  # keep serving the previous live prices
    _correct_spend(_real_cost())
    LIVE_CACHE.write_text(json.dumps(data))


def _write_atomic(path: Path, text: str) -> None:
    """Write via a temp file and rename, so a reader never sees a truncated file."""
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(text)
    tmp.replace(path)


def _pregame(force: bool) -> list[dict]:
    """Pre-game snapshot from the disk cache, refetched when older than the TTL. Caller holds _lock."""
    fresh = CACHE.exists() and time.time() - CACHE.stat().st_mtime < _ttl()
    if fresh and not force:
        return json.loads(CACHE.read_text())
    if (_provider_error and not force and time.time() - _provider_error["at"] < FAIL_BACKOFF_SECONDS):
        # The provider failed a moment ago: don't hit it again on every poll.
        return json.loads(CACHE.read_text()) if CACHE.exists() else []
    global _partial_failure
    _partial_failure = None
    try:
        data = _fetch()
    except Exception as e:
        log.warning("odds fetch failed: %s", e)
        if _provider_error is None or time.time() - _provider_error["at"] >= FAIL_BACKOFF_SECONDS:
            record_provider_error(getattr(e, "status", None))
        return json.loads(CACHE.read_text()) if CACHE.exists() else []  # stale data beats an error page
    if data:
        if _partial_failure is not None:
            record_provider_error(_partial_failure)  # some sports came back, one did not: say so
        else:
            clear_provider_error()
        _write_atomic(CACHE, json.dumps(data))
        _store(data)
        _fetched(data)
    elif CACHE.exists():
        return json.loads(CACHE.read_text())
    return data


def get_snapshot(force: bool = False, now: float | None = None) -> list[dict]:
    if not _live():
        from .mock import snapshot
        data = snapshot(now=now)
        _store(data, 0 if force else MOCK_HISTORY_SECONDS)
        return data
    now = _now() if now is None else now
    with _lock:
        data = _pregame(force)
        if not _live_config["enabled"]:
            return data
        _refresh_live(now)
        if LIVE_CACHE.exists():
            data = _overlay(data, json.loads(LIVE_CACHE.read_text()), now)
        return data


def get_scores(sports: list[str]) -> list[dict]:
    """Final/live scores for auto-settling bets. Live API only: spends credits on every call."""
    if not _live():
        raise RuntimeError("auto-settle needs ODDS_API_KEY (live scores)")
    from .theoddsapi import scores
    return scores(sports)


def _real_cost() -> float | None:
    """Credits the latest live fetch really cost, from the response headers; None if unknown."""
    from .theoddsapi import last_fetch_cost
    return last_fetch_cost()
