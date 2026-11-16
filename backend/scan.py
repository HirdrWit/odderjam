"""Opportunity scanners shared by the API endpoints and the alert job."""
from collections.abc import Iterator

from .engine import arb as arbm, ev, markets as mk, odds, sharp, sizing
from .providers.books import US_BOOKS, bet_link, us_only


def groups(e: dict, market: str | None = None, props: bool = True) -> Iterator[tuple[str, dict]]:
    """Yield (market_key, line_group) for every complete line group in an event.

    `market` keeps one market key only; `props=False` drops player props (mainlines only).
    """
    for key, outcomes in e["markets"].items():
        if (market and key != market) or (not props and mk.is_prop(key)):
            continue
        for g in mk.line_groups(key, outcomes, e["home"], e["away"]):
            yield key, g


def ev_rows(events: list[dict], weights: dict, max_hold: float, book: str | None = None, min_ev: float = 0.0,
            method: str = "multiplicative", kelly: float = 0.25, market: str | None = None,
            sport: str | None = None, bankroll: float = 0.0, round_to: float = 1.0,
            max_side: float | None = None, props: bool = True) -> list[dict]:
    """+EV rows priced against the weighted sharp consensus (sharps holding over `max_hold` % are dropped)."""
    rows = []
    for e in events:
        if sport and e["sport"] != sport:
            continue
        for key, g in groups(e, market, props):
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


def arb_rows(events: list[dict], min_profit: float = 0.0, market: str | None = None, sport: str | None = None,
             total: float = 100.0, round_to: float = 1.0, max_side: float | None = None,
             props: bool = True) -> list[dict]:
    """Arbs sized to `total`, rounded to `round_to`, capped at `max_side`."""
    rows = []
    for e in events:
        if sport and e["sport"] != sport:
            continue
        for key, g in groups(e, market, props):
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
