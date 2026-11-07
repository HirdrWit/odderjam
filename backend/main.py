from collections.abc import Iterator
from pathlib import Path

from fastapi import Depends, FastAPI
from fastapi.staticfiles import StaticFiles

from .engine import arb as arbm, devig, ev, markets as mk, odds
from .providers.books import SHARP, US_BOOKS, us_only
from .routes import bets, filters as flt
from .routes.filters import FilterSet
from .providers import cache_info, get_snapshot

app = FastAPI(title="odderjam")
app.include_router(bets.router)
app.include_router(bets.bankroll_router)
app.include_router(flt.router)


def _us_markets(markets: dict) -> dict:
    """Markets with prices filtered to US books; outcomes and markets left empty are dropped."""
    out = {}
    for key, outcomes in markets.items():
        kept = [{**o, "prices": us_only(o["prices"])} for o in outcomes]
        kept = [o for o in kept if o["prices"]]
        if kept:
            out[key] = kept
    return out


@app.get("/api/odds")
def odds_screen(sport: str | None = None):
    shown = [{**e, "markets": _us_markets(e["markets"])} for e in get_snapshot()
             if not sport or e["sport"] == sport]
    return [e for e in shown if e["markets"]]


def _groups(e: dict) -> Iterator[tuple[str, dict]]:
    """Yield (market_key, line_group) for every complete line group in an event."""
    for key, outcomes in e["markets"].items():
        for g in mk.line_groups(key, outcomes, e["home"], e["away"]):
            yield key, g


def _sharp_hold(g: dict) -> float | None:
    """Hold % of the sharp book on this line, or None if it doesn't price every side."""
    if not all(SHARP in o["prices"] for o in g["outcomes"]):
        return None
    return -arbm.arb([o["prices"][SHARP] for o in g["outcomes"]])["profit_pct"]


def _filtered_groups(f: FilterSet) -> Iterator[tuple[dict, str, dict]]:
    """Yield (event, market_key, line_group) passing the event/market/sharp-hold filters."""
    for e in get_snapshot():
        if not f.sport_ok(e["sport"]) or not f.start_ok(e["start"]):
            continue
        for key, g in _groups(e):
            if f.market_ok(key) and f.hold_ok(_sharp_hold(g)):
                yield e, key, g


@app.get("/api/ev")
def positive_ev(method: str = "multiplicative", kelly: float = 0.25, f: FilterSet = Depends(flt.query_filters)):
    min_ev = f.min_ev if f.min_ev is not None else 0.0
    bankroll = max(bets.bankroll_info()["current"], 0.0)
    rows = []
    for e, key, g in _filtered_groups(f):
        if not all(SHARP in o["prices"] for o in g["outcomes"]):
            continue  # need the sharp price on every side of this exact line to devig
        probs = devig.METHODS[method]([odds.american_to_prob(o["prices"][SHARP]) for o in g["outcomes"]])
        for o, fp in zip(g["outcomes"], probs):
            for book_name, price in o["prices"].items():
                if book_name not in US_BOOKS or not f.book_ok(book_name) or not f.odds_ok(price):
                    continue
                v = ev.ev_pct(fp, price)
                if v >= min_ev:
                    rows.append({
                        "event": f'{e["away"]} @ {e["home"]}', "sport": e["sport"], "start": e["start"],
                        "market": key, "point": o["point"], "pick": mk.label(o), "book": book_name,
                        "odds": price, "fair_prob": fp, "fair_odds": odds.prob_to_american(fp), "ev_pct": v,
                        "stake": bankroll * ev.kelly_fraction(fp, price, kelly),
                    })
    return sorted(rows, key=lambda r: -r["ev_pct"])


@app.get("/api/arbs")
def arbs(f: FilterSet = Depends(flt.query_filters)):
    min_profit = f.min_profit if f.min_profit is not None else 0.0
    rows = []
    for e, key, g in _filtered_groups(f):
        best = []
        for o in g["outcomes"]:
            # Only books the user can bet at, and only prices inside the odds range.
            prices = {b: p for b, p in us_only(o["prices"]).items() if f.book_ok(b) and f.odds_ok(p)}
            if not prices:
                break
            best.append((o, *max(prices.items(), key=lambda kv: kv[1])))
        else:
            if len({book for _, book, _ in best}) < 2:
                continue
            result = arbm.arb([price for _, _, price in best])
            if result["profit_pct"] >= min_profit:
                rows.append({"event": f'{e["away"]} @ {e["home"]}', "sport": e["sport"], "start": e["start"],
                             "market": key, "point": g["point"],
                             "legs": [{"pick": mk.label(o), "point": o["point"], "book": book, "odds": price,
                                       "stake": stake}
                                      for (o, book, price), stake in zip(best, result["stakes"])],
                             "profit_pct": result["profit_pct"]})
    return sorted(rows, key=lambda r: -r["profit_pct"])


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
