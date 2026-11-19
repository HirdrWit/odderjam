"""Hidden +EV rows: rows the user hid, plus rows already in the Tracker.

A hidden row is stored by its key (event, market, player, point, pick, book) with an expiry at event start.
The same list filters /api/ev and the alert rules, so a hidden row does not notify.
"""
import json
import sqlite3
import time
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, StringConstraints

from . import db

router = APIRouter(prefix="/api/hidden")
Text = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]


def row_key(event_id, market, player, point, pick, book) -> str:
    return json.dumps([event_id, market, player or None, None if point is None else float(point), pick, book])


def _key_of(row: dict) -> str:
    return row_key(row["event_id"], row["market"], row.get("player"), row.get("point"), row["pick"], row["book"])


def _epoch(start: str) -> float:
    try:
        t = datetime.fromisoformat(start.replace("Z", "+00:00"))
    except ValueError:
        raise HTTPException(422, "start must be a date and time like 2026-11-06T18:00:00Z") from None
    return (t if t.tzinfo else t.replace(tzinfo=timezone.utc)).timestamp()


def conn() -> sqlite3.Connection:
    return db.conn()


def hidden_keys(c: sqlite3.Connection, now: float) -> set[str]:
    """Keys still hidden at `now` (read-only: callers may sit inside another writer's transaction)."""
    return {r["key"] for r in c.execute("SELECT key FROM hidden_rows WHERE expires_at > ?", (now,))}


def tracked_keys(c: sqlite3.Connection) -> set[tuple]:
    return {(r["event_id"], r["market"], r["pick"], r["book"], r["point"])
            for r in c.execute("SELECT event_id, market, pick, book, point FROM bets WHERE status != 'void'")}


def apply(rows: list[dict], now: float | None = None, show_hidden: bool = False) -> list[dict]:
    """Mark each row `hidden`: "hidden", "tracked" or None; drop marked rows unless show_hidden."""
    now = time.time() if now is None else now
    c = conn()
    try:
        hidden, tracked = hidden_keys(c, now), tracked_keys(c)
    finally:
        c.close()
    out = []
    for r in rows:
        if _key_of(r) in hidden:
            mark = "hidden"
        elif (r["event_id"], r["market"], r["pick"], r["book"], r.get("point")) in tracked:
            mark = "tracked"
        else:
            mark = None
        if mark is None or show_hidden:
            out.append({**r, "hidden": mark})
    return out


class HideIn(BaseModel):
    event_id: Text
    market: Text
    player: str | None = None
    point: float | None = None
    pick: Text
    book: Text
    start: Text  # event start: the entry expires then


@router.post("")
def hide(h: HideIn):
    expires = _epoch(h.start)
    with conn() as c:
        c.execute("DELETE FROM hidden_rows WHERE expires_at <= ?", (time.time(),))  # started events
        c.execute("INSERT OR REPLACE INTO hidden_rows (key, expires_at) VALUES (?, ?)",
                  (row_key(h.event_id, h.market, h.player, h.point, h.pick, h.book), expires))
    return {"ok": True}


@router.delete("")
def unhide(event_id: str, market: str, pick: str, book: str,
           player: Annotated[str | None, Query()] = None, point: str | None = None):
    # A missing player/point may arrive as an empty string (client libraries send None as `point=`).
    try:
        pt = float(point) if point not in (None, "") else None
    except ValueError:
        raise HTTPException(422, "point must be a number") from None
    with conn() as c:
        c.execute("DELETE FROM hidden_rows WHERE key = ?", (row_key(event_id, market, player, pt, pick, book),))
    return {"ok": True}
