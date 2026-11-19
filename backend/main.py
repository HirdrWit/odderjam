import math
import time
from contextlib import asynccontextmanager
from math import prod
from pathlib import Path
from statistics import median
from typing import Annotated, Literal

from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import alerts, hidden, history, refresh as refresh_mod, scan, sharp_money
from .engine.bettable import multi_leg_flags as _multi_leg_flags
from .scan import groups as _groups
from .engine import (bettable, devig, live as _live_mod, lowhold, markets as mk, middles as mid, odds, parlay as pm, pickem,
                     promo, sharp, sizing, suspect)
from .providers.books import SGP_BOOKS, SHARP, SHARP_BOOKS, US_BOOKS, DEFAULT_SHARP_WEIGHTS, max_sharp_hold, sharp_weights_spec, us_only
from .routes import bets, filters as flt
from .routes.filters import FilterSet
from .providers import exchanges, cache_info, get_snapshot, peek_live_snapshot, live_config, live_status, set_live


@asynccontextmanager
async def lifespan(_app: FastAPI):
    alerts.start()
    yield
    alerts.stop()


app = FastAPI(title="odderjam", lifespan=lifespan)
app.include_router(bets.router)
app.include_router(hidden.router)
app.include_router(bets.bankroll_router)
app.include_router(alerts.router)
app.include_router(flt.router)


@app.exception_handler(RequestValidationError)
async def _validation_error(request: Request, exc: RequestValidationError) -> JSONResponse:
    """422 without echoing the input: a NaN or infinite input would make the error body invalid JSON."""
    detail = [{k: v for k, v in e.items() if k in ("type", "loc", "msg")} for e in exc.errors()]
    return JSONResponse(status_code=422, content={"detail": detail})


def _us_markets(markets: dict) -> dict:
    """Markets with prices filtered to US books; outcomes and markets left empty are dropped."""
    out = {}
    for key, outcomes in markets.items():
        kept = [{**o, "prices": us_only(o["prices"]), "links": us_only(o.get("links") or {})} for o in outcomes]
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


FAIR_SOURCES = ("sharp", "all_books")


def _parse_spec(spec: str) -> dict:
    """parse_weights, with a bad spec reported as a 400."""
    try:
        return sharp.parse_weights(spec)
    except ValueError as err:
        raise HTTPException(400, f"bad sharp weights: {err}") from err


@app.get("/api/sharps")
def sharp_settings():
    """Defaults for the fair-price settings in the UI."""
    weights = sharp.class_weights(_parse_spec(sharp_weights_spec()))
    return {"books": SHARP_BOOKS, "weights": weights, "recommended": DEFAULT_SHARP_WEIGHTS,
            "fair_source": "sharp", "fair_sources": list(FAIR_SOURCES),
            "max_hold": max_sharp_hold(), "methods": list(devig.METHODS)}


# Numeric query params: finite, and positive unless zero has a meaning (round_to=0 rounds to cents).
PositiveFloat = Annotated[float, Query(gt=0, allow_inf_nan=False)]
Kelly = Annotated[float, Query(gt=0, le=1, allow_inf_nan=False)]
Amount = Annotated[float, Query(gt=0, le=1_000_000, allow_inf_nan=False)]
Percent = Annotated[float, Query(ge=0, le=1000, allow_inf_nan=False)]
NonNegative = Annotated[float, Query(ge=0, allow_inf_nan=False)]
RoundTo = Annotated[float, Query(ge=0, allow_inf_nan=False)]


