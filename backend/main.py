from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from . import history
from .engine import arb as arbm, devig, ev, odds
from .providers.books import SHARP, US_BOOKS, us_only
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


@app.get("/api/ev")
def positive_ev(book: str | None = None, min_ev: float = 0.0, method: str = "multiplicative", kelly: float = 0.25):
    bankroll = max(bets.bankroll_info()["current"], 0.0)
    rows = []
    for e in get_snapshot():
        ml = e["markets"]["moneyline"]
        if SHARP not in ml:
            continue
        sh = ml[SHARP]
        probs = devig.METHODS[method]([odds.american_to_prob(sh["home"]), odds.american_to_prob(sh["away"])])
        for side, fp in zip(("home", "away"), probs):
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
                        "event_id": e["id"], "market": "moneyline", "outcome": side, "point": None,
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


@app.get("/api/history/{event_id}")
def odds_history(event_id: str, market: str = "moneyline"):
    """Every stored price for one event and market, oldest first."""
    return history.history(event_id, market)


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
