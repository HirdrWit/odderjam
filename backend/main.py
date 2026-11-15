import math
import time
from collections.abc import Iterator
from pathlib import Path
from statistics import median

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from fastapi.staticfiles import StaticFiles

from .engine import arb as arbm, devig, ev, live as _live_mod, lowhold, markets as mk, middles as mid, odds
from .providers.books import SHARP, US_BOOKS, us_only
from .routes import bets
from .providers import cache_info, get_snapshot, live_config, live_status, set_live

app = FastAPI(title="odderjam")
app.include_router(bets.router)
app.include_router(bets.bankroll_router)


def _us_markets(markets: dict) -> dict:
    """Markets with prices filtered to US books; outcomes and markets left empty are dropped."""
    out = {}
    for key, outcomes in markets.items():
        kept = [{**o, "prices": us_only(o["prices"])} for o in outcomes]
        kept = [o for o in kept if o["prices"]]
        if kept:
            out[key] = kept
    return out


def _now() -> float:
    return time.time()


def _shown_books(markets: dict) -> set[str]:
    return {b for outcomes in markets.values() for o in outcomes for b in o["prices"]}


@app.get("/api/odds")
def odds_screen(sport: str | None = None, live: bool | None = None):
    now = _now()
    rows = []
    for e in get_snapshot():
        if sport and e["sport"] != sport:
            continue
        is_live = _live_mod.is_live(e, now)
        if live is not None and is_live != live:
            continue
        markets = _us_markets(e["markets"])
        if not markets:
            continue
        rows.append({**e, "markets": markets, "live": is_live,
                     "price_age_seconds": _live_mod.price_age(e.get("updated", {}), _shown_books(markets), now)})
    return rows


def _freshness(e: dict, books, now: float) -> dict | None:
    """Row fields for a tool row on event `e` priced at `books`; None if the row must be dropped.

    With live mode on, a live event's row is dropped when any of its prices is older than
    max_price_age (or has no timestamp): a stale in-play price is a phantom edge. Pre-game rows are kept.
    """
    is_live = _live_mod.is_live(e, now)
    updated = e.get("updated", {})
    age = _live_mod.price_age(updated, books, now)
    if any(b not in updated for b in books):
        age = None  # a leg without a timestamp makes the row's age unknown
    cfg = live_config()
    if cfg["enabled"] and is_live and _live_mod.is_stale(age, cfg["max_price_age"]):
        return None
    return {"event_id": e["id"], "live": is_live, "price_age_seconds": age}


def _groups(e: dict) -> Iterator[tuple[str, dict]]:
    """Yield (market_key, line_group) for every complete line group in an event."""
    for key, outcomes in e["markets"].items():
        for g in mk.line_groups(key, outcomes, e["home"], e["away"]):
            yield key, g


@app.get("/api/ev")
def positive_ev(book: str | None = None, min_ev: float = 0.0, method: str = "multiplicative", kelly: float = 0.25,
                market: str | None = None):
    bankroll = max(bets.bankroll_info()["current"], 0.0)
    now = _now()
    rows = []
    for e in get_snapshot():
        for key, g in _groups(e):
            if market and key != market:
                continue
            if not all(SHARP in o["prices"] for o in g["outcomes"]):
                continue  # need the sharp price on every side of this exact line to devig
            probs = devig.METHODS[method]([odds.american_to_prob(o["prices"][SHARP]) for o in g["outcomes"]])
            for o, fp in zip(g["outcomes"], probs):
                for book_name, price in o["prices"].items():
                    if book_name not in US_BOOKS or (book and book_name != book):
                        continue
                    v = ev.ev_pct(fp, price)
                    if v < min_ev:
                        continue
                    fresh = _freshness(e, [book_name, SHARP], now)
                    if fresh is not None:
                        rows.append({
                            "event": f'{e["away"]} @ {e["home"]}', "sport": e["sport"], "start": e["start"],
                            "market": key, "point": o["point"], "pick": mk.label(o), "book": book_name,
                            "odds": price, "fair_prob": fp, "fair_odds": odds.prob_to_american(fp), "ev_pct": v,
                            "stake": bankroll * ev.kelly_fraction(fp, price, kelly), **fresh,
                        })
    return sorted(rows, key=lambda r: -r["ev_pct"])