@app.get("/api/ev")
def positive_ev(method: str = "multiplicative", kelly: Kelly = 0.25, sharps: str | None = None,
                max_hold: Annotated[float | None, Query(ge=0, allow_inf_nan=False)] = None,
                round_to: RoundTo = 1.0, max_side: PositiveFloat | None = None,
                props: bool = True, fair_source: str = "sharp", f: FilterSet = Depends(flt.query_filters),
                bettable_odds_min: Annotated[float | None, Query(allow_inf_nan=False)] = None,
                bettable_odds_max: Annotated[float | None, Query(allow_inf_nan=False)] = None,
                ev_ceiling: Annotated[float | None, Query(ge=0, allow_inf_nan=False)] = None,
                prop_ev_ceiling: Annotated[float | None, Query(ge=0, allow_inf_nan=False)] = None,
                max_skew_seconds: Annotated[float | None, Query(ge=0, allow_inf_nan=False)] = None,
                max_sharp_spread: Annotated[float | None, Query(ge=0, allow_inf_nan=False)] = None,
                require_conservative: bool | None = None, show_hidden: bool = False,
                arb_backed: bool = False, must_bet: bool = False,
                must_bet_min_ev: NonNegative | None = None,
                must_bet_odds_min: Annotated[float | None, Query(allow_inf_nan=False)] = None,
                must_bet_odds_max: Annotated[float | None, Query(allow_inf_nan=False)] = None,
                must_bet_max_hold: NonNegative | None = None):
    """+EV rows. `sharps` is 'Book:weight,...' (default SHARP_WEIGHTS); sharp books holding
    more than `max_hold` percent (default MAX_SHARP_HOLD) are left out of the fair price.
    `f` (query params and/or a saved `preset`) filters sports, books, markets, odds, start time and min EV.
    Rows the user hid, or already tracked, are left out unless `show_hidden`; then each carries `hidden`.
    `arb_backed=true` keeps only rows that are one leg of an arbitrage.
    Every row carries `must_bet` and `must_bet_reasons`; `must_bet=true` keeps only must bets
    (thresholds: must_bet_min_ev, must_bet_odds_min/max, must_bet_max_hold)."""
    if method not in devig.METHODS:
        raise HTTPException(400, f"unknown devig method {method!r}")
    if fair_source not in FAIR_SOURCES:
        raise HTTPException(400, f"unknown fair_source {fair_source!r}; use sharp or all_books")
    weights = _parse_spec(sharps if sharps is not None else sharp_weights_spec())
    max_hold = max_sharp_hold() if max_hold is None else max_hold
    _check_sizing(round_to, max_side)
    profile = {k: v for k, v in {"odds_min": bettable_odds_min, "odds_max": bettable_odds_max,
                                 "ev_ceiling": ev_ceiling, "prop_ev_ceiling": prop_ev_ceiling,
                                 "max_skew_seconds": max_skew_seconds,
                                 "max_sharp_spread": max_sharp_spread,
                                 "require_conservative": require_conservative,
                                 "must_bet_min_ev": must_bet_min_ev, "must_bet_odds_min": must_bet_odds_min,
                                 "must_bet_odds_max": must_bet_odds_max,
                                 "must_bet_max_hold": must_bet_max_hold}.items() if v is not None}
    if err := bettable.profile_error({**bettable.DEFAULT_PROFILE, **profile}):
        raise HTTPException(422, err)
    bankroll = max(bets.bankroll_info()["current"], 0.0)
    min_ev = f.min_ev if f.min_ev is not None else 0.0
    rows = scan.ev_rows(get_snapshot(), weights, max_hold, min_ev=min_ev, method=method, kelly=kelly,
                        bankroll=bankroll, round_to=round_to, max_side=max_side, props=props, filters=f, now=_now(),
                        profile=profile, fair_source=fair_source)
    if arb_backed:
        rows = [r for r in rows if r["arb_backed"]]
    if must_bet:
        rows = [r for r in rows if r["must_bet"]]
    return hidden.apply(history.annotate(rows, _now()), _now(), show_hidden)


def _check_sizing(round_to: float, max_side: float | None) -> None:
    try:
        sizing.stake_cap(round_to, max_side)
    except ValueError as err:
        raise HTTPException(400, str(err)) from err


