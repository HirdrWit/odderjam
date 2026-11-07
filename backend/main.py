from collections.abc import Iterator
from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from statistics import median

from .engine import arb as arbm, devig, ev, markets as mk, middles as mid, odds
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
            side, line = (over if o["name"] == "Over" else under if o["name"] == "Under" else None), o["point"]
        else:  # home -3.5 wins when margin > 3.5; away +4.5 wins when margin < 4.5
            side, line = (over, -o["point"]) if o["name"] == home else (under, o["point"])
        if side is None:
            continue
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
def middles(min_window: float = 0.0, max_cost: float | None = None, market: str | None = None, stake: float = 100.0):
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
                    (pa, ba, oa), (pb, bb, ob) = max(pairs, key=lambda ab: mid.middle(la, ab[0][0], lb, ab[1][0])["worst_case"])
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
