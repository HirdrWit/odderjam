from collections.abc import Iterator
from pathlib import Path

from typing import Literal

from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles

from .engine import arb as arbm, devig, ev, markets as mk, odds, promo as pm
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
                market: str | None = None):
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
                        rows.append({
                            "event": f'{e["away"]} @ {e["home"]}', "sport": e["sport"], "start": e["start"],
                            "market": key, "point": o["point"], "pick": mk.label(o), "book": book_name,
                            "odds": price, "fair_prob": fp, "fair_odds": odds.prob_to_american(fp), "ev_pct": v,
                            "stake": bankroll * ev.kelly_fraction(fp, price, kelly),
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


PromoKind = Literal["bonus-bet", "profit-boost", "second-chance"]


def _convert(kind: PromoKind, amount: float, promo_odds: float, hedge_odds: float, boost_pct: float,
             max_boost: float | None, refund_value: float) -> dict:
    if kind == "bonus-bet":
        return pm.bonus_bet_hedge(amount, promo_odds, hedge_odds)
    if kind == "profit-boost":
        return pm.profit_boost_hedge(amount, promo_odds, hedge_odds, boost_pct, max_boost)
    return pm.second_chance_hedge(amount, promo_odds, hedge_odds, refund_value=refund_value)


@app.get("/api/promo/{kind}")
def promo_conversions(kind: PromoKind, book: str, amount: float = 100.0, boost_pct: float = 0.0,
                      max_boost: float | None = None, refund_value: float = 0.7, market: str | None = None,
                      limit: int = 50):
    """Rank two-sided bets by how well they convert a promo at `book` into locked cash.

    The promo goes on one side at `book`; the other side is hedged with cash at the best other US book.
    """
    if book not in US_BOOKS:
        raise HTTPException(400, f"unknown US book: {book}")
    if amount <= 0:
        raise HTTPException(400, "amount must be positive")
    rows = []
    for e in get_snapshot():
        for key, g in _groups(e):
            if (market and key != market) or len(g["outcomes"]) != 2:
                continue  # a single cash hedge only covers two-way markets
            for side, other in (g["outcomes"], g["outcomes"][::-1]):
                if book not in side["prices"]:
                    continue
                hedges = {b: p for b, p in us_only(other["prices"]).items() if b != book}
                if not hedges:
                    continue
                hedge_book, hedge_odds = max(hedges.items(), key=lambda kv: kv[1])
                r = _convert(kind, amount, side["prices"][book], hedge_odds, boost_pct, max_boost, refund_value)
                rows.append({
                    "event": f'{e["away"]} @ {e["home"]}', "sport": e["sport"], "start": e["start"],
                    "market": key, "point": g["point"], "kind": kind,
                    "profit": r["profit"], "conversion_pct": r["conversion_pct"],
                    "boosted_odds": r.get("boosted_odds"),
                    "legs": [
                        {"pick": mk.label(side), "point": side["point"], "book": book,
                         "odds": side["prices"][book], "stake": amount, "is_bonus": kind == "bonus-bet",
                         "promo": True},
                        {"pick": mk.label(other), "point": other["point"], "book": hedge_book,
                         "odds": hedge_odds, "stake": r["hedge_stake"], "is_bonus": False, "promo": False},
                    ],
                })
    rows.sort(key=lambda r: -r["conversion_pct"])
    return rows[:limit]


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
