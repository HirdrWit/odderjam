"""Opportunity scanners shared by the API endpoints and the alert job."""
import math
import time
from collections.abc import Iterator
from typing import TYPE_CHECKING

from .engine import arb as arbm, bettable, ev, live, markets as mk, odds, sharp, sizing, suspect
from .providers import live_config
from .providers.books import SHARP, US_BOOKS, bet_link, us_only

if TYPE_CHECKING:
    from .routes.filters import FilterSet


def groups(e: dict, market: str | None = None, props: bool = True) -> Iterator[tuple[str, dict]]:
    """Yield (market_key, line_group) for every complete, non-suspect line group in an event.

    `market` keeps one market key only; `props=False` drops player props (mainlines only).
    """
    for key, outcomes in e["markets"].items():
        if (market and key != market) or (not props and mk.is_prop(key)):
            continue
        for g in mk.line_groups(key, outcomes, e["home"], e["away"]):
            if not suspect.is_suspect_market(key, g["outcomes"]):  # stale or mismatched prices
                yield key, g


def sharp_line_hold(g: dict) -> float | None:
    """Hold % of the sharp book on this line, or None if it doesn't price every side."""
    if not all(SHARP in o["prices"] for o in g["outcomes"]):
        return None
    return sharp.hold_pct([o["prices"][SHARP] for o in g["outcomes"]])


def _filtered_groups(events: list[dict], market: str | None, props: bool, sport: str | None,
                     filters: "FilterSet | None") -> Iterator[tuple[dict, str, dict]]:
    """Yield (event, market_key, line_group) passing the sport/market/props and FilterSet event/line filters."""
    for e in events:
        if sport and e["sport"] != sport:
            continue
        if filters and (not filters.sport_ok(e["sport"]) or not filters.start_ok(e["start"])):
            continue
        for key, g in groups(e, market, props):
            if filters and (not filters.market_ok(key) or not filters.hold_ok(sharp_line_hold(g))):
                continue
            yield e, key, g


def freshness(e: dict, books, now: float) -> dict | None:
    """Row fields for a tool row on event `e` priced at `books`; None if the row must be dropped.

    With live mode on, a live event's row is dropped when any of its prices is older than
    max_price_age (or has no timestamp): a stale in-play price is a phantom edge. Pre-game rows are kept.
    """
    is_live = live.is_live(e, now)
    updated = e.get("updated", {})
    age = live.price_age(updated, books, now)
    if any(b not in updated for b in books):
        age = None  # a leg without a timestamp makes the row's age unknown
    cfg = live_config()
    if cfg["enabled"] and is_live and live.is_stale(age, cfg["max_price_age"]):
        return None
    return {"event_id": e["id"], "live": is_live, "price_age_seconds": age}


def liquidity_of(o: dict, book: str) -> float | None:
    """Dollars resting at `book`'s price on outcome `o`, or None when the book gives no size data."""
    return (o.get("liquidity") or {}).get(book)


def _cap_stake(stake: float, liquidity: float | None) -> float:
    """`stake` limited to the dollars available (rounded down to the cent); unchanged when size is unknown."""
    if liquidity is None:
        return stake
    return min(stake, math.floor(max(liquidity, 0.0) * 100 + 1e-9) / 100)


def _price_ok(filters: "FilterSet | None", book: str, price: float) -> bool:
    return filters is None or (filters.book_ok(book) and filters.odds_ok(price))


def _best_legs(g: dict, filters: "FilterSet | None" = None) -> list[tuple[dict, str, float]] | None:
    """Best US price per outcome of a line group as (outcome, book, price), or None if a side has no price or
    the legs sit at fewer than two books (no arbitrage possible)."""
    best = []
    for o in g["outcomes"]:
        us_prices = {b: p for b, p in us_only(o["prices"]).items() if _price_ok(filters, b, p)}
        if not us_prices:
            return None
        best.append((o, *max(us_prices.items(), key=lambda kv: kv[1])))
    return best if len({book for _, book, _ in best}) >= 2 else None


