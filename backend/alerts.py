"""Opportunity alerts: saved alert rules checked after each snapshot fetch.

Rules are only evaluated against data that is already on hand: after a live fetch
that happened anyway (UI refresh, cache expiry), at startup from the cache, and when
a rule is created. Alerts never trigger a fetch, so they cost no API credits.

New opportunities are deduped by event/market/outcome/book/price, stored in SQLite
for the browser to poll (and show as Notifications), and optionally posted to a
Discord webhook when DISCORD_WEBHOOK_URL is set.
"""
import json
import logging
import os
import sqlite3
import threading
from datetime import datetime, timezone
from typing import Literal

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from . import providers, scan
from .routes import bets

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/alerts")
_eval_lock = threading.Lock()

Kind = Literal["ev", "arb"]


def conn() -> sqlite3.Connection:
    c = bets.conn()  # same database file as the bet tracker
    c.execute("""CREATE TABLE IF NOT EXISTS alert_rules (
        id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, kind TEXT NOT NULL,
        min_value REAL NOT NULL DEFAULT 0, book TEXT, market TEXT, sport TEXT, created_at TEXT NOT NULL)""")
    c.execute("""CREATE TABLE IF NOT EXISTS opportunities (
        id INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL,
        rule_id INTEGER, rule_name TEXT, kind TEXT NOT NULL, title TEXT NOT NULL, value REAL NOT NULL,
        data TEXT NOT NULL)""")
    return c


# --- dedupe -----------------------------------------------------------------

def opportunity_key(kind: str, row: dict) -> str:
    """Identity of an opportunity: the same price at the same book on the same line is the same alert.

    A price move (or a different book) makes it a new opportunity.
    """
    base = f'{kind}|{row["event_id"]}|{row["market"]}|{row["point"]}'
    if kind == "ev":
        return f'{base}|{row["pick"]}|{row["book"]}|{row["odds"]:g}'
    legs = sorted(f'{leg["pick"]}@{leg["book"]}:{leg["odds"]:g}' for leg in row["legs"])
    return f'{base}|{",".join(legs)}'


def title(kind: str, row: dict) -> str:
    fmt = lambda o: f"{o:+g}"  # noqa: E731
    if kind == "ev":
        return f'+EV {row["ev_pct"]:.1f}%: {row["pick"]} {fmt(row["odds"])} @ {row["book"]} ({row["event"]})'
    legs = " / ".join(f'{leg["pick"]} {fmt(leg["odds"])} @ {leg["book"]}' for leg in row["legs"])
    return f'Arb {row["profit_pct"]:.2f}%: {legs} ({row["event"]})'


def matches(rule, events: list[dict]) -> list[tuple[str, dict]]:
    """(kind, row) for every opportunity in events that satisfies rule."""
    f = {"market": rule["market"] or None, "sport": rule["sport"] or None}
    if rule["kind"] == "ev":
        rows = scan.ev_rows(events, book=rule["book"] or None, min_ev=rule["min_value"], **f)
    else:
        rows = scan.arb_rows(events, min_profit=rule["min_value"], **f)
        if rule["book"]:
            rows = [r for r in rows if any(leg["book"] == rule["book"] for leg in r["legs"])]
    return [(rule["kind"], r) for r in rows]


def record(c: sqlite3.Connection, rule, kind: str, row: dict) -> dict | None:
    """Store an opportunity; None if it was already recorded (dedupe)."""
    t, v = title(kind, row), row["ev_pct"] if kind == "ev" else row["profit_pct"]
    cur = c.execute("""INSERT OR IGNORE INTO opportunities (key,created_at,rule_id,rule_name,kind,title,value,data)
                       VALUES (?,?,?,?,?,?,?,?)""",
                    (opportunity_key(kind, row), datetime.now(timezone.utc).isoformat(), rule["id"], rule["name"],
                     kind, t, v, json.dumps(row)))
    if not cur.rowcount:
        return None
    return out(c.execute("SELECT * FROM opportunities WHERE id=?", (cur.lastrowid,)).fetchone())


