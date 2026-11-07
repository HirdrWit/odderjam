"""Bet tracker: SQLite-backed CRUD, ROI / CLV stats, CSV import/export and auto-settling."""
import csv
import io
import sqlite3
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, ValidationError

from .. import providers
from ..engine.odds import american_to_decimal
from ..engine.settle import SETTLEABLE, final_scores, grade, parse_pick

DB = Path(__file__).resolve().parent.parent.parent / ".odderjam.db"
router = APIRouter(prefix="/api/bets")

Status = Literal["pending", "won", "lost", "push", "void"]
Strategy = Literal["ev", "arb", "promo", "middle"]
SETTLED = ("won", "lost", "push")
# Columns added after the first release; created on old databases by conn().
NEW_COLUMNS = {"strategy": "TEXT", "event_id": "TEXT", "selection": "TEXT", "point": "REAL", "settled_at": "TEXT"}


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def conn() -> sqlite3.Connection:
    c = sqlite3.connect(DB)
    c.row_factory = sqlite3.Row
    c.execute("""CREATE TABLE IF NOT EXISTS bets (
        id INTEGER PRIMARY KEY AUTOINCREMENT, placed_at TEXT NOT NULL, event TEXT, sport TEXT,
        market TEXT DEFAULT 'moneyline', pick TEXT NOT NULL, book TEXT, odds REAL NOT NULL,
        stake REAL NOT NULL, status TEXT NOT NULL DEFAULT 'pending', closing_odds REAL,
        ev_pct REAL, notes TEXT)""")
    have = {r["name"] for r in c.execute("PRAGMA table_info(bets)")}
    for col, typ in NEW_COLUMNS.items():
        if col not in have:
            c.execute(f"ALTER TABLE bets ADD COLUMN {col} {typ}")
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
    strategy: Strategy | None = None
    event_id: str | None = None
    selection: str | None = None  # outcome name ("Lakers", "Over"); parsed from pick when missing
    point: float | None = None


FIELDS = list(BetIn.model_fields)


def profit(b) -> float:
    if b["status"] == "won":
        return b["stake"] * (american_to_decimal(b["odds"]) - 1)
    return -b["stake"] if b["status"] == "lost" else 0.0


def clv(b) -> float | None:
    if b["closing_odds"] is None:
        return None
    return (american_to_decimal(b["odds"]) / american_to_decimal(b["closing_odds"]) - 1) * 100


def out(b) -> dict:
    d = dict(b)
    d["profit"] = profit(b)
    d["clv_pct"] = clv(b)
    return d


class Filters(BaseModel):
    date_from: str | None = None  # YYYY-MM-DD, inclusive, on the placed date (UTC)
    date_to: str | None = None
    status: str | None = None
    sport: str | None = None
    book: str | None = None
    strategy: str | None = None


def query(c: sqlite3.Connection, f: Filters) -> list[sqlite3.Row]:
    where, args = [], []
    if f.date_from:
        where.append("substr(placed_at,1,10) >= ?")
        args.append(f.date_from)
    if f.date_to:
        where.append("substr(placed_at,1,10) <= ?")
        args.append(f.date_to)
    for col in ("status", "sport", "book", "strategy"):
        if v := getattr(f, col):
            where.append(f"{col} = ?")
            args.append(v)
    sql = "SELECT * FROM bets" + (f" WHERE {' AND '.join(where)}" if where else "")
    return c.execute(sql + " ORDER BY placed_at DESC, id DESC", args).fetchall()


def values(b: BetIn) -> tuple:
    d = b.model_dump()
    if d["selection"] is None:
        d["selection"], parsed = parse_pick(d["market"], d["pick"])
        if d["point"] is None:
            d["point"] = parsed
    return tuple(d[k] for k in FIELDS)


def insert(c: sqlite3.Connection, b: BetIn, placed_at: str | None = None, settled_at: str | None = None) -> int:
    placed_at = placed_at or now()
    settled_at = None if b.status == "pending" else settled_at or placed_at
    cur = c.execute(f"INSERT INTO bets (placed_at,settled_at,{','.join(FIELDS)}) "
                    f"VALUES (?,?,{','.join('?' * len(FIELDS))})",
                    (placed_at, settled_at, *values(b)))
    return cur.lastrowid


@router.get("")
def list_bets(f: Filters = Depends()):
    with conn() as c:
        return [out(r) for r in query(c, f)]


@router.post("")
def add_bet(b: BetIn):
    with conn() as c:
        bet_id = insert(c, b)
        return out(c.execute("SELECT * FROM bets WHERE id=?", (bet_id,)).fetchone())


@router.put("/{bet_id}")
def update_bet(bet_id: int, b: BetIn):
    with conn() as c:
        old = c.execute("SELECT * FROM bets WHERE id=?", (bet_id,)).fetchone()
        if old is None:
            raise HTTPException(404, "bet not found")
        settled_at = old["settled_at"]
        if b.status == "pending":
            settled_at = None
        elif old["status"] != b.status or settled_at is None:
            settled_at = now()
        c.execute(f"UPDATE bets SET {','.join(f'{k}=?' for k in FIELDS)}, settled_at=? WHERE id=?",
                  (*values(b), settled_at, bet_id))
        return out(c.execute("SELECT * FROM bets WHERE id=?", (bet_id,)).fetchone())


@router.delete("/{bet_id}")
def delete_bet(bet_id: int):
    with conn() as c:
        if not c.execute("DELETE FROM bets WHERE id=?", (bet_id,)).rowcount:
            raise HTTPException(404, "bet not found")
    return {"ok": True}


