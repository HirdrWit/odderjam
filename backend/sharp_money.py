"""Sharp Money: public exchange trades stored by price over time, polled on demand, scanned for spikes.

Events carry ``exchange_markets[book][team] = market id`` (set when exchange quotes are merged, see
providers.exchanges). Polling fetches each market's trades since the newest one already stored, so a
market is never re-read from scratch. Exchange trade feeds are free, but polling is throttled to once
per SHARP_MONEY_POLL_SECONDS (default 60) and capped at SHARP_MONEY_MAX_MARKETS markets (default 60,
soonest games first) so page loads never hammer an exchange. Trades older than SHARP_MONEY_HOURS
(default 24) are pruned.
"""
import logging
import os
import threading

import httpx

from . import db
from .engine import spikes
from .engine.exchange import DEFAULT_FEES
from .engine.live import DEFAULT_GAME_HOURS, MAX_GAME_HOURS, parse_time
from .providers.books import us_only
from .providers.exchanges import PLATFORMS, TRADE_PLATFORMS

log = logging.getLogger(__name__)
# Exchanges and prediction markets: never listed as the "sportsbook paying more".
EXCHANGE_BOOKS = set(DEFAULT_FEES) | set(PLATFORMS) | set(TRADE_PLATFORMS)

_poll_lock = threading.Lock()
_last_poll: float | None = None


def _keep_hours() -> float:
    return float(os.environ.get("SHARP_MONEY_HOURS", "24"))


def _poll_seconds() -> float:
    return float(os.environ.get("SHARP_MONEY_POLL_SECONDS", "60"))


def _max_markets() -> int:
    return int(os.environ.get("SHARP_MONEY_MAX_MARKETS", "60"))


def reset() -> None:
    """Forget when the last poll ran (tests, or to force the next request to poll)."""
    global _last_poll
    _last_poll = None


def record(book: str, market: str, event_id: str, outcome: str, trades: list[dict]) -> int:
    """Store trades ``{trade_id, ts, cents, size}``; a trade already stored for the book is skipped.
    Returns the number of new rows."""
    rows = [(book, t["trade_id"], market, event_id, outcome, t["cents"], t["size"], t["ts"]) for t in trades]
    with db.conn() as c:
        before = c.total_changes
        c.executemany("INSERT OR IGNORE INTO exchange_trades "
                      "(book, trade_id, market, event_id, outcome, cents, size, traded_at) VALUES (?,?,?,?,?,?,?,?)",
                      rows)
        return c.total_changes - before


def prune(now: float) -> int:
    """Delete trades older than SHARP_MONEY_HOURS. Returns the number deleted."""
    with db.conn() as c:
        return c.execute("DELETE FROM exchange_trades WHERE traded_at < ?", (now - _keep_hours() * 3600,)).rowcount


def trades(book: str, event_id: str, outcome: str, since: float) -> list[dict]:
    """Stored trades ``{ts, cents, size}`` on one event outcome at or after ``since``, oldest first."""
    with db.conn() as c:
        return [{"ts": r["traded_at"], "cents": r["cents"], "size": r["size"]} for r in c.execute(
            "SELECT traded_at, cents, size FROM exchange_trades WHERE book=? AND event_id=? AND outcome=? "
            "AND traded_at >= ? ORDER BY traded_at, trade_id", (book, event_id, outcome, since))]


def last_ts(book: str, market: str) -> float | None:
    """Time of the newest stored trade on a market, or None."""
    with db.conn() as c:
        return c.execute("SELECT MAX(traded_at) FROM exchange_trades WHERE book=? AND market=?",
                         (book, market)).fetchone()[0]


def _open(e: dict, now: float) -> bool:
    """Upcoming or in play: not past the sport's longest game length since the start."""
    start = parse_time(e.get("start"))
    if start is None or e.get("completed"):
        return False
    return now - start < MAX_GAME_HOURS.get(e.get("sport"), DEFAULT_GAME_HOURS) * 3600


def _markets(events: list[dict], now: float) -> list[tuple[dict, str, str, str]]:
    """(event, book, outcome, market id) for every polled exchange market on open events, soonest first."""
    out = []
    for e in sorted((e for e in events if _open(e, now)), key=lambda e: parse_time(e["start"])):
        for book, tickers in (e.get("exchange_markets") or {}).items():
            if book in TRADE_PLATFORMS:
                out.extend((e, book, outcome, market) for outcome, market in tickers.items())
    return out


def poll(events: list[dict], client: httpx.Client | None, now: float, lookback: float) -> int:
    """Fetch and store new trades for every exchange market on open events. A market whose fetch or
    parse fails is skipped. Returns the number of new trades stored."""
    stored = 0
    for e, book, outcome, market in _markets(events, now)[:_max_markets()]:
        mod = TRADE_PLATFORMS[book]
        since = max(last_ts(book, market) or 0.0, now - lookback)
        try:
            new = mod.parse_trades(mod.fetch_trades(market, since, client))
        except Exception as exc:  # noqa: BLE001 - third-party feed; one market never stops the rest
            log.warning("sharp money %s %s skipped: %s", book, market, exc)
            continue
        stored += record(book, market, e["id"], outcome, new)
    prune(now)
    return stored


def maybe_poll(events: list[dict], now: float, client: httpx.Client | None = None,
               lookback: float | None = None) -> bool:
    """Poll unless a poll ran in the last SHARP_MONEY_POLL_SECONDS, one is running, or there is nothing
    to poll. Returns True when a poll ran. Errors are logged, never raised."""
    global _last_poll
    if not _markets(events, now):
        return False
    if _last_poll is not None and now - _last_poll < _poll_seconds():
        return False
    if not _poll_lock.acquire(blocking=False):
        return False
    try:
        _last_poll = now
        lookback = _keep_hours() * 3600 if lookback is None else lookback
        if client is not None:
            poll(events, client, now, lookback)
        else:
            with httpx.Client() as c:
                poll(events, c, now, lookback)
    except Exception:
        log.exception("sharp money poll failed")
    finally:
        _poll_lock.release()
    return True


def _books(e: dict, outcome: str) -> dict[str, float]:
    """US sportsbook moneyline prices for an outcome (exchanges left out)."""
    o = next((o for o in e.get("markets", {}).get("moneyline", []) if o["name"] == outcome), None)
    prices = us_only(o["prices"]) if o else {}
    return {b: p for b, p in prices.items() if b not in EXCHANGE_BOOKS}


def rows(events: list[dict], now: float, window: float, baseline: float, k: float, min_volume: float) -> list[dict]:
    """One row per spiking exchange market on an open event, with the sportsbooks beating the spike's
    volume-weighted price. Largest ratio first; a spike with no baseline (ratio None) ranks first."""
    out = []
    for e, book, outcome, market in _markets(events, now):
        series = trades(book, e["id"], outcome, since=now - window - baseline)
        s = spikes.detect(series, now, window=window, baseline=baseline, k=k, min_volume=min_volume)
        if s is None:
            continue
        out.append({
            "event_id": e["id"], "event": f'{e["away"]} @ {e["home"]}', "sport": e["sport"], "start": e["start"],
            "exchange": book, "market": market, "outcome": outcome,
            **{key: s[key] for key in ("volume", "baseline", "ratio", "vwap_cents", "fair_prob", "price",
                                       "trades", "by_price")},
            "books": spikes.beating(_books(e, outcome), s["fair_prob"]),
        })
    return sorted(out, key=lambda r: -(r["ratio"] if r["ratio"] is not None else float("inf")))
