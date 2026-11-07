from collections.abc import Iterator
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles

from .engine import arb as arbm, devig, ev, markets as mk, odds, sharp
from .providers.books import SHARP_BOOKS, US_BOOKS, max_sharp_hold, sharp_weights_spec, us_only
from .routes import bets
from .providers import cache_info, get_snapshot

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


@app.get("/api/sharps")
def sharp_settings():
    """Defaults for the fair-price settings in the UI."""
    return {"books": SHARP_BOOKS, "weights": sharp.parse_weights(sharp_weights_spec()),
            "max_hold": max_sharp_hold(), "methods": list(devig.METHODS)}


@app.get("/api/ev")
def positive_ev(book: str | None = None, min_ev: float = 0.0, method: str = "multiplicative", kelly: float = 0.25,
                sharps: str | None = None, max_hold: float | None = None, market: str | None = None):
    """+EV rows. `sharps` is 'Book:weight,...' (default SHARP_WEIGHTS); sharp books holding
    more than `max_hold` percent (default MAX_SHARP_HOLD) are left out of the fair price."""
    if method not in devig.METHODS:
        raise HTTPException(400, f"unknown devig method {method!r}")
    weights = sharp.parse_weights(sharps if sharps is not None else sharp_weights_spec())
    max_hold = max_sharp_hold() if max_hold is None else max_hold
    bankroll = max(bets.bankroll_info()["current"], 0.0)
    rows = []
    for e in get_snapshot():
        for key, g in _groups(e):
            if market and key != market:
                continue
            # Only sharps pricing every side of this exact line can devig it.
            fair = sharp.group_consensus(g["outcomes"], weights, method, max_hold)
            if fair is None:
                continue
            for o, fp in zip(g["outcomes"], fair["probs"]):
                for book_name, price in o["prices"].items():
                    if book_name not in US_BOOKS or (book and book_name != book):
                        continue
                    v = ev.ev_pct(fp, price)
                    if v >= min_ev:
                        rows.append({
                            "event": f'{e["away"]} @ {e["home"]}', "sport": e["sport"], "start": e["start"],
                            "market": key, "point": o["point"], "pick": mk.label(o), "book": book_name,
                            "odds": price, "fair_prob": fp, "fair_odds": odds.prob_to_american(fp), "ev_pct": v,
                            "stake": bankroll * ev.kelly_fraction(fp, price, kelly),
                            "sharps": fair["sharps"], "sharp_hold_pct": fair["hold_pct"],
                        })
    return sorted(rows, key=lambda r: -r["ev_pct"])


@app.get("/api/arbs")
def arbs(min_profit: float = 0.0, market: str | None = None):
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
                if result["profit_pct"] >= min_profit:
                    rows.append({"event": f'{e["away"]} @ {e["home"]}', "sport": e["sport"],
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