@app.get("/api/arbs")
def arbs(total: PositiveFloat | None = None, round_to: RoundTo = 1.0, max_side: PositiveFloat | None = None,
         props: bool = True, f: FilterSet = Depends(flt.query_filters)):
    """Arbs sized to `total` (default: current bankroll), rounded to `round_to`, capped at `max_side`."""
    _check_sizing(round_to, max_side)
    if total is None:
        total = bets.bankroll_info()["current"]
        total = total if total > 0 else 100.0
    min_profit = f.min_profit if f.min_profit is not None else 0.0
    return scan.arb_rows(get_snapshot(), min_profit=min_profit, total=total, round_to=round_to,
                         max_side=max_side, props=props, filters=f, now=_now(),
                         weights=_parse_spec(sharp_weights_spec()), max_hold=max_sharp_hold())


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
def promo_conversions(kind: PromoKind, book: str, amount: Amount = 100.0, boost_pct: Percent = 0.0,
                      max_boost: Annotated[float | None, Query(ge=0, le=1_000_000, allow_inf_nan=False)] = None,
                      refund_value: Annotated[float, Query(ge=0, le=1, allow_inf_nan=False)] = 0.7,
                      market: str | None = None, limit: Annotated[int, Query(ge=1, le=1000)] = 50):
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
def odds_history(event_id: str, market: str = "moneyline", point: float | None = None,
                 player: str | None = None):
    """Every stored price for one event and market (optionally one `point` and `player`), oldest first.
    Reads only the local store: no provider call, no API credits."""
    return history.history(event_id, market, point, player)


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
    missing = []
    for i, leg in enumerate(p.legs):
        e = events.get(leg.event_id)
        outcome = e and next((o for o in e["markets"].get(leg.market, [])
                              if o["name"] == leg.name and o["point"] == leg.point), None)
        if not outcome:
            missing.append({"index": i, "event_id": leg.event_id, "market": leg.market,
                            "name": leg.name, "point": leg.point})
            continue
        legs.append((leg, e, outcome))

    if len(legs) < 2:  # nothing to compare; the caller marks the missing legs
        return {
            "legs": [{"event_id": leg.event_id, "event": f'{e["away"]} @ {e["home"]}', "sport": e["sport"],
                      "market": leg.market, "name": leg.name, "point": leg.point, "pick": mk.label(o),
                      "fair_prob": _fair_prob(e, leg.market, o, p.method)} for leg, e, o in legs],
            "missing": missing, "same_game": False, "fair_prob": None, "fair_odds": None, "books": [],
        }

    seen: dict[str, dict[str, dict]] = {}
    for leg, e, o in legs:
        first = seen.setdefault(leg.event_id, {}).get(leg.market)
        if first is not None:
            same_line = mk.line_key(leg.market, first, e["home"]) == mk.line_key(leg.market, o, e["home"])
            lead = "Both sides of" if same_line else "Two legs from"
            raise HTTPException(400, f'{lead} {e["away"]} @ {e["home"]} {mk.market_label(leg.market)} '
                                     "are in the slip; remove one")
        seen[leg.event_id][leg.market] = o
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
        "missing": missing,
        "same_game": same_game,
        "fair_prob": fair_prob,
        "fair_odds": odds.prob_to_american(fair_prob) if fair_prob else None,
        "books": rows,
    }


PickemSize = Annotated[int, Field(ge=pickem.MIN_LEGS, le=pickem.MAX_LEGS)]


class PickemLine(BaseModel):
    player: str = Field(min_length=1)
    market: str = Field(min_length=1)
    point: float = Field(allow_inf_nan=False)
    side: str | None = None


class PickemIn(BaseModel):
    lines: list[PickemLine] = Field(min_length=1, max_length=200)
    payout: Literal["power", "flex"] = "power"
    sizes: list[PickemSize] = Field(default_factory=lambda: list(range(pickem.MIN_LEGS, pickem.MAX_LEGS + 1)))
    payouts: dict[int, dict[int, float]] | None = None
    method: str = "multiplicative"
    top: int = Field(3, ge=1, le=20)
    bettable_only: bool = False  # leave in-play and stale legs out of the suggested slips


class PickemText(BaseModel):
    text: str = Field(max_length=100_000)


def _market_matches(key: str, wanted: str) -> bool:
    """'player_points' matches 'player_points', 'points' and 'Points'."""
    w = wanted.strip().casefold().replace(" ", "_")
    return key == w or (mk.is_prop(key) and key.split("_", 1)[1] == w)