@app.get("/api/arbs")
def arbs(min_profit: float = 0.0, market: str | None = None):
    now = _now()
    rows = []
    for e in get_snapshot():
        for key, g in _groups(e):
            if market and key != market:
                continue
            best = []
            for o in g["outcomes"]:
                us_prices = us_only(o["prices"])
                if not us_prices:
                    break
                best.append((o, *max(us_prices.items(), key=lambda kv: kv[1])))
            else:
                if len({book for _, book, _ in best}) < 2:
                    continue
                result = arbm.arb([price for _, _, price in best])
                if result["profit_pct"] < min_profit:
                    continue
                fresh = _freshness(e, [book for _, book, _ in best], now)
                if fresh is not None:
                    rows.append({"event": f'{e["away"]} @ {e["home"]}', "sport": e["sport"],
                                 "market": key, "point": g["point"],
                                 "legs": [{"pick": mk.label(o), "point": o["point"], "book": book, "odds": price,
                                           "stake": stake}
                                          for (o, book, price), stake in zip(best, result["stakes"])],
                                 "profit_pct": result["profit_pct"], **fresh})
    return sorted(rows, key=lambda r: -r["profit_pct"])


@app.get("/api/lowhold")
def low_hold(max_hold: float = 1.0, book: str | None = None, stake: float = 100.0, market: str | None = None):
    """Two-sided bets that cover both outcomes for the smallest hold, for clearing rollover.

    With ``book`` set, one leg must be at that book. Sorted by hold, lowest first.
    """
    now = _now()
    rows = []
    for e in get_snapshot():
        for key, g in _groups(e):
            if (market and key != market) or len(g["outcomes"]) != 2:
                continue  # three-way markets can't be covered with two bets
            a, b = g["outcomes"]
            # Empty string means any book.
            pair = lowhold.best_pair(us_only(a["prices"]), us_only(b["prices"]), book or None, stake)
            if pair is None or pair["hold_pct"] > max_hold:
                continue
            fresh = _freshness(e, [leg["book"] for leg in pair["legs"]], now)
            if fresh is None:
                continue
            for o, leg in zip(g["outcomes"], pair["legs"]):
                leg.update(pick=mk.label(o), point=o["point"])
            rows.append({"event": f'{e["away"]} @ {e["home"]}', "sport": e["sport"], "start": e["start"],
                         "market": key, "point": g["point"], "stake": stake, **pair, **fresh})
    return sorted(rows, key=lambda r: r["hold_pct"])


def _middle_sides(key: str, outcomes: list[dict], home: str) -> tuple[dict, dict]:
    """Split a spreads/totals market into low-line ("over") and high-line ("under") legs.

    Both are keyed by the line on one scoring variable (total, or home margin for spreads):
    an over leg wins above its line, an under leg below. Values are [(price, book, outcome)].
    """
    over: dict[float, list] = {}
    under: dict[float, list] = {}
    for o in outcomes:
        if o.get("point") is None:
            continue
        if key == "totals":
            if o["name"] == "Over":
                side, line = over, o["point"]
            elif o["name"] == "Under":
                side, line = under, o["point"]
            else:
                continue
        elif o["name"] == home:  # home -3.5 wins when margin > 3.5
            side, line = over, -o["point"]
        else:  # away +4.5 wins when margin < 4.5
            side, line = under, o["point"]
        for book, price in us_only(o["prices"]).items():
            side.setdefault(line, []).append((price, book, o))
    return over, under