def _arb_legs(e: dict, g: dict, filters: "FilterSet | None", now: float) -> tuple[set[tuple[int, str, float]], float] | None:
    """({(outcome index, book, price) of each leg}, profit %) when the group's best prices form an arb that
    arb_rows would show too: same filters, and every leg book fresh."""
    best = _best_legs(g, filters)
    if best is None or freshness(e, [book for _, book, _ in best], now) is None:
        return None
    profit = arbm.arb([price for _, _, price in best])["profit_pct"]
    if profit <= 0:
        return None
    return {(i, book, price) for i, (_, book, price) in enumerate(best)}, profit


def ev_rows(events: list[dict], weights: dict, max_hold: float, book: str | None = None, min_ev: float = 0.0,
            method: str = "multiplicative", kelly: float = 0.25, market: str | None = None,
            sport: str | None = None, bankroll: float = 0.0, round_to: float = 1.0,
            max_side: float | None = None, props: bool = True,
            filters: "FilterSet | None" = None, now: float | None = None,
            profile: dict | None = None, fair_source: str = "sharp") -> list[dict]:
    """+EV rows priced against the weighted sharp consensus (sharps holding over `max_hold` % are dropped).

    `filters` narrows events, lines and bet prices (sports, start window, markets, sharp hold, books, odds range).
    Stale in-play rows are dropped (see freshness); the book and every sharp used must be fresh.
    Every row carries `flags` (see engine.bettable, `profile` overrides its thresholds); with
    `filters.bettable` the flagged rows are dropped.
    `weights` is flat or per class (main lines vs props, see sharp.class_weights); fair_source="all_books"
    ignores it and prices every line from every book that has all sides, each weighted 1.
    """
    now = time.time() if now is None else now
    by_class = sharp.class_weights(weights)
    all_books = fair_source == "all_books"
    profile = {**bettable.DEFAULT_PROFILE, **(profile or {})}
    cfg = live_config()
    rows = []
    for e, key, g in _filtered_groups(events, market, props, sport, filters):
        # Only sharps pricing every side of this exact line can devig it.
        weight_class = "props" if mk.is_prop(key) else "main"
        w = by_class[weight_class]
        fair = sharp.group_consensus(g["outcomes"], w, method, max_hold, all_books)
        if fair is None:
            continue
        arb_legs = _arb_legs(e, g, filters, now)
        worst = sharp.worst_consensus(g["outcomes"], w, max_hold, all_books)
        worst_probs = worst["probs"] if worst else fair["probs"]
        worst_books = worst["books"] if worst else [None] * len(fair["probs"])
        for i, (o, fp) in enumerate(zip(g["outcomes"], fair["probs"])):
            for book_name, price in o["prices"].items():
                if book_name not in US_BOOKS or (book and book_name != book) \
                        or not _price_ok(filters, book_name, price):
                    continue
                v = ev.ev_pct(fp, price)
                worst_ev = ev.ev_pct(worst_probs[i], price)
                if (worst_ev if method == "worst_case" else v) < min_ev:
                    continue
                fresh = freshness(e, [book_name, *(u["book"] for u in fair["sharps"])], now)
                liquidity = liquidity_of(o, book_name)
                if fresh is not None:
                    updated = e.get("updated", {})
                    flagged = bettable.flags({
                        "market": key, "odds": price, "ev_pct": v,
                        "worst_ev_pct": worst_ev,
                        "is_live": fresh["live"], "live_enabled": cfg["enabled"],
                        "max_price_age": cfg["max_price_age"], "price_age": fresh["price_age_seconds"],
                        "update_times": {b: live.parse_time(updated.get(b))
                                         for b in [book_name, *(u["book"] for u in fair["sharps"])]},
                        "sharp_probs": [p[i] for p in fair["sharp_probs"].values()],
                        "liquidity": liquidity,
                    }, profile)
                    if filters is not None and filters.bettable and flagged:
                        continue
                    backed = arb_legs is not None and (i, book_name, price) in arb_legs[0]
                    kelly_stake = bankroll * ev.kelly_fraction(fp, price, kelly)
                    row = {
                        "event_id": e["id"], "event": f'{e["away"]} @ {e["home"]}', "sport": e["sport"],
                        "start": e["start"], "market": key, "player": g["player"],
                        "name": o["name"], "selection": o["name"],
                        "point": o["point"], "pick": mk.label(o), "book": book_name,
                        "odds": price, "link": bet_link(book_name, o),
                        "fair_prob": fp, "fair_odds": odds.prob_to_american(fp), "ev_pct": v,
                        "worst_ev_pct": worst_ev, "worst_sharp": worst_books[i],
                        "arb_backed": backed, "arb_profit_pct": arb_legs[1] if backed else None,
                        "stake": _cap_stake(sizing.round_stake(kelly_stake, round_to, max_side), liquidity),
                        "liquidity": liquidity,
                        "kelly_stake": kelly_stake,
                        "weight_class": weight_class, "fair_source": fair_source,
                        "sharps": fair["sharps"], "sharp_hold_pct": fair["hold_pct"], "flags": flagged, **fresh,
                    }
                    mb = bettable.must_bet(row, profile)
                    rows.append({**row, "must_bet": mb["must_bet"], "must_bet_reasons": mb["reasons"],
                                 "must_bet_missing": mb["missing"]})
    return sorted(rows, key=lambda r: -(r["worst_ev_pct"] if method == "worst_case" else r["ev_pct"]))


