"""Bet tracker: SQLite-backed CRUD plus ROI / CLV stats."""
import sqlite3
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..engine.odds import american_to_decimal

DB = Path(__file__).resolve().parent.parent.parent / ".odderjam.db"
router = APIRouter(prefix="/api/bets")

Status = Literal["pending", "won", "lost", "push", "void"]


def conn() -> sqlite3.Connection:
    c = sqlite3.connect(DB)
    c.row_factory = sqlite3.Row
    c.execute("""CREATE TABLE IF NOT EXISTS bets (
        id INTEGER PRIMARY KEY AUTOINCREMENT, placed_at TEXT NOT NULL, event TEXT, sport TEXT,
        market TEXT DEFAULT 'moneyline', pick TEXT NOT NULL, book TEXT, odds REAL NOT NULL,
        stake REAL NOT NULL, status TEXT NOT NULL DEFAULT 'pending', closing_odds REAL,
        ev_pct REAL, notes TEXT, is_bonus INTEGER NOT NULL DEFAULT 0)""")
    if "is_bonus" not in {r["name"] for r in c.execute("PRAGMA table_info(bets)")}:
        c.execute("ALTER TABLE bets ADD COLUMN is_bonus INTEGER NOT NULL DEFAULT 0")
    c.execute("CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value REAL)")
    return c


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
    is_bonus: bool = False  # bonus bet / free bet: stake is not cash and is not returned


def profit(b) -> float:
    """Cash P/L. A bonus bet pays winnings only when it wins and costs $0 when it loses."""
    if b["status"] == "won":
        return b["stake"] * (american_to_decimal(b["odds"]) - 1)
    return -cash_stake(b) if b["status"] == "lost" else 0.0


def cash_stake(b) -> float:
    """Real money put at risk: zero for a bonus bet."""
    return 0.0 if b["is_bonus"] else b["stake"]


def clv(b) -> float | None:
    if b["closing_odds"] is None:
        return None
    return (american_to_decimal(b["odds"]) / american_to_decimal(b["closing_odds"]) - 1) * 100


def out(b) -> dict:
    d = dict(b)
    d["is_bonus"] = bool(b["is_bonus"])
    d["profit"] = profit(b)
    d["clv_pct"] = clv(b)
    return d


@router.get("")
def list_bets():
    with conn() as c:
        return [out(r) for r in c.execute("SELECT * FROM bets ORDER BY placed_at DESC, id DESC")]


@router.post("")
def add_bet(b: BetIn):
    with conn() as c:
        cur = c.execute(
            """INSERT INTO bets (placed_at,event,sport,market,pick,book,odds,stake,status,closing_odds,ev_pct,notes,
               is_bonus) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (datetime.now(timezone.utc).isoformat(), b.event, b.sport, b.market, b.pick, b.book, b.odds,
             b.stake, b.status, b.closing_odds, b.ev_pct, b.notes, int(b.is_bonus)))
        return out(c.execute("SELECT * FROM bets WHERE id=?", (cur.lastrowid,)).fetchone())


@router.put("/{bet_id}")
def update_bet(bet_id: int, b: BetIn):
    with conn() as c:
        cur = c.execute(
            """UPDATE bets SET event=?,sport=?,market=?,pick=?,book=?,odds=?,stake=?,status=?,
               closing_odds=?,ev_pct=?,notes=?,is_bonus=? WHERE id=?""",
            (b.event, b.sport, b.market, b.pick, b.book, b.odds, b.stake, b.status, b.closing_odds,
             b.ev_pct, b.notes, int(b.is_bonus), bet_id))
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
    with conn() as c:
        rows = c.execute("SELECT * FROM bets").fetchall()
    settled = [r for r in rows if r["status"] in ("won", "lost", "push")]
    staked = sum(cash_stake(r) for r in settled)
    net = sum(profit(r) for r in settled)
    decided = [r for r in settled if r["status"] in ("won", "lost")]
    clvs = [v for r in rows if (v := clv(r)) is not None]

    def group(key):
        g = defaultdict(lambda: {"bets": 0, "staked": 0.0, "profit": 0.0})
        for r in settled:
            x = g[r[key] or "—"]
            x["bets"] += 1
            x["staked"] += cash_stake(r)
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
            "pending_stake": sum(cash_stake(r) for r in rows if r["status"] == "pending")}


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
