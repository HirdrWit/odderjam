from collections.abc import Iterator
from math import prod
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from .engine import arb as arbm, devig, ev, markets as mk, odds, parlay as pm
from .providers.books import SGP_BOOKS, SHARP, US_BOOKS, us_only
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
                            "event_id": e["id"], "event": f'{e["away"]} @ {e["home"]}', "sport": e["sport"],
                            "start": e["start"], "market": key, "name": o["name"], "point": o["point"],
                            "pick": mk.label(o), "book": book_name,
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


class LegIn(BaseModel):
    event_id: str
    market: str
    name: str
    point: float | None = None


class ParlayIn(BaseModel):
    legs: list[LegIn] = Field(min_length=2)
    method: str = "multiplicative"
    kelly: float = 0.25


def _fair_prob(e: dict, key: str, outcome: dict, method: str) -> float | None:
    """No-vig probability of an outcome from the sharp book, or None if the sharp doesn't price its line."""
    for k, g in _groups(e):
        if k == key and any(o is outcome for o in g["outcomes"]):
            if not all(SHARP in o["prices"] for o in g["outcomes"]):
                return None
            probs = devig.METHODS[method]([odds.american_to_prob(o["prices"][SHARP]) for o in g["outcomes"]])
            return probs[[o is outcome for o in g["outcomes"]].index(True)]
    return None


@app.post("/api/parlay")
def price_parlay(p: ParlayIn):
    """Price a parlay at every US book that offers all its legs.

    Fair probability is the product of each leg's no-vig probability (independence assumed).
    Legs from the same event are flagged; books without same-game parlays are marked blocked.
    """
    if p.method not in devig.METHODS:
        raise HTTPException(400, f"unknown devig method {p.method!r}")
    events = {e["id"]: e for e in get_snapshot()}
    legs = []
    for leg in p.legs:
        e = events.get(leg.event_id)
        outcome = e and next((o for o in e["markets"].get(leg.market, [])
                              if o["name"] == leg.name and o["point"] == leg.point), None)
        if not outcome:
            raise HTTPException(404, f"leg not found: {leg.event_id} {leg.market} {leg.name} {leg.point}")
        legs.append((leg, e, outcome))

    seen: dict[str, set[str]] = {}
    for leg, _, _ in legs:
        if leg.market in seen.setdefault(leg.event_id, set()):
            raise HTTPException(400, f"two legs from the same market in event {leg.event_id}")
        seen[leg.event_id].add(leg.market)
    same_game = len(seen) < len(legs)

    fair = [_fair_prob(e, leg.market, o, p.method) for leg, e, o in legs]
    fair_known = all(f is not None for f in fair)
    bankroll = max(bets.bankroll_info()["current"], 0.0)
    books = set.intersection(*(set(us_only(o["prices"])) for _, _, o in legs))
    rows = []
    for book in books:
        prices = [o["prices"][book] for _, _, o in legs]
        r = pm.parlay(prices, fair if fair_known else None, p.kelly)
        rows.append({
            "book": book, "odds": r["american"], "decimal": r["decimal"], "leg_odds": prices,
            "ev_pct": r.get("ev_pct"),
            "stake": bankroll * r["kelly_fraction"] if fair_known else None,
            "blocked": same_game and book not in SGP_BOOKS,
        })
    rows.sort(key=lambda r: (r["blocked"], -r["decimal"]))
    fair_prob = prod(fair) if fair_known else None
    return {
        "legs": [{"event_id": leg.event_id, "event": f'{e["away"]} @ {e["home"]}', "sport": e["sport"],
                  "market": leg.market, "name": leg.name, "point": leg.point, "pick": mk.label(o), "fair_prob": f}
                 for (leg, e, o), f in zip(legs, fair)],
        "same_game": same_game,
        "fair_prob": fair_prob,
        "fair_odds": odds.prob_to_american(fair_prob) if fair_prob else None,
        "books": rows,
    }


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