def _pickem_probs(outcomes: list[dict], method: str) -> tuple[list[float], str] | None:
    """No-vig probs for one prop line: weighted sharp consensus, else the mean of every book pricing all sides."""
    c = sharp.group_consensus(outcomes, sharp.class_weights(_parse_spec(sharp_weights_spec()))["props"], method,
                              max_sharp_hold())
    if c:
        return c["probs"], "sharp"
    fn = devig.METHODS[method]
    books = set.intersection(*(set(o["prices"]) for o in outcomes))
    per_book = [fn([odds.american_to_prob(o["prices"][b]) for o in outcomes]) for b in books]
    if not per_book:
        return None
    return [sum(ps[i] for ps in per_book) / len(per_book) for i in range(len(outcomes))], "market"


def _prop_index(events: list[dict]) -> dict[tuple[str, float], list[tuple[dict, str, dict]]]:
    """(casefolded player, point) -> [(event, market key, line group)] for every prop line in the snapshot."""
    index: dict[tuple[str, float], list[tuple[dict, str, dict]]] = {}
    for e in events:
        for key, g in _groups(e):
            if mk.is_prop(key) and g["player"]:
                index.setdefault((g["player"].casefold(), g["point"]), []).append((e, key, g))
    return index


def _pickem_flags(e: dict, g: dict, now: float) -> list[str]:
    """Risk flags for a pick'em prop: in_play when the game is live, stale when a live game's prices are older than max_price_age."""
    live = _live_mod.is_live(e, now)
    flags = ["in_play"] if live else []
    if not live:
        return flags  # stale is a live-only rule, as in scan.freshness(); pre-game caches are old by design
    books = {b for o in g["outcomes"] for b in o["prices"]}
    age = _live_mod.price_age(e.get("updated", {}), books, now)
    if age is not None and _live_mod.is_stale(age, live_config()["max_price_age"]):
        flags.append("stale")
    return flags


def _pickem_leg(line: PickemLine, index: dict, method: str, now: float) -> dict:
    """Match one pick'em line to the sportsbook prop at the same player, market and point."""
    out = {"player": line.player, "market": line.market, "point": line.point, "matched": False, "side": line.side,
           "prob": None, "probs": None, "source": None, "event_id": None, "event": None, "sport": None,
           "flags": []}
    for e, key, g in index.get((line.player.strip().casefold(), line.point), []):
        if not _market_matches(key, line.market):
            continue
        r = _pickem_probs(g["outcomes"], method)
        if r is None:
            continue
        probs = {o["name"]: p for o, p in zip(g["outcomes"], r[0])}
        if line.side:
            side = next((n for n in probs if n.casefold() == line.side.strip().casefold()), None)
            if side is None:
                continue
        else:
            side = max(probs, key=probs.get)
        return {**out, "player": g["player"], "market": key, "matched": True, "side": side, "prob": probs[side],
                "probs": probs, "source": r[1], "event_id": e["id"], "event": f'{e["away"]} @ {e["home"]}',
                "sport": e["sport"], "flags": _pickem_flags(e, g, now)}
    return out


@app.get("/api/pickem/payouts")
def pickem_payouts():
    """Default power and flex payout tables: {type: {legs: {hits: multiplier}}}."""
    return pickem.DEFAULT_PAYOUTS


@app.post("/api/pickem/parse")
def pickem_parse(body: PickemText):
    """Parse pasted pick'em lines (`player, market, line[, over|under]` per row)."""
    lines, errors = pickem.parse_lines(body.text)
    return {"lines": lines, "errors": errors}


