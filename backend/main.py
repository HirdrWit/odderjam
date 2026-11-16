from collections.abc import Iterator
from math import prod
from pathlib import Path
from statistics import median
from typing import Literal

from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import history
from .engine import arb as arbm, devig, ev, lowhold, markets as mk, middles as mid, odds, parlay as pm, promo, sharp, sizing
from .providers.books import SGP_BOOKS, SHARP, SHARP_BOOKS, US_BOOKS, bet_link, max_sharp_hold, sharp_weights_spec, us_only
from .routes import bets
from .providers import cache_info, get_snapshot

app = FastAPI(title="odderjam")
app.include_router(bets.router)
app.include_router(bets.bankroll_router)


def _us_markets(markets: dict) -> dict:
    """Markets with prices filtered to US books; outcomes and markets left empty are dropped."""
    out = {}
    for key, outcomes in markets.items():
        kept = [{**o, "prices": us_only(o["prices"]), "links": us_only(o.get("links") or {})} for o in outcomes]
        kept = [o for o in kept if o["prices"]]
        if kept:
            out[key] = kept
    return out


@app.get("/api/odds")
def odds_screen(sport: str | None = None):
    shown = [{**e, "markets": _us_markets(e["markets"])} for e in get_snapshot()
             if not sport or e["sport"] == sport]
    return [e for e in shown if e["markets"]]


def _groups(e: dict, market: str | None = None, props: bool = True) -> Iterator[tuple[str, dict]]:
    """Yield (market_key, line_group) for every complete line group in an event.

    `market` keeps one market key only; `props=False` drops player props (mainlines only).
    """
    for key, outcomes in e["markets"].items():
        if (market and key != market) or (not props and mk.is_prop(key)):
            continue
        for g in mk.line_groups(key, outcomes, e["home"], e["away"]):
            yield key, g


@app.get("/api/sharps")
def sharp_settings():
    """Defaults for the fair-price settings in the UI."""
    return {"books": SHARP_BOOKS, "weights": sharp.parse_weights(sharp_weights_spec()),
            "max_hold": max_sharp_hold(), "methods": list(devig.METHODS)}


@app.get("/api/ev")
def positive_ev(book: str | None = None, min_ev: float = 0.0, method: str = "multiplicative", kelly: float = 0.25,
                sharps: str | None = None, max_hold: float | None = None, market: str | None = None,
                round_to: float = 1.0, max_side: float | None = None, props: bool = True):
    """+EV rows. `sharps` is 'Book:weight,...' (default SHARP_WEIGHTS); sharp books holding
    more than `max_hold` percent (default MAX_SHARP_HOLD) are left out of the fair price."""
    if method not in devig.METHODS:
        raise HTTPException(400, f"unknown devig method {method!r}")
    weights = sharp.parse_weights(sharps if sharps is not None else sharp_weights_spec())
    max_hold = max_sharp_hold() if max_hold is None else max_hold
    _check_sizing(round_to, max_side)
    bankroll = max(bets.bankroll_info()["current"], 0.0)
    rows = []
    for e in get_snapshot():
        for key, g in _groups(e, market, props):
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
                        kelly_stake = bankroll * ev.kelly_fraction(fp, price, kelly)
                        rows.append({
                            "event_id": e["id"], "event": f'{e["away"]} @ {e["home"]}', "sport": e["sport"],
                            "start": e["start"], "market": key, "player": g["player"],
                            "name": o["name"], "selection": o["name"],
                            "point": o["point"], "pick": mk.label(o), "book": book_name,
                            "odds": price, "link": bet_link(book_name, o),
                            "fair_prob": fp, "fair_odds": odds.prob_to_american(fp), "ev_pct": v,
                            "stake": sizing.round_stake(kelly_stake, round_to, max_side),
                            "kelly_stake": kelly_stake,
                            "sharps": fair["sharps"], "sharp_hold_pct": fair["hold_pct"],
                        })
    return sorted(rows, key=lambda r: -r["ev_pct"])