def day(r) -> str:
    """The day a bet's result counts on: when it settled, falling back to when it was placed."""
    return (r["settled_at"] or r["placed_at"])[:10]


def group(settled: list, key) -> list[dict]:
    """Bets/staked/profit/ROI per group, best profit first. key is a column name or a function."""
    g = defaultdict(lambda: {"bets": 0, "staked": 0.0, "profit": 0.0})
    for r in settled:
        x = g[(key(r) if callable(key) else r[key]) or "—"]
        x["bets"] += 1
        x["staked"] += r["stake"]
        x["profit"] += profit(r)
    return [{"name": k, **v, "roi_pct": v["profit"] / v["staked"] * 100 if v["staked"] else 0}
            for k, v in sorted(g.items(), key=lambda kv: -kv[1]["profit"])]


def daily(settled: list) -> list[dict]:
    """Per-day P/L in date order with a running total, for the profit chart and calendar."""
    g = defaultdict(lambda: {"bets": 0, "profit": 0.0})
    for r in settled:
        x = g[day(r)]
        x["bets"] += 1
        x["profit"] += profit(r)
    running, rows = 0.0, []
    for d in sorted(g):
        running += g[d]["profit"]
        rows.append({"date": d, **g[d], "cumulative": running})
    return rows


def summarize(rows: list) -> dict:
    settled = [r for r in rows if r["status"] in SETTLED]
    staked = sum(r["stake"] for r in settled)
    net = sum(profit(r) for r in settled)
    decided = [r for r in settled if r["status"] in ("won", "lost")]
    clvs = [v for r in rows if (v := clv(r)) is not None]
    return {
        "total_bets": len(rows),
        "pending": sum(r["status"] == "pending" for r in rows),
        "staked": staked,
        "profit": net,
        "roi_pct": net / staked * 100 if staked else 0,
        "win_rate_pct": sum(r["status"] == "won" for r in decided) / len(decided) * 100 if decided else 0,
        "avg_clv_pct": sum(clvs) / len(clvs) if clvs else None,
        "pos_clv_rate_pct": sum(v > 0 for v in clvs) / len(clvs) * 100 if clvs else None,
        "by_sport": group(settled, "sport"),
        "by_book": group(settled, "book"),
        "by_market": group(settled, "market"),
        "by_strategy": group(settled, lambda r: r["strategy"] or "manual"),
        "daily": daily(settled),
    }


@router.get("/stats")
def stats(f: Filters = Depends()):
    with conn() as c:
        return summarize(query(c, f))


CSV_COLUMNS = ["id", "placed_at", "settled_at", *FIELDS]


@router.get("/export.csv")
def export_csv(f: Filters = Depends()):
    buf = io.StringIO()
    w = csv.DictWriter(buf, CSV_COLUMNS, extrasaction="ignore")
    w.writeheader()
    with conn() as c:
        for r in query(c, f):
            w.writerow(dict(r))
    return Response(buf.getvalue(), media_type="text/csv",
                    headers={"Content-Disposition": 'attachment; filename="odderjam-bets.csv"'})


class CsvIn(BaseModel):
    csv: str


@router.post("/import")
def import_csv(body: CsvIn):
    """Add every valid row as a new bet (ids in the file are ignored). Blank cells mean 'not set'."""
    imported, errors = 0, []
    with conn() as c:
        for n, row in enumerate(csv.DictReader(io.StringIO(body.csv.lstrip("﻿"))), start=2):
            data = {k: v.strip() for k, v in row.items() if k in FIELDS and v is not None and v.strip() != ""}
            try:
                b = BetIn(**data)
            except ValidationError as e:
                errors.append({"line": n, "error": "; ".join(f"{'.'.join(map(str, x['loc']))}: {x['msg']}"
                                                            for x in e.errors())})
                continue
            insert(c, b, (row.get("placed_at") or "").strip() or None, (row.get("settled_at") or "").strip() or None)
            imported += 1
    return {"imported": imported, "errors": errors}


def match_game(bet, games: list[dict]) -> dict | None:
    """The game a bet is on: by event id, else by sport + 'Away @ Home' name, earliest start after placing."""
    if bet["event_id"]:
        for g in games:
            if g["id"] == bet["event_id"]:
                return g
    named = [g for g in games if g["sport"] == bet["sport"]
             and f'{g["away_team"]} @ {g["home_team"]}' == bet["event"]
             and g["commence_time"] >= bet["placed_at"][:19]]
    return min(named, key=lambda g: g["commence_time"], default=None)


@router.post("/settle")
def auto_settle():
    """Grade pending moneyline/spread/total bets from final scores. Spends Odds API credits."""
    with conn() as c:
        pending = [r for r in c.execute("SELECT * FROM bets WHERE status='pending'")
                   if r["market"] in SETTLEABLE]
        sports = sorted({r["sport"] for r in pending if r["sport"]})
        if not sports:
            return {"checked": 0, "settled": []}
        try:
            games = providers.get_scores(sports)
        except RuntimeError as e:
            raise HTTPException(400, str(e))
        settled = []
        for r in pending:
            g = match_game(r, games)
            score = g and final_scores(g)
            if not score:
                continue
            selection, point = r["selection"], r["point"]
            if selection is None:
                selection, point = parse_pick(r["market"], r["pick"])
            status = grade(r["market"], selection, point, g["home_team"], g["away_team"], *score)
            if status:
                c.execute("UPDATE bets SET status=?, settled_at=?, event_id=? WHERE id=?",
                          (status, now(), g["id"], r["id"]))
                settled.append({"id": r["id"], "pick": r["pick"], "status": status})
    return {"checked": len(pending), "settled": settled}


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
