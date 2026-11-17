"""Opportunity scanners shared by the API endpoints and the alert job."""
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


def _price_ok(filters: "FilterSet | None", book: str, price: float) -> bool:
    return filters is None or (filters.book_ok(book) and filters.odds_ok(price))


def ev_rows(events: list[dict], weights: dict, max_hold: float, book: str | None = None, min_ev: float = 0.0,
            method: str = "multiplicative", kelly: float = 0.25, market: str | None = None,
            sport: str | None = None, bankroll: float = 0.0, round_to: float = 1.0,
            max_side: float | None = None, props: bool = True,
            filters: "FilterSet | None" = None, now: float | None = None,
            profile: dict | None = None) -> list[dict]:
    """+EV rows priced against the weighted sharp consensus (sharps holding over `max_hold` % are dropped).

    `filters` narrows events, lines and bet prices (sports, start window, markets, sharp hold, books, odds range).
    Stale in-play rows are dropped (see freshness); the book and every sharp used must be fresh.
    Every row carries `flags` (see engine.bettable, `profile` overrides its thresholds); with
    `filters.bettable` the flagged rows are dropped.
    """
    now = time.time() if now is None else now
    profile = {**bettable.DEFAULT_PROFILE, **(profile or {})}
    cfg = live_config()
    rows = []
    for e, key, g in _filtered_groups(events, market, props, sport, filters):
        # Only sharps pricing every side of this exact line can devig it.
        fair = sharp.group_consensus(g["outcomes"], weights, method, max_hold)
        if fair is None:
            continue
        worst = sharp.group_consensus(g["outcomes"], weights, "worst_case", max_hold) or fair
        for i, (o, fp) in enumerate(zip(g["outcomes"], fair["probs"])):
            for book_name, price in o["prices"].items():
                if book_name not in US_BOOKS or (book and book_name != book) \
                        or not _price_ok(filters, book_name, price):
                    continue
                v = ev.ev_pct(fp, price)
                if v < min_ev:
                    continue
                fresh = freshness(e, [book_name, *(u["book"] for u in fair["sharps"])], now)
                if fresh is not None:
                    updated = e.get("updated", {})
                    flagged = bettable.flags({
                        "market": key, "odds": price, "ev_pct": v,
                        "worst_ev_pct": ev.ev_pct(worst["probs"][i], price),
                        "is_live": fresh["live"], "live_enabled": cfg["enabled"],
                        "max_price_age": cfg["max_price_age"], "price_age": fresh["price_age_seconds"],
                        "update_times": {b: live.parse_time(updated.get(b))
                                         for b in [book_name, *(u["book"] for u in fair["sharps"])]},
                        "sharp_probs": [p[i] for p in fair["sharp_probs"].values()],
                    }, profile)
                    if filters is not None and filters.bettable and flagged:
                        continue
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
                        "sharps": fair["sharps"], "sharp_hold_pct": fair["hold_pct"], "flags": flagged, **fresh,
                    })
    return sorted(rows, key=lambda r: -r["ev_pct"])


def arb_rows(events: list[dict], min_profit: float = 0.0, market: str | None = None, sport: str | None = None,
             total: float = 100.0, round_to: float = 1.0, max_side: float | None = None,
             props: bool = True, filters: "FilterSet | None" = None, now: float | None = None) -> list[dict]:
    """Arbs sized to `total`, rounded to `round_to`, capped at `max_side`.

    `filters` narrows events and lines, and limits each leg to the allowed books and odds range.
    Stale in-play rows are dropped (see freshness).
    """
    now = time.time() if now is None else now
    rows = []
    for e, key, g in _filtered_groups(events, market, props, sport, filters):
        best = []
        for o in g["outcomes"]:
            us_prices = {b: p for b, p in us_only(o["prices"]).items() if _price_ok(filters, b, p)}
            if not us_prices:
                break
            best.append((o, *max(us_prices.items(), key=lambda kv: kv[1])))
        else:
            if len({book for _, book, _ in best}) < 2:
                continue
            result = arbm.arb([price for _, _, price in best])
            if result["profit_pct"] < min_profit:
                continue
            fresh = freshness(e, [book for _, book, _ in best], now)
            flags = bettable.multi_leg_flags(e, [b for _, b, _ in best], [p for _, _, p in best], now,
                                             profit_pct=result["profit_pct"])
            if fresh is not None and not (filters and filters.bettable and flags):
                sized = sizing.size_arb([price for _, _, price in best], total, round_to, max_side)
                rows.append({"event": f'{e["away"]} @ {e["home"]}', "event_id": e["id"], "sport": e["sport"],
                             "start": e["start"], "market": key, "player": g["player"], "point": g["point"],
                             "legs": [{"pick": mk.label(o), "selection": o["name"], "point": o["point"], "book": book,
                                       "odds": price, "link": bet_link(book, o), "stake": stake, "ideal_stake": ideal,
                                       "profit_if_wins": won}
                                      for (o, book, price), stake, ideal, won
                                      in zip(best, sized["stakes"], sized["ideal_stakes"], sized["profits"])],
                             "profit_pct": result["profit_pct"],
                             **{k: sized[k] for k in ("total_stake", "min_profit", "max_profit", "min_profit_pct",
                                                      "capped", "rounding_loss", "over_total", "warning")}, **fresh,
                             "flags": flags})
    return sorted(rows, key=lambda r: -r["profit_pct"])
