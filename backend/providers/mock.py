"""Seeded mock odds so every tool works offline."""
import math
import random
from datetime import datetime, timedelta, timezone
from statistics import NormalDist

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


def _priced(p: float, b: str, rng: random.Random) -> tuple[int, int]:
    """Two-way prices for true probability p of side A, with book vig and noise."""
    vig = 0.025 if b == "Pinnacle" else rng.uniform(0.04, 0.06)
    noise = 0.0 if b == "Pinnacle" else rng.gauss(0, 0.025)
    pa = min(0.95, max(0.05, p + noise))
    return (_to_american(min(0.97, pa * (1 + vig / 2))),
            _to_american(min(0.97, (1 - pa) * (1 + vig / 2))))


def _add(outcomes: dict, name: str, point: float | None, book: str, price: int) -> None:
    o = outcomes.setdefault((name, point), {"name": name, "point": point, "prices": {}})
    o["prices"][book] = price


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

            ml: dict = {}
            spreads: dict = {}
            totals: dict = {}
            for b in BOOKS:
                h, a = _priced(true_home, b, rng)
                _add(ml, home, None, b, h)
                _add(ml, away, None, b, a)

                # Lines per book are stable for a game; prices move with rng.
                lb = random.Random(f"{sport}{i}{b}")
                shift = 0 if b == "Pinnacle" else lb.choice(LINE_SHIFTS)
                hs = market_spread if fixed_spread is not None else market_spread + shift
                h, a = _priced(1 - margin_dist.cdf(-hs), b, rng)  # home covers if margin + hs > 0
                _add(spreads, home, hs, b, h)
                _add(spreads, away, -hs, b, a)

                shift = 0 if b == "Pinnacle" else lb.choice(LINE_SHIFTS)
                t = max(0.5, market_total + shift)
                o, u = _priced(1 - total_dist.cdf(t), b, rng)
                _add(totals, "Over", t, b, o)
                _add(totals, "Under", t, b, u)

            events.append({
                "id": f"{sport}-{i}", "sport": sport, "home": home, "away": away, "start": start.isoformat(),
                "markets": {"moneyline": list(ml.values()), "spreads": list(spreads.values()),
                            "totals": list(totals.values())},
            })
    return events