@app.post("/api/pickem")
def pickem_optimize(p: PickemIn):
    """Price pick'em lines against no-vig sportsbook props and build the best slips per size.

    Legs are ranked by hit probability (unmatched lines last). Slips assume independent legs and
    never stack one player or use a single event. `payouts` replaces the default table for `payout`.
    """
    if p.method not in devig.METHODS:
        raise HTTPException(400, f"unknown devig method {p.method!r}")
    table = p.payouts if p.payouts is not None else pickem.DEFAULT_PAYOUTS[p.payout]
    try:
        pickem.validate_table(table)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    index = _prop_index(get_snapshot())
    now = _now()
    legs = [_pickem_leg(line, index, p.method, now) for line in p.lines]
    legs.sort(key=lambda x: (not x["matched"], -(x["prob"] or 0)))
    matched = [x for x in legs if x["matched"] and not (p.bettable_only and x["flags"])]
    slips = {str(n): pickem.best_slips(matched, n, table[n], p.top) for n in sorted(set(p.sizes)) if n in table}
    return {
        "payout": p.payout,
        "table": table,
        "breakeven": {str(n): pickem.breakeven_prob(table[n], n) for n in sorted(table)},
        "legs": legs,
        "slips": slips,
    }


@app.get("/api/lowhold")
def low_hold(max_hold: Annotated[float, Query(allow_inf_nan=False)] = 1.0, book: str | None = None,
             stake: PositiveFloat = 100.0, market: str | None = None, bettable: bool = False):
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
            fresh = scan.freshness(e, [leg["book"] for leg in pair["legs"]], now)
            if fresh is None:
                continue
            flags = _multi_leg_flags(e, [leg["book"] for leg in pair["legs"]],
                                      [leg["odds"] for leg in pair["legs"]], now)
            if bettable and flags:
                continue
            for o, leg in zip(g["outcomes"], pair["legs"]):
                leg.update(pick=mk.label(o), point=o["point"])
            rows.append({"event": f'{e["away"]} @ {e["home"]}', "sport": e["sport"], "start": e["start"],
                         "market": key, "point": g["point"], "stake": stake, **pair, **fresh, "flags": flags})
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


def _center(key: str, outcomes: list[dict], home: str) -> float | None:
    """Expected result: the sharp book's line if it has one, else the median line across books."""
    sign = -1 if key == "spreads" else 1  # home point -3.5 means an expected home margin of +3.5
    priced = [(sign * mk.line_key(key, o, home), o) for o in outcomes if o.get("point") is not None]
    lines = [ln for ln, _ in priced]
    sharp = [ln for ln, o in priced if SHARP in o["prices"]]
    return median(sharp or lines) if lines else None


def _unsuspect_outcomes(key: str, e: dict) -> list[dict]:
    """The event's outcomes for a market, minus every line whose prices look stale or mismatched."""
    bad = {id(o) for g in mk.line_groups(key, e["markets"][key], e["home"], e["away"])
           if suspect.is_suspect_market(key, g["outcomes"]) for o in g["outcomes"]}
    return [o for o in e["markets"][key] if id(o) not in bad]


