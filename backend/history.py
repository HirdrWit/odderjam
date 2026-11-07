"""Odds history: every fetched snapshot is kept in SQLite so we can chart line
movement and fill in closing odds on tracked bets automatically.

Timestamps are stored as fixed-width UTC strings (see ts()) so they sort and
compare correctly as text.
"""
import os
import sqlite3
from datetime import datetime, timedelta, timezone

from . import db
from .engine import devig, odds
from .providers.books import SHARP


def ts(t: datetime | str) -> str:
    """Normalise a datetime or ISO string to sortable UTC text: 2026-11-06T18:00:00.000000Z."""
    if isinstance(t, str):
        t = datetime.fromisoformat(t.replace("Z", "+00:00"))
    if t.tzinfo is None:
        t = t.replace(tzinfo=timezone.utc)
    return t.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _keep_days() -> float:
    return float(os.environ.get("ODDS_HISTORY_DAYS", "14"))


def last_fetched_at() -> str | None:
    """Return the newest stored fetched_at stamp, or None if the table is empty."""
    with db.conn() as c:
        return c.execute("SELECT MAX(fetched_at) FROM odds_history").fetchone()[0]


def record(events: list[dict], fetched_at: datetime | None = None) -> int:
    """Store one snapshot (all books, all events) and prune rows older than ODDS_HISTORY_DAYS."""
    at = fetched_at or _now()
    stamp = ts(at)
    rows = [(e["id"], market, o["name"], o.get("point"), book, price, stamp)
            for e in events
            for market, outcomes in e.get("markets", {}).items()
            for o in outcomes
            for book, price in o["prices"].items()]
    with db.conn() as c:
        c.executemany("INSERT INTO odds_history (event_id,market,outcome,point,book,price,fetched_at) "
                      "VALUES (?,?,?,?,?,?,?)", rows)
        c.execute("DELETE FROM odds_history WHERE fetched_at < ?", (ts(at - timedelta(days=_keep_days())),))
    return len(rows)


def history(event_id: str, market: str = "moneyline") -> list[dict]:
    """Return stored prices for one event and market, oldest first."""
    with db.conn() as c:
        return [dict(r) for r in c.execute(
            "SELECT outcome, point, book, price, fetched_at FROM odds_history "
            "WHERE event_id=? AND market=? ORDER BY fetched_at, book, outcome", (event_id, market))]


def _last_price(c: sqlite3.Connection, bet: sqlite3.Row, book: str, outcome: str, before: str) -> float | None:
    r = c.execute("SELECT price FROM odds_history WHERE event_id=? AND market=? AND outcome=? AND point IS ? "
                  "AND book=? AND fetched_at < ? ORDER BY fetched_at DESC LIMIT 1",
                  (bet["event_id"], bet["market"], outcome, bet["point"], book, before)).fetchone()
    return r["price"] if r else None


def _same_line(bet: sqlite3.Row) -> tuple[str, tuple]:
    """SQL filter for the sharp rows on the bet's line. On spreads the other side hangs the
    opposite point (home -3.5 pairs with away +3.5); totals and moneyline share one point."""
    if bet["market"] == "spreads" and bet["point"] is not None:
        return ("((outcome=? AND point=?) OR (outcome<>? AND point=?))",
                (bet["outcome"], bet["point"], bet["outcome"], -bet["point"]))
    return "point IS ?", (bet["point"],)


def _sharp_close(c: sqlite3.Connection, bet: sqlite3.Row, before: str) -> float | None:
    """No-vig fair price (American) for the bet's outcome from the last pre-start sharp snapshot."""
    line, args = _same_line(bet)
    r = c.execute(f"SELECT MAX(fetched_at) AS t FROM odds_history WHERE event_id=? AND market=? AND {line} "
                  "AND book=? AND fetched_at < ?",
                  (bet["event_id"], bet["market"], *args, SHARP, before)).fetchone()
    if not r["t"]:
        return None
    prices = {x["outcome"]: x["price"] for x in c.execute(
        f"SELECT outcome, price FROM odds_history WHERE event_id=? AND market=? AND {line} AND book=? "
        "AND fetched_at=?", (bet["event_id"], bet["market"], *args, SHARP, r["t"]))}
    if bet["outcome"] not in prices or len(prices) < 2:
        return None
    names = list(prices)
    fair = devig.multiplicative([odds.american_to_prob(prices[n]) for n in names])
    return odds.prob_to_american(fair[names.index(bet["outcome"])])


def capture_closing(now: datetime | None = None) -> int:
    """For bets whose event has started, fill closing_odds (bet's book) and closing_sharp_odds
    (sharp no-vig) from the last snapshot taken before the start. Never overwrites a value
    already set. Returns the number of bets updated."""
    cutoff = ts(now or _now())
    updated = 0
    with db.conn() as c:
        bets = c.execute("SELECT * FROM bets WHERE event_id IS NOT NULL AND outcome IS NOT NULL "
                         "AND event_start IS NOT NULL AND event_start <= ? "
                         "AND (closing_odds IS NULL OR closing_sharp_odds IS NULL)", (cutoff,)).fetchall()
        for b in bets:
            close = b["closing_odds"]
            if close is None and b["book"]:
                close = _last_price(c, b, b["book"], b["outcome"], b["event_start"])
            sharp = b["closing_sharp_odds"]
            if sharp is None:
                sharp = _sharp_close(c, b, b["event_start"])
            if (close, sharp) != (b["closing_odds"], b["closing_sharp_odds"]):
                c.execute("UPDATE bets SET closing_odds=?, closing_sharp_odds=? WHERE id=?", (close, sharp, b["id"]))
                updated += 1
    return updated
