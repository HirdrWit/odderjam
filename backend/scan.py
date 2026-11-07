"""Opportunity scanners shared by the API endpoints and the alert job."""
from collections.abc import Iterator

from .engine import arb as arbm, devig, ev, markets as mk, odds
from .providers.books import SHARP, US_BOOKS, us_only


def _groups(e: dict) -> Iterator[tuple[str, dict]]:
    """Yield (market_key, line_group) for every complete line group in an event."""
    for key, outcomes in e["markets"].items():
        for g in mk.line_groups(key, outcomes, e["home"], e["away"]):
            yield key, g


def ev_rows(events: list[dict], book: str | None = None, min_ev: float = 0.0, method: str = "multiplicative",
            kelly: float = 0.25, market: str | None = None, sport: str | None = None,
            bankroll: float = 0.0) -> list[dict]:
    rows = []
    for e in events:
        if sport and e["sport"] != sport:
            continue
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
                            "start": e["start"], "market": key, "point": o["point"], "pick": mk.label(o),
                            "book": book_name, "odds": price, "fair_prob": fp,
                            "fair_odds": odds.prob_to_american(fp), "ev_pct": v,
                            "stake": bankroll * ev.kelly_fraction(fp, price, kelly),
                        })
    return sorted(rows, key=lambda r: -r["ev_pct"])


def arb_rows(events: list[dict], min_profit: float = 0.0, market: str | None = None,
             sport: str | None = None) -> list[dict]:
    rows = []
    for e in events:
        if sport and e["sport"] != sport:
            continue
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
                    rows.append({"event_id": e["id"], "event": f'{e["away"]} @ {e["home"]}', "sport": e["sport"],
                                 "market": key, "point": g["point"],
                                 "legs": [{"pick": mk.label(o), "point": o["point"], "book": book, "odds": price,
                                           "stake": stake}
                                          for (o, book, price), stake in zip(best, result["stakes"])],
                                 "profit_pct": result["profit_pct"]})
    return sorted(rows, key=lambda r: -r["profit_pct"])
