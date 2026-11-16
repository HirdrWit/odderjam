"""Opportunity scanners shared by the API endpoints and the alert job."""
from collections.abc import Iterator
from typing import TYPE_CHECKING

from .engine import arb as arbm, ev, markets as mk, odds, sharp, sizing
from .providers.books import SHARP, US_BOOKS, bet_link, us_only

if TYPE_CHECKING:
    from .routes.filters import FilterSet


def groups(e: dict, market: str | None = None, props: bool = True) -> Iterator[tuple[str, dict]]:
    """Yield (market_key, line_group) for every complete line group in an event.

    `market` keeps one market key only; `props=False` drops player props (mainlines only).
    """
    for key, outcomes in e["markets"].items():
        if (market and key != market) or (not props and mk.is_prop(key)):
            continue
        for g in mk.line_groups(key, outcomes, e["home"], e["away"]):
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


def _price_ok(filters: "FilterSet | None", book: str, price: float) -> bool:
    return filters is None or (filters.book_ok(book) and filters.odds_ok(price))


def ev_rows(events: list[dict], weights: dict, max_hold: float, book: str | None = None, min_ev: float = 0.0,
            method: str = "multiplicative", kelly: float = 0.25, market: str | None = None,
            sport: str | None = None, bankroll: float = 0.0, round_to: float = 1.0,
            max_side: float | None = None, props: bool = True,
            filters: "FilterSet | None" = None) -> list[dict]:
    """+EV rows priced against the weighted sharp consensus (sharps holding over `max_hold` % are dropped).

    `filters` narrows events, lines and bet prices (sports, start window, markets, sharp hold, books, odds range).
    """
    rows = []
    for e, key, g in _filtered_groups(events, market, props, sport, filters):
        # Only sharps pricing every side of this exact line can devig it.
        fair = sharp.group_consensus(g["outcomes"], weights, method, max_hold)
        if fair is None:
            continue
        for o, fp in zip(g["outcomes"], fair["probs"]):
            for book_name, price in o["prices"].items():
                if book_name not in US_BOOKS or (book and book_name != book) \
                        or not _price_ok(filters, book_name, price):
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


def arb_rows(events: list[dict], min_profit: float = 0.0, market: str | None = None, sport: str | None = None,
             total: float = 100.0, round_to: float = 1.0, max_side: float | None = None,
             props: bool = True, filters: "FilterSet | None" = None) -> list[dict]:
    """Arbs sized to `total`, rounded to `round_to`, capped at `max_side`.

    `filters` narrows events and lines, and limits each leg to the allowed books and odds range.
    """
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
            if result["profit_pct"] >= min_profit:
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
                                                      "capped", "rounding_loss", "warning")}})
    return sorted(rows, key=lambda r: -r["profit_pct"])
