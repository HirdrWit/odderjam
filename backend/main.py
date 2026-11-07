from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles

from .engine import arb as arbm, devig, ev, odds, sharp
from .providers.books import SHARP_BOOKS, US_BOOKS, max_sharp_hold, sharp_weights_spec, us_only
from .routes import bets
from .providers import cache_info, get_snapshot

app = FastAPI(title="odderjam")
app.include_router(bets.router)
app.include_router(bets.bankroll_router)


@app.get("/api/odds")
def odds_screen(sport: str | None = None):
    evs = get_snapshot()
    shown = [{**e, "markets": {"moneyline": us_only(e["markets"]["moneyline"])}} for e in evs
             if not sport or e["sport"] == sport]
    return [e for e in shown if e["markets"]["moneyline"]]


@app.get("/api/sharps")
def sharp_settings():
    """Defaults for the fair-price settings in the UI."""
    return {"books": SHARP_BOOKS, "weights": sharp.parse_weights(sharp_weights_spec()),
            "max_hold": max_sharp_hold(), "methods": list(devig.METHODS)}


@app.get("/api/ev")
def positive_ev(book: str | None = None, min_ev: float = 0.0, method: str = "multiplicative", kelly: float = 0.25,
                sharps: str | None = None, max_hold: float | None = None):
    """+EV rows. `sharps` is 'Book:weight,...' (default SHARP_WEIGHTS); sharp books holding
    more than `max_hold` percent (default MAX_SHARP_HOLD) are left out of the fair price."""
    if method not in devig.METHODS:
        raise HTTPException(400, f"unknown devig method {method!r}")
    weights = sharp.parse_weights(sharps if sharps is not None else sharp_weights_spec())
    max_hold = max_sharp_hold() if max_hold is None else max_hold
    bankroll = max(bets.bankroll_info()["current"], 0.0)
    rows = []
    for e in get_snapshot():
        ml = e["markets"]["moneyline"]
        fair = sharp.consensus(ml, weights, method, max_hold)
        if fair is None:
            continue
        for side in ("home", "away"):
            fp = fair[side]
            for book_name, o in ml.items():
                if book_name not in US_BOOKS or (book and book_name != book):
                    continue
                v = ev.ev_pct(fp, o[side])
                if v >= min_ev:
                    rows.append({
                        "event": f'{e["away"]} @ {e["home"]}', "sport": e["sport"], "start": e["start"],
                        "pick": e[side], "book": book_name, "odds": o[side], "fair_prob": fp,
                        "fair_odds": odds.prob_to_american(fp), "ev_pct": v,
                        "stake": bankroll * ev.kelly_fraction(fp, o[side], kelly),
                        "sharps": fair["sharps"], "sharp_hold_pct": fair["hold_pct"],
                    })
    return sorted(rows, key=lambda r: -r["ev_pct"])


@app.get("/api/arbs")
def arbs(min_profit: float = 0.0):
    rows = []
    for e in get_snapshot():
        ml = us_only(e["markets"]["moneyline"])
        if len(ml) < 2:
            continue
        bh = max(ml.items(), key=lambda kv: kv[1]["home"])
        ba = max(ml.items(), key=lambda kv: kv[1]["away"])
        if bh[0] == ba[0]:
            continue
        r = arbm.arb([bh[1]["home"], ba[1]["away"]])
        if r["profit_pct"] >= min_profit:
            rows.append({"event": f'{e["away"]} @ {e["home"]}', "sport": e["sport"],
                         "legs": [{"pick": e["home"], "book": bh[0], "odds": bh[1]["home"], "stake": r["stakes"][0]},
                                  {"pick": e["away"], "book": ba[0], "odds": ba[1]["away"], "stake": r["stakes"][1]}],
                         "profit_pct": r["profit_pct"]})
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