def _check_sizing(round_to: float, max_side: float | None) -> None:
    try:
        sizing.stake_cap(round_to, max_side)
    except ValueError as err:
        raise HTTPException(400, str(err)) from err


@app.get("/api/arbs")
def arbs(min_profit: float = 0.0, market: str | None = None, total: float | None = None, round_to: float = 1.0,
         max_side: float | None = None, props: bool = True):
    """Arbs sized to `total` (default: current bankroll), rounded to `round_to`, capped at `max_side`."""
    _check_sizing(round_to, max_side)
    if total is None or total <= 0:
        total = bets.bankroll_info()["current"]
        total = total if total > 0 else 100.0
    rows = []
    for e in get_snapshot():
        for key, g in _groups(e, market, props):
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
                    rows.append({"event": f'{e["away"]} @ {e["home"]}', "event_id": e["id"], "sport": e["sport"],
                                 "market": key, "player": g["player"], "point": g["point"],
                                 "legs": [{"pick": mk.label(o), "selection": o["name"], "point": o["point"], "book": book,
                                           "odds": price, "link": bet_link(book, o), "stake": stake, "ideal_stake": ideal,
                                           "profit_if_wins": won}
                                          for (o, book, price), stake, ideal, won
                                          in zip(best, sized["stakes"], sized["ideal_stakes"], sized["profits"])],
                                 "profit_pct": result["profit_pct"],
                                 **{k: sized[k] for k in ("total_stake", "min_profit", "max_profit", "min_profit_pct",
                                                          "capped", "rounding_loss", "warning")}})
    return sorted(rows, key=lambda r: -r["profit_pct"])


PromoKind = Literal["bonus-bet", "profit-boost", "second-chance"]


def _convert(kind: PromoKind, amount: float, promo_odds: float, hedge_odds: float, boost_pct: float,
             max_boost: float | None, refund_value: float) -> dict:
    # Dispatch to the hedge function for the promo kind.
    if kind == "bonus-bet":
        return promo.bonus_bet_hedge(amount, promo_odds, hedge_odds)
    if kind == "profit-boost":
        return promo.profit_boost_hedge(amount, promo_odds, hedge_odds, boost_pct, max_boost)
    return promo.second_chance_hedge(amount, promo_odds, hedge_odds, refund_value=refund_value)


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
                r = _convert(kind=kind, amount=amount, promo_odds=side["prices"][book], hedge_odds=hedge_odds,
                             boost_pct=boost_pct, max_boost=max_boost, refund_value=refund_value)
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


@app.get("/api/history/{event_id}")
def odds_history(event_id: str, market: str = "moneyline"):
    """Every stored price for one event and market, oldest first."""
    return history.history(event_id, market)


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


@app.get("/api/lowhold")
def low_hold(max_hold: float = 1.0, book: str | None = None, stake: float = 100.0, market: str | None = None):
    """Two-sided bets that cover both outcomes for the smallest hold, for clearing rollover.

    With ``book`` set, one leg must be at that book. Sorted by hold, lowest first.
    """
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
            for o, leg in zip(g["outcomes"], pair["legs"]):
                leg.update(pick=mk.label(o), point=o["point"])
            rows.append({"event": f'{e["away"]} @ {e["home"]}', "sport": e["sport"], "start": e["start"],
                         "market": key, "point": g["point"], "stake": stake, **pair})
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
                    rows.append({
                        "event": f'{e["away"]} @ {e["home"]}', "sport": e["sport"], "start": e["start"],
                        "market": key, "window": m["window"], "low": la, "high": lb,
                        "legs": [{"pick": mk.label(o), "point": o["point"], "book": b, "odds": p, "stake": s}
                                 for o, b, p, s in ((oa, ba, pa, m["stake_a"]), (ob, bb, pb, m["stake_b"]))],
                        "win_both": m["win_both"], "worst_case": m["worst_case"], "cost_pct": cost_pct,
                        **mid.middle_ev(m, la, pa, lb, pb, pmf),
                    })
    return sorted(rows, key=lambda r: -r["ev_pct"])


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