def arb_rows(events: list[dict], min_profit: float = 0.0, market: str | None = None, sport: str | None = None,
             total: float = 100.0, round_to: float = 1.0, max_side: float | None = None,
             props: bool = True, filters: "FilterSet | None" = None, now: float | None = None,
             weights: dict | None = None, max_hold: float = 100.0, method: str = "multiplicative") -> list[dict]:
    """Arbs sized to `total`, rounded to `round_to`, capped at `max_side`.

    `filters` narrows events and lines, and limits each leg to the allowed books and odds range.
    Stale in-play rows are dropped (see freshness). With `weights`, each leg carries `ev_pct` against the
    sharp consensus fair price (None without one) and `ev_leg` marks the leg(s) with positive EV.
    """
    now = time.time() if now is None else now
    by_class = sharp.class_weights(weights) if weights else None
    rows = []
    for e, key, g in _filtered_groups(events, market, props, sport, filters):
        best = _best_legs(g, filters)
        if best is not None:
            fair = (sharp.group_consensus(g["outcomes"], by_class["props" if mk.is_prop(key) else "main"],
                                          method, max_hold) if by_class else None)
            leg_ev = [ev.ev_pct(fair["probs"][i], price) if fair else None for i, (_, _, price) in enumerate(best)]
            result = arbm.arb([price for _, _, price in best])
            if result["profit_pct"] < min_profit:
                continue
            fresh = freshness(e, [book for _, book, _ in best], now)
            liquidities = [liquidity_of(o, b) for o, b, _ in best]
            flags = bettable.multi_leg_flags(e, [b for _, b, _ in best], [p for _, _, p in best], now,
                                             profit_pct=result["profit_pct"], liquidities=liquidities)
            if fresh is not None and not (filters and filters.bettable and flags):
                sized = sizing.size_arb([price for _, _, price in best], total, round_to, max_side, leg_caps=liquidities)
                rows.append({"event": f'{e["away"]} @ {e["home"]}', "event_id": e["id"], "sport": e["sport"],
                             "start": e["start"], "market": key, "player": g["player"], "point": g["point"],
                             "legs": [{"pick": mk.label(o), "selection": o["name"], "point": o["point"], "book": book,
                                       "odds": price, "link": bet_link(book, o), "stake": stake, "ideal_stake": ideal,
                                       "profit_if_wins": won, "ev_pct": lev,
                                       "ev_leg": lev is not None and lev > 0, "liquidity": liq}
                                      for (o, book, price), stake, ideal, won, lev, liq
                                      in zip(best, sized["stakes"], sized["ideal_stakes"], sized["profits"],
                                             leg_ev, liquidities)],
                             "profit_pct": result["profit_pct"],
                             **{k: sized[k] for k in ("total_stake", "min_profit", "max_profit", "min_profit_pct",
                                                      "capped", "rounding_loss", "over_total", "warning")}, **fresh,
                             "flags": flags})
    return sorted(rows, key=lambda r: -r["profit_pct"])