def _center(key: str, outcomes: list[dict], home: str) -> float:
    """Expected result: the sharp book's line if it has one, else the median line across books."""
    sign = -1 if key == "spreads" else 1  # home point -3.5 means an expected home margin of +3.5
    priced = [(sign * mk.line_key(key, o, home), o) for o in outcomes if o.get("point") is not None]
    lines = [ln for ln, _ in priced]
    sharp = [ln for ln, o in priced if SHARP in o["prices"]]
    return median(sharp or lines)


@app.get("/api/middles")
def middles(
    min_window: float = 0.0,
    max_cost: float | None = None,
    market: str | None = None,
    stake: float = 100.0,
) -> list[dict]:
    """Middles across books. `max_cost` caps the worst-case loss as a percent of total stake."""
    now = _now()
    rows = []
    for e in get_snapshot():
        for key in ("spreads", "totals"):
            if (market and key != market) or not e["markets"].get(key):
                continue
            outcomes = e["markets"][key]
            over, under = _middle_sides(key, outcomes, e["home"])
            pmf = mid.model_pmf(e["sport"], key, _center(key, outcomes, e["home"]))
            for la, overs in over.items():
                for lb, unders in under.items():
                    if lb - la <= 0 or lb - la < min_window:
                        continue
                    pairs = [(a, b) for a in overs for b in unders if a[1] != b[1]]
                    if not pairs:
                        continue

                    def worst_case(pair):
                        (price_a, *_), (price_b, *_) = pair
                        return mid.middle(la, price_a, lb, price_b)["worst_case"]

                    (pa, ba, oa), (pb, bb, ob) = max(pairs, key=worst_case)
                    m = mid.middle(la, pa, lb, pb, stake)
                    cost_pct = max(-m["worst_case"], 0.0) / stake * 100
                    if max_cost is not None and cost_pct > max_cost:
                        continue
                    fresh = _freshness(e, [ba, bb], now)
                    if fresh is None:
                        continue
                    rows.append({
                        "event": f'{e["away"]} @ {e["home"]}', "sport": e["sport"], "start": e["start"],
                        "market": key, "window": m["window"], "low": la, "high": lb,
                        "legs": [{"pick": mk.label(o), "point": o["point"], "book": b, "odds": p, "stake": s}
                                 for o, b, p, s in ((oa, ba, pa, m["stake_a"]), (ob, bb, pb, m["stake_b"]))],
                        "win_both": m["win_both"], "worst_case": m["worst_case"], "cost_pct": cost_pct,
                        **mid.middle_ev(m, la, pa, lb, pb, pmf), **fresh,
                    })
    return sorted(rows, key=lambda r: -r["ev_pct"])


class LiveSettings(BaseModel):
    """Live-mode settings; every field optional, only those sent are changed."""
    enabled: bool | None = None
    interval_seconds: float | None = Field(default=None, gt=0)
    credits_per_hour: float | None = Field(default=None, ge=0)
    max_price_age: float | None = Field(default=None, gt=0)


def _live_payload() -> dict:
    now = _now()
    return {**live_status(), "live_events": sum(_live_mod.is_live(e, now) for e in get_snapshot())}


@app.get("/api/live")
def live_get():
    return _live_payload()


@app.post("/api/live")
def live_post(body: LiveSettings):
    changes = body.model_dump(exclude_none=True)
    # Checked here, not with allow_inf_nan: FastAPI's 422 body echoes the input, and inf is not valid JSON.
    if any(isinstance(v, float) and not math.isfinite(v) for v in changes.values()):
        raise HTTPException(422, "settings must be finite numbers")
    set_live(**changes)
    return _live_payload()


@app.post("/api/refresh")
def refresh():
    get_snapshot(force=True)
    return cache_info()


@app.get("/api/cache")
def cache():
    return cache_info()


@app.get("/api/health")
def health():
    return {"ok": True}


dist = Path(__file__).resolve().parent.parent / "frontend" / "dist"
if dist.exists():
    app.mount("/", StaticFiles(directory=dist, html=True), name="ui")