def evaluate(events: list[dict], rule_id: int | None = None) -> list[dict]:
    """Check saved rules against events; record and deliver opportunities not seen before."""
    if not events:
        return []
    with _eval_lock, conn() as c:
        q, args = ("SELECT * FROM alert_rules WHERE id=?", (rule_id,)) if rule_id else ("SELECT * FROM alert_rules", ())
        new = [o for rule in c.execute(q, args).fetchall()
               for kind, row in matches(rule, events)
               if (o := record(c, rule, kind, row))]
    if new:
        send_discord(new)
    return new


def _evaluate_safely(events: list[dict]) -> None:
    try:
        evaluate(events)
    except Exception:
        log.exception("alert evaluation failed")


# --- delivery ---------------------------------------------------------------

def send_discord(opps: list[dict]) -> bool:
    """Post opportunities to DISCORD_WEBHOOK_URL (if set). Returns True if anything was sent."""
    url = os.environ.get("DISCORD_WEBHOOK_URL", "").strip()
    if not url or not opps:
        return False
    chunks, cur = [], ""
    for line in (o["title"] for o in opps):
        line = line[:1900]
        if cur and len(cur) + len(line) + 1 > 1900:  # Discord caps messages at 2000 chars
            chunks.append(cur)
            cur = ""
        cur = f"{cur}\n{line}" if cur else line
    chunks.append(cur)
    try:
        for content in chunks:
            httpx.post(url, json={"content": content, "username": "odderjam"}, timeout=10).raise_for_status()
    except Exception:
        log.exception("Discord webhook failed")
        return False
    return True


# --- lifecycle --------------------------------------------------------------

def start() -> None:
    """Hook into snapshot fetches and check the data already on hand once (no fetch)."""
    providers.on_fetch(_evaluate_safely)
    threading.Thread(target=lambda: _evaluate_safely(providers.peek_snapshot()), daemon=True).start()


def stop() -> None:
    providers.off_fetch(_evaluate_safely)


# --- API --------------------------------------------------------------------

def out(r) -> dict:
    d = dict(r)
    if "data" in d:
        d["data"] = json.loads(d["data"])
    return d


class RuleIn(BaseModel):
    name: str = ""
    kind: Kind = "ev"
    min_value: float = 0.0
    book: str = ""
    market: str = ""
    sport: str = ""


@router.get("")
def list_alerts(after: int = 0, limit: int = 50):
    """Opportunities with id > after, newest first. latest_id lets a client start from 'now'."""
    with conn() as c:
        latest = c.execute("SELECT COALESCE(MAX(id), 0) FROM opportunities").fetchone()[0]
        rows = c.execute("SELECT * FROM opportunities WHERE id>? ORDER BY id DESC LIMIT ?",
                         (after, max(1, min(limit, 500)))).fetchall()
    return {"latest_id": latest, "discord": bool(os.environ.get("DISCORD_WEBHOOK_URL", "").strip()),
            "items": [out(r) for r in rows]}


@router.get("/rules")
def list_rules():
    with conn() as c:
        return [dict(r) for r in c.execute("SELECT * FROM alert_rules ORDER BY id")]


@router.post("/rules")
def add_rule(r: RuleIn):
    name = r.name.strip() or f'{"+EV" if r.kind == "ev" else "Arb"} ≥ {r.min_value:g}%' + (f" @ {r.book}" if r.book else "")
    with conn() as c:
        cur = c.execute("INSERT INTO alert_rules (name,kind,min_value,book,market,sport,created_at) "
                        "VALUES (?,?,?,?,?,?,?)",
                        (name, r.kind, r.min_value, r.book, r.market, r.sport,
                         datetime.now(timezone.utc).isoformat()))
        rule = dict(c.execute("SELECT * FROM alert_rules WHERE id=?", (cur.lastrowid,)).fetchone())
    # Check the new rule against data already on hand (never fetches).
    rule["new_alerts"] = len(evaluate(providers.peek_snapshot(), rule_id=rule["id"]))
    return rule


@router.delete("/rules/{rule_id}")
def delete_rule(rule_id: int):
    with conn() as c:
        if not c.execute("DELETE FROM alert_rules WHERE id=?", (rule_id,)).rowcount:
            raise HTTPException(404, "rule not found")
    return {"ok": True}
