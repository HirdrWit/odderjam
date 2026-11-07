"""Filter sets for +EV / Arbs, and named presets stored in SQLite (so alerts can reuse them)."""
import json
import sqlite3
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from . import bets

router = APIRouter(prefix="/api/filters")


class FilterSet(BaseModel):
    """Every field is optional; an empty list / None means "don't filter on this"."""
    sports: list[str] = []
    books: list[str] = []
    markets: list[str] = []
    odds_min: float | None = None  # American odds, applied to the bet price (every leg for arbs)
    odds_max: float | None = None
    start_within_hours: float | None = None
    min_ev: float | None = None  # +EV only
    min_profit: float | None = None  # Arbs only
    max_sharp_hold: float | None = None  # hold % of the sharp book's line; lines without a sharp price fail

    def sport_ok(self, sport: str) -> bool:
        return not self.sports or sport in self.sports

    def book_ok(self, book: str) -> bool:
        return not self.books or book in self.books

    def market_ok(self, market: str) -> bool:
        return not self.markets or market in self.markets

    def odds_ok(self, price: float) -> bool:
        return ((self.odds_min is None or price >= self.odds_min)
                and (self.odds_max is None or price <= self.odds_max))

    def start_ok(self, start: str, now: datetime | None = None) -> bool:
        if self.start_within_hours is None:
            return True
        try:
            t = datetime.fromisoformat(start)
        except (TypeError, ValueError):
            return False
        if t.tzinfo is None:
            t = t.replace(tzinfo=timezone.utc)
        return t <= (now or datetime.now(timezone.utc)) + timedelta(hours=self.start_within_hours)

    def hold_ok(self, hold_pct: float | None) -> bool:
        if self.max_sharp_hold is None:
            return True
        return hold_pct is not None and hold_pct <= self.max_sharp_hold


def _split(values: list[str] | None) -> list[str]:
    """Accept both repeated params (?sports=NBA&sports=NFL) and comma lists (?sports=NBA,NFL)."""
    return [v.strip() for raw in values or [] for v in raw.split(",") if v.strip()]


def query_filters(
    preset: int | None = None,
    sports: list[str] | None = Query(None),
    books: list[str] | None = Query(None),
    markets: list[str] | None = Query(None),
    odds_min: float | None = None,
    odds_max: float | None = None,
    start_within_hours: float | None = None,
    min_ev: float | None = None,
    min_profit: float | None = None,
    max_sharp_hold: float | None = None,
    book: str | None = None,
    market: str | None = None,
) -> FilterSet:
    """Build a FilterSet from query params, on top of a saved preset if one is given.

    Params passed explicitly override the preset's values. ``book`` / ``market`` are the older
    single-value params, kept as aliases for ``books`` / ``markets``.
    """
    base = get_filter(preset)["filters"] if preset is not None else {}
    given = {"sports": _split(sports), "books": _split(books) + _split([book] if book else None),
             "markets": _split(markets) + _split([market] if market else None),
             "odds_min": odds_min, "odds_max": odds_max, "start_within_hours": start_within_hours,
             "min_ev": min_ev, "min_profit": min_profit, "max_sharp_hold": max_sharp_hold}
    return FilterSet(**{**base, **{k: v for k, v in given.items() if v not in (None, [])}})


class PresetIn(BaseModel):
    name: str
    filters: FilterSet = FilterSet()


def conn() -> sqlite3.Connection:
    c = bets.conn()
    c.execute("""CREATE TABLE IF NOT EXISTS filters (
        id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, params TEXT NOT NULL,
        created_at TEXT NOT NULL)""")
    return c


def _out(r) -> dict:
    return {"id": r["id"], "name": r["name"], "filters": FilterSet(**json.loads(r["params"])).model_dump(),
            "created_at": r["created_at"]}


@router.get("")
def list_filters():
    with conn() as c:
        return [_out(r) for r in c.execute("SELECT * FROM filters ORDER BY name")]


@router.get("/{filter_id}")
def get_filter(filter_id: int):
    with conn() as c:
        r = c.execute("SELECT * FROM filters WHERE id=?", (filter_id,)).fetchone()
    if not r:
        raise HTTPException(404, "filter preset not found")
    return _out(r)


@router.post("")
def add_filter(p: PresetIn):
    try:
        with conn() as c:
            cur = c.execute("INSERT INTO filters (name, params, created_at) VALUES (?,?,?)",
                            (p.name, p.filters.model_dump_json(), datetime.now(timezone.utc).isoformat()))
    except sqlite3.IntegrityError:
        raise HTTPException(409, "a preset with that name already exists")
    return get_filter(cur.lastrowid)


@router.put("/{filter_id}")
def update_filter(filter_id: int, p: PresetIn):
    try:
        with conn() as c:
            cur = c.execute("UPDATE filters SET name=?, params=? WHERE id=?",
                            (p.name, p.filters.model_dump_json(), filter_id))
    except sqlite3.IntegrityError:
        raise HTTPException(409, "a preset with that name already exists")
    if not cur.rowcount:
        raise HTTPException(404, "filter preset not found")
    return get_filter(filter_id)


@router.delete("/{filter_id}")
def delete_filter(filter_id: int):
    with conn() as c:
        if not c.execute("DELETE FROM filters WHERE id=?", (filter_id,)).rowcount:
            raise HTTPException(404, "filter preset not found")
    return {"ok": True}
