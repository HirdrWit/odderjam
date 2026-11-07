from collections.abc import Iterator
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles

from .engine import arb as arbm, devig, ev, markets as mk, odds, sizing
from .providers.books import SHARP, US_BOOKS, us_only
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


@app.get("/api/ev")
def positive_ev(book: str | None = None, min_ev: float = 0.0, method: str = "multiplicative", kelly: float = 0.25,
                market: str | None = None, round_to: float = 1.0, max_side: float | None = None):
    _check_sizing(round_to, max_side)
    bankroll = max(bets.bankroll_info()["current"], 0.0)
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
                    if v >= min_ev:
                        kelly_stake = bankroll * ev.kelly_fraction(fp, price, kelly)
                        rows.append({
                            "event": f'{e["away"]} @ {e["home"]}', "sport": e["sport"], "start": e["start"],
                            "market": key, "point": o["point"], "pick": mk.label(o), "book": book_name,
                            "odds": price, "fair_prob": fp, "fair_odds": odds.prob_to_american(fp), "ev_pct": v,
                            "stake": sizing.round_stake(kelly_stake, round_to, max_side),
                            "kelly_stake": kelly_stake,
                        })
    return sorted(rows, key=lambda r: -r["ev_pct"])


def _check_sizing(round_to: float, max_side: float | None) -> None:
    try:
        sizing.stake_cap(round_to, max_side)
    except ValueError as err:
        raise HTTPException(400, str(err)) from err


@app.get("/api/arbs")
def arbs(min_profit: float = 0.0, market: str | None = None, total: float | None = None, round_to: float = 1.0,
         max_side: float | None = None):
    """Arbs sized to `total` (default: current bankroll), rounded to `round_to`, capped at `max_side`."""
    _check_sizing(round_to, max_side)
    if total is None or total <= 0:
        total = bets.bankroll_info()["current"]
        total = total if total > 0 else 100.0
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
                    sized = sizing.size_arb([price for _, _, price in best], total, round_to, max_side)
                    rows.append({"event": f'{e["away"]} @ {e["home"]}', "sport": e["sport"],
                                 "market": key, "point": g["point"],
                                 "legs": [{"pick": mk.label(o), "point": o["point"], "book": book, "odds": price,
                                           "stake": stake, "ideal_stake": ideal, "profit_if_wins": won}
                                          for (o, book, price), stake, ideal, won
                                          in zip(best, sized["stakes"], sized["ideal_stakes"], sized["profits"])],
                                 "profit_pct": result["profit_pct"],
                                 **{k: sized[k] for k in ("total_stake", "min_profit", "max_profit", "min_profit_pct",
                                                          "capped", "rounding_loss", "warning")}})
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
