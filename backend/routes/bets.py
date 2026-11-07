"""Bet tracker: SQLite-backed CRUD plus ROI / CLV stats."""
from collections import defaultdict
from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from .. import history
from ..db import conn
from ..engine.odds import american_to_decimal

router = APIRouter(prefix="/api/bets")

Status = Literal["pending", "won", "lost", "push", "void"]


class BetIn(BaseModel):
    event: str = ""
    sport: str = ""
    market: str = "moneyline"
    pick: str
    book: str = ""
    odds: float
    stake: float
    status: Status = "pending"
    closing_odds: float | None = None
    ev_pct: float | None = None
    notes: str = ""
    # Set by the +EV "Track" button so the closing line can be captured automatically.
    event_id: str | None = None
    outcome: str | None = None
    point: float | None = None
    event_start: str | None = None
    closing_sharp_odds: float | None = None

    def row(self) -> dict:
        d = self.model_dump()
        if d["event_start"]:
            d["event_start"] = history.ts(d["event_start"])
        return d


FIELDS = ("event", "sport", "market", "pick", "book", "odds", "stake", "status", "closing_odds", "ev_pct",
          "notes", "event_id", "outcome", "point", "event_start", "closing_sharp_odds")


def profit(b) -> float:
    if b["status"] == "won":
        return b["stake"] * (american_to_decimal(b["odds"]) - 1)
    return -b["stake"] if b["status"] == "lost" else 0.0


def clv(b, key: str = "closing_odds") -> float | None:
    if b[key] is None:
        return None
    return (american_to_decimal(b["odds"]) / american_to_decimal(b[key]) - 1) * 100


def out(b) -> dict:
    d = dict(b)
    d["profit"] = profit(b)
    d["clv_pct"] = clv(b)
    d["clv_sharp_pct"] = clv(b, "closing_sharp_odds")
    return d


@router.get("")
def list_bets():
    history.capture_closing()
    with conn() as c:
        return [out(r) for r in c.execute("SELECT * FROM bets ORDER BY placed_at DESC, id DESC")]


@router.post("")
def add_bet(b: BetIn):
    d = b.row()
    with conn() as c:
        cur = c.execute(f"INSERT INTO bets (placed_at,{','.join(FIELDS)}) VALUES (?{',?' * len(FIELDS)})",
                        (datetime.now(timezone.utc).isoformat(), *(d[k] for k in FIELDS)))
        return out(c.execute("SELECT * FROM bets WHERE id=?", (cur.lastrowid,)).fetchone())


@router.put("/{bet_id}")
def update_bet(bet_id: int, b: BetIn):
    d = b.row()
    with conn() as c:
        cur = c.execute(f"UPDATE bets SET {','.join(f'{k}=?' for k in FIELDS)} WHERE id=?",
                        (*(d[k] for k in FIELDS), bet_id))
        if not cur.rowcount:
            raise HTTPException(404, "bet not found")
        return out(c.execute("SELECT * FROM bets WHERE id=?", (bet_id,)).fetchone())


@router.delete("/{bet_id}")
def delete_bet(bet_id: int):
    with conn() as c:
        if not c.execute("DELETE FROM bets WHERE id=?", (bet_id,)).rowcount:
            raise HTTPException(404, "bet not found")
    return {"ok": True}


@router.get("/stats")
def stats():
    history.capture_closing()
    with conn() as c:
        rows = c.execute("SELECT * FROM bets").fetchall()
    settled = [r for r in rows if r["status"] in ("won", "lost", "push")]
    staked = sum(r["stake"] for r in settled)
    net = sum(profit(r) for r in settled)
    decided = [r for r in settled if r["status"] in ("won", "lost")]
    clvs = [v for r in rows if (v := clv(r)) is not None]
    sharp_clvs = [v for r in rows if (v := clv(r, "closing_sharp_odds")) is not None]

    def group(key):
        g = defaultdict(lambda: {"bets": 0, "staked": 0.0, "profit": 0.0})
        for r in settled:
            x = g[r[key] or "—"]
            x["bets"] += 1
            x["staked"] += r["stake"]
            x["profit"] += profit(r)
        return [{"name": k, **v, "roi_pct": v["profit"] / v["staked"] * 100 if v["staked"] else 0}
                for k, v in sorted(g.items(), key=lambda kv: -kv[1]["profit"])]

    return {
        "total_bets": len(rows),
        "pending": sum(r["status"] == "pending" for r in rows),
        "staked": staked,
        "profit": net,
        "roi_pct": net / staked * 100 if staked else 0,
        "win_rate_pct": sum(r["status"] == "won" for r in decided) / len(decided) * 100 if decided else 0,
        "avg_clv_pct": sum(clvs) / len(clvs) if clvs else None,
        "pos_clv_rate_pct": sum(v > 0 for v in clvs) / len(clvs) * 100 if clvs else None,
        "avg_clv_sharp_pct": sum(sharp_clvs) / len(sharp_clvs) if sharp_clvs else None,
        "by_sport": group("sport"),
        "by_book": group("book"),
    }


class BankrollIn(BaseModel):
    starting: float


def bankroll_info() -> dict:
    """Current bankroll = starting bankroll + profit on settled bets."""
    with conn() as c:
        row = c.execute("SELECT value FROM settings WHERE key='starting_bankroll'").fetchone()
        rows = c.execute("SELECT * FROM bets").fetchall()
    starting = row["value"] if row else 100.0
    pl = sum(profit(r) for r in rows)
    return {"starting": starting, "profit": pl, "current": starting + pl,
            "pending_stake": sum(r["stake"] for r in rows if r["status"] == "pending")}


bankroll_router = APIRouter(prefix="/api/bankroll")


@bankroll_router.get("")
def get_bankroll():
    return bankroll_info()


@bankroll_router.put("")
def set_bankroll(b: BankrollIn):
    with conn() as c:
        c.execute("INSERT INTO settings(key,value) VALUES('starting_bankroll',?) "
                  "ON CONFLICT(key) DO UPDATE SET value=excluded.value", (b.starting,))
    return bankroll_info()
