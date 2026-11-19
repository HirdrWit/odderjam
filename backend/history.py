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
    rows = [(e["id"], market, o["name"], o.get("point"), book, price, stamp, o.get("player"))
            for e in events
            for market, outcomes in e.get("markets", {}).items()
            for o in outcomes
            for book, price in o["prices"].items()]
    with db.conn() as c:
        c.executemany("INSERT INTO odds_history (event_id,market,outcome,point,book,price,fetched_at,player) "
                      "VALUES (?,?,?,?,?,?,?,?)", rows)
        c.execute("DELETE FROM odds_history WHERE fetched_at < ?", (ts(at - timedelta(days=_keep_days())),))
    return len(rows)


def history(event_id: str, market: str = "moneyline", point: float | None = None,
            player: str | None = None) -> list[dict]:
    """Return stored prices for one event and market, oldest first. `point` and `player` narrow it to one
    line group (a totals line, one player's prop); spreads also return the opposite side's point.
    Reads only the local store."""
    sql = ("SELECT outcome, point, player, book, price, fetched_at FROM odds_history "
           "WHERE event_id=? AND market=?")
    args: list = [event_id, market]
    if point is not None:
        if market == "spreads":
            sql += " AND (point=? OR point=?)"
            args += [point, -point]
        else:
            sql += " AND point=?"
            args.append(point)
    if player is not None:
        sql += " AND player=?"
        args.append(player)
    with db.conn() as c:
        return [dict(r) for r in c.execute(sql + " ORDER BY fetched_at, book, outcome", args)]


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
                (bet["selection"], bet["point"], bet["selection"], -bet["point"]))
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
    if bet["selection"] not in prices or len(prices) < 2:
        return None
    names = list(prices)
    fair = devig.multiplicative([odds.american_to_prob(prices[n]) for n in names])
    return odds.prob_to_american(fair[names.index(bet["selection"])])


def capture_closing(now: datetime | None = None) -> int:
    """For bets whose event has started, fill closing_odds (bet's book) and closing_sharp_odds
    (sharp no-vig) from the last snapshot taken before the start. Never overwrites a value
    already set. Returns the number of bets updated."""
    cutoff = ts(now or _now())
    updated = 0
    with db.conn() as c:
        bets = c.execute("SELECT * FROM bets WHERE event_id IS NOT NULL AND selection IS NOT NULL "
                         "AND event_start IS NOT NULL AND event_start <= ? "
                         "AND (closing_odds IS NULL OR closing_sharp_odds IS NULL)", (cutoff,)).fetchall()
        for b in bets:
            close = b["closing_odds"]
            if close is None and b["book"]:
                close = _last_price(c, b, b["book"], b["selection"], b["event_start"])
            sharp = b["closing_sharp_odds"]
            if sharp is None:
                sharp = _sharp_close(c, b, b["event_start"])
            if (close, sharp) != (b["closing_odds"], b["closing_sharp_odds"]):
                c.execute("UPDATE bets SET closing_odds=?, closing_sharp_odds=? WHERE id=?", (close, sharp, b["id"]))
                updated += 1
    return updated


MOVE_WINDOW_MIN = 60.0
_BASELINE_MAX_AGE_MIN = 180.0  # an older snapshot would not describe the last hour


def _minutes(a: str, b: str) -> float:
    return (datetime.fromisoformat(b.replace("Z", "+00:00"))
            - datetime.fromisoformat(a.replace("Z", "+00:00"))).total_seconds() / 60


def _fair_series(rows: list[sqlite3.Row], book: str, selection: str) -> list[tuple[str, float]]:
    """(fetched_at, fair prob of `selection`) for one book's snapshots that priced every side."""
    by_time: dict[str, dict[str, float]] = {}
    for r in rows:
        if r["book"] == book:
            by_time.setdefault(r["fetched_at"], {})[r["outcome"]] = r["price"]
    out = []
    for t in sorted(by_time):
        prices = by_time[t]
        if selection in prices and len(prices) >= 2:
            names = list(prices)
            fair = devig.multiplicative([odds.american_to_prob(prices[n]) for n in names])
            out.append((t, fair[names.index(selection)]))
    return out


def _sharp_move(rows, sharps: list[str], selection: str, now: str, memo: dict | None = None) -> float | None:
    moves = []
    for book in sharps:
        key = (id(rows), book, selection)
        if memo is not None and key in memo:
            series = memo[key]
        else:
            cutoff = ts(datetime.fromisoformat(now.replace("Z", "+00:00")) - timedelta(minutes=_BASELINE_MAX_AGE_MIN + 60))
            series = [(t, p) for t, p in _fair_series([r for r in rows if r["book"] == book and r["fetched_at"] >= cutoff],
                                                      book, selection) if t <= now]
            if memo is not None:
                memo[key] = series
        if len(series) < 2:
            continue
        latest_t, latest = series[-1]
        window = [(t, p) for t, p in series[:-1] if _minutes(t, now) >= MOVE_WINDOW_MIN]
        recent = [(t, p) for t, p in window if _minutes(t, now) <= _BASELINE_MAX_AGE_MIN]
        if recent:
            base = recent[-1][1]
        else:
            inside = [(t, p) for t, p in series[:-1] if _minutes(t, now) < MOVE_WINDOW_MIN]
            if not inside:
                continue
            base = inside[0][1]
        moves.append((latest - base) * 100)
    return sum(moves) / len(moves) if moves else None


def _price_age(rows, book: str, selection: str, point, price: float) -> float | None:
    """Minutes between the first and the last snapshot in the unbroken run at `price` (None if the
    latest stored price differs, e.g. the row is newer than the last recorded snapshot)."""
    series = sorted((r["fetched_at"], r["price"]) for r in rows
                    if r["book"] == book and r["outcome"] == selection and r["point"] == point)
    if len(series) < 2 or series[-1][1] != price:
        return None
    start = series[-1][0]
    for t, p in reversed(series):
        if p != price:
            break
        start = t
    return _minutes(start, series[-1][0])


def annotate(rows: list[dict], now: datetime | float | None = None) -> list[dict]:
    """Add `sharp_move` (points change in the sharps' fair probability of the row's side over the last
    60 minutes; positive = sharps moving toward it) and `price_age_minutes` (how long the bet book has
    held the price) to +EV rows, from the local history only. Both are None when history is too thin."""
    if isinstance(now, (int, float)):
        now = datetime.fromtimestamp(now, timezone.utc)
    stamp = ts(now or _now())
    cache: dict[tuple, list[sqlite3.Row]] = {}
    memo: dict = {}
    with db.conn() as c:
        for row in rows:
            line, args = _same_line(row)
            key = (row["event_id"], row["market"], row.get("player"), line, args)
            if key not in cache:
                cache[key] = c.execute(
                    f"SELECT outcome, point, book, price, fetched_at FROM odds_history WHERE event_id=? AND market=? "
                    f"AND player IS ? AND {line} AND fetched_at <= ?",
                    (row["event_id"], row["market"], row.get("player"), *args, stamp)).fetchall()
            hist = cache[key]
            row["sharp_move"] = _sharp_move(hist, [s["book"] for s in row.get("sharps", [])],
                                            row["selection"], stamp, memo)
            row["price_age_minutes"] = _price_age(hist, row["book"], row["selection"], row.get("point"),
                                                  row["odds"])
    return rows