@app.get("/api/middles")
def middles(
    min_window: NonNegative = 0.0,
    max_cost: Annotated[float | None, Query(allow_inf_nan=False)] = None,
    market: str | None = None,
    stake: float = Query(100.0, gt=0, allow_inf_nan=False),
    min_ev: float | None = Query(None, allow_inf_nan=False),
    bettable: bool = False,
) -> list[dict]:
    """Middles across books. `max_cost` caps the worst-case loss as a percent of total stake;
    `min_ev` drops middles whose expected value (percent of total stake) is below it."""
    now = _now()
    rows = []
    for e in get_snapshot():
        for key in ("spreads", "totals"):
            if (market and key != market) or not e["markets"].get(key):
                continue
            outcomes = _unsuspect_outcomes(key, e)
            center = _center(key, outcomes, e["home"])
            if center is None:
                continue  # every line was stripped as suspect: skip this market, not the whole endpoint
            over, under = _middle_sides(key, outcomes, e["home"])
            pmf = mid.model_pmf(e["sport"], key, center)
            for la, overs in over.items():
                for lb, unders in under.items():
                    if lb - la <= 0 or lb - la < min_window or not mid.can_hit(la, lb):
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
                    fresh = scan.freshness(e, [ba, bb], now)
                    if fresh is None:
                        continue
                    ev = mid.middle_ev(m, la, pa, lb, pb, pmf)
                    if min_ev is not None and ev["ev_pct"] < min_ev:
                        continue
                    flags = _multi_leg_flags(e, [ba, bb], [pa, pb], now, ev_pct=ev["ev_pct"])
                    if bettable and flags:
                        continue
                    rows.append({
                        "event": f'{e["away"]} @ {e["home"]}', "sport": e["sport"], "start": e["start"],
                        "market": key, "window": m["window"], "low": la, "high": lb,
                        "legs": [{"pick": mk.label(o), "point": o["point"], "book": b, "odds": p, "stake": s}
                                 for o, b, p, s in ((oa, ba, pa, m["stake_a"]), (ob, bb, pb, m["stake_b"]))],
                        "win_both": m["win_both"], "worst_case": m["worst_case"], "cost_pct": cost_pct,
                        **ev, **fresh, "flags": flags,
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
    return {**live_status(), "live_events": sum(_live_mod.is_live(e, now) for e in peek_live_snapshot())}


@app.get("/api/sharp-money/status")
def sharp_money_status():
    """Whether an exchange with a public trade feed is set up (EXCHANGES), and which."""
    watched = [n for n in exchanges.enabled() if n in exchanges.TRADE_PLATFORMS]
    return {"configured": bool(watched), "exchanges": watched}


@app.get("/api/sharp-money")
def sharp_money_rows(window_minutes: float = Query(10.0, gt=0, allow_inf_nan=False),
                     baseline_minutes: float = Query(120.0, gt=0, allow_inf_nan=False),
                     k: float = Query(3.0, gt=0, allow_inf_nan=False),
                     min_volume: float = Query(500.0, ge=0, allow_inf_nan=False)):
    """Volume spikes on exchange markets (matched volume in the last `window_minutes` above `k` x the
    rate over the `baseline_minutes` before it, and at least `min_volume` contracts), each with the
    sportsbooks paying more than the spike's volume-weighted price. Polls exchange trades first (throttled)."""
    window, baseline = window_minutes * 60, baseline_minutes * 60
    if window + baseline > sharp_money.retention_seconds():
        raise HTTPException(422, f"window + baseline must fit in the {sharp_money.retention_seconds() / 3600:g}h "
                                 "of stored trades (SHARP_MONEY_HOURS)")
    snap, now = get_snapshot(), _now()
    sharp_money.maybe_poll(snap, now, lookback=window + baseline)
    return sharp_money.rows(snap, now, window, baseline, k, min_volume)


@app.get("/api/live")
def live_get():
    return _live_payload()


@app.post("/api/live")
def live_post(body: LiveSettings):
    changes = body.model_dump(exclude_none=True)
    # +inf passes gt=0/ge=0 and would lift the cap; reject it here.
    if any(isinstance(v, float) and not math.isfinite(v) for v in changes.values()):
        raise HTTPException(422, "settings must be finite numbers")
    set_live(**changes)
    return _live_payload()


@app.post("/api/refresh")
def refresh(on_show: bool = False):
    """Refresh button: always fetches. `on_show` (tab shown) skips the fetch if another request
    wrote the cache while this one waited for the lock."""
    get_snapshot(force=True, not_before=time.time() if on_show else None)
    return cache_info()


class RefreshIn(BaseModel):
    seconds: int = Field(strict=True)


def _refresh_payload() -> dict:
    from .providers import _fetch_cost, _remaining
    return {"seconds": refresh_mod.get_seconds(), "default_seconds": refresh_mod.default_seconds(),
            "options": refresh_mod.options(_fetch_cost(), _remaining())}


@app.get("/api/refresh-interval")
def refresh_interval_get():
    return _refresh_payload()


@app.put("/api/refresh-interval")
def refresh_interval_put(body: RefreshIn):
    if body.seconds not in refresh_mod.CHOICES:
        raise HTTPException(422, f"seconds must be one of {refresh_mod.CHOICES}")
    refresh_mod.set_seconds(body.seconds)
    return _refresh_payload()


@app.get("/api/cache")
def cache():
    return cache_info()


@app.get("/api/health")
def health():
    return {"ok": True}


dist = Path(__file__).resolve().parent.parent / "frontend" / "dist"
if dist.exists():
    app.mount("/", StaticFiles(directory=dist, html=True), name="ui")
