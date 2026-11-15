"""Seeded mock odds so every tool works offline."""
import math
import random
from datetime import datetime, timedelta, timezone
from statistics import NormalDist

from .books import BOOK_URLS

BOOKS = ["Pinnacle", "DraftKings", "FanDuel", "BetMGM", "Caesars", "bet365", "BetRivers", "Fanatics"]
GAMES = {
    "NBA": [("Lakers", "Celtics"), ("Warriors", "Nuggets"), ("Bucks", "Heat")],
    "NFL": [("Chiefs", "Bills"), ("Eagles", "Cowboys"), ("49ers", "Ravens")],
    "MLB": [("Yankees", "Dodgers"), ("Braves", "Astros")],
    "NHL": [("Rangers", "Bruins"), ("Oilers", "Avalanche")],
}
# Per sport: margin std dev, (total low, total high), total std dev, fixed spread (run/puck line) or None.
SPORT_MODEL = {
    "NBA": (12.0, (210, 240), 18.0, None),
    "NFL": (13.5, (38, 52), 13.0, None),
    "MLB": (4.0, (7, 10), 3.0, 1.5),
    "NHL": (2.5, (5.5, 6.5), 1.8, 1.5),
}
# How far a book's line may sit from the market line (whole points keep lines on the .5, so no pushes).
LINE_SHIFTS = [-1, 0, 0, 0, 1]


def _to_american(p: float) -> int:
    d = 1 / p
    a = (d - 1) * 100 if d >= 2 else -100 / (d - 1)
    return int(round(a))


def _half(x: float) -> float:
    """Nearest x.5 line."""
    return math.floor(x) + 0.5


def _priced(p: float, book: str, rng: random.Random) -> tuple[int, int]:
    """Two-way prices for true probability p of side A, with book vig and noise."""
    vig = 0.025 if book == "Pinnacle" else rng.uniform(0.04, 0.06)
    noise = 0.0 if book == "Pinnacle" else rng.gauss(0, 0.025)
    pa = min(0.95, max(0.05, p + noise))
    return (_to_american(min(0.97, pa * (1 + vig / 2))),
            _to_american(min(0.97, (1 - pa) * (1 + vig / 2))))


def _add(outcomes: dict[tuple[str, float | None], dict], name: str, point: float | None, book: str, price: int,
         event_id: str = "", market: str = "") -> None:
    outcome = outcomes.setdefault((name, point), {"name": name, "point": point, "prices": {}})
    outcome["prices"][book] = price
    if book in BOOK_URLS:
        # Fake deep link: the real book homepage plus a fragment naming the bet, so it opens somewhere sensible.
        pick = f"{name}{'' if point is None else f'_{point:+g}'}".replace(" ", "_")
        outcome.setdefault("links", {})[book] = f"{BOOK_URLS[book]}/#odderjam-mock={event_id}/{market}/{pick}"


def snapshot(seed: int | None = None) -> list[dict]:
    """Return events: {id, sport, home, away, start, markets:{key:[{name, point, prices:{book:price}}]}}"""
    rng = random.Random(seed if seed is not None else int(datetime.now().timestamp() // 30))
    events = []
    for sport, games in GAMES.items():
        margin_sd, (tlo, thi), total_sd, fixed_spread = SPORT_MODEL[sport]
        for i, (home, away) in enumerate(games):
            rs = random.Random(f"{sport}{i}")
            true_home = rs.uniform(0.3, 0.7)
            start = datetime.now(timezone.utc) + timedelta(hours=rs.randint(2, 48))
            margin = NormalDist(0, margin_sd).inv_cdf(true_home)  # expected home margin
            margin_dist = NormalDist(margin, margin_sd)
            exp_total = rs.uniform(tlo, thi)
            total_dist = NormalDist(exp_total, total_sd)
            market_spread = _half(-margin) if fixed_spread is None else (-fixed_spread if margin > 0 else fixed_spread)
            market_total = _half(exp_total)

            ml: dict[tuple[str, float | None], dict] = {}
            spreads: dict[tuple[str, float | None], dict] = {}
            totals: dict[tuple[str, float | None], dict] = {}
            eid = f"{sport}-{i}"
            for book in BOOKS:
                home_price, away_price = _priced(true_home, book, rng)
                _add(ml, home, None, book, home_price, eid, "moneyline")
                _add(ml, away, None, book, away_price, eid, "moneyline")

                # Lines per book are stable for a game; prices move with rng.
                book_rng = random.Random(f"{sport}{i}{book}")
                spread_shift = 0 if book == "Pinnacle" else book_rng.choice(LINE_SHIFTS)
                home_line = market_spread if fixed_spread is not None else market_spread + spread_shift
                home_price, away_price = _priced(1 - margin_dist.cdf(-home_line), book, rng)  # home covers if margin + line > 0
                _add(spreads, home, home_line, book, home_price, eid, "spreads")
                _add(spreads, away, -home_line, book, away_price, eid, "spreads")

                total_shift = 0 if book == "Pinnacle" else book_rng.choice(LINE_SHIFTS)
                total_line = max(0.5, market_total + total_shift)
                over, under = _priced(1 - total_dist.cdf(total_line), book, rng)
                _add(totals, "Over", total_line, book, over, eid, "totals")
                _add(totals, "Under", total_line, book, under, eid, "totals")

            events.append({
                "id": eid, "sport": sport, "home": home, "away": away, "start": start.isoformat(),
                "markets": {"moneyline": list(ml.values()), "spreads": list(spreads.values()),
                            "totals": list(totals.values())},
            })
    return events
