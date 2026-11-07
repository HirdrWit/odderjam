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
# Player props per sport: (market, (mean low, mean high), std dev or None for a Poisson count stat).
SPORT_PROPS = {
    "NBA": [("player_points", (14, 30), 6.0), ("player_threes", (0.6, 3.5), None)],
    "NFL": [("player_rush_yds", (35, 90), 22.0), ("player_receptions", (2.5, 7), None)],
    "MLB": [("batter_hits", (0.6, 1.3), None), ("batter_total_bases", (1.0, 2.2), None)],
    "NHL": [("player_points", (0.4, 1.2), None), ("player_shots_on_goal", (1.8, 4.0), None)],
}
PLAYERS_PER_TEAM = 2
# Soft books misprice props more than mainlines.
PROP_NOISE = 0.04
# How far a book's line may sit from the market line (whole points keep lines on the .5, so no pushes).
LINE_SHIFTS = [-1, 0, 0, 0, 1]


def _to_american(p: float) -> int:
    d = 1 / p
    a = (d - 1) * 100 if d >= 2 else -100 / (d - 1)
    return int(round(a))


def _half(x: float) -> float:
    """Nearest x.5 line."""
    return math.floor(x) + 0.5


def _priced(p: float, book: str, rng: random.Random, noise_sd: float = 0.025) -> tuple[int, int]:
    """Two-way prices for true probability p of side A, with book vig and noise."""
    vig = 0.025 if book == "Pinnacle" else rng.uniform(0.04, 0.06)
    noise = 0.0 if book == "Pinnacle" else rng.gauss(0, noise_sd)
    pa = min(0.95, max(0.05, p + noise))
    return (_to_american(min(0.97, pa * (1 + vig / 2))),
            _to_american(min(0.97, (1 - pa) * (1 + vig / 2))))


def _add(outcomes: dict[tuple[str, str | None, float | None], dict], name: str, point: float | None, book: str, price: int,
         player: str | None = None) -> None:
    new = {"name": name, "point": point, "prices": {}}
    if player:
        new["player"] = player
    outcomes.setdefault((name, player, point), new)["prices"][book] = price


def _poisson_over(mean: float, line: float) -> float:
    """P(X > line) for a Poisson count with the given mean (line on the .5)."""
    k = math.floor(line)
    return 1 - sum(math.exp(-mean) * mean ** i / math.factorial(i) for i in range(k + 1))


def _props(sport: str, i: int, home: str, away: str, rng: random.Random) -> dict[str, list[dict]]:
    """Over/Under props for a few made-up players per team."""
    markets: dict[str, dict[tuple[str, str | None, float | None], dict]] = {}
    for market, (lo, hi), sd in SPORT_PROPS[sport]:
        outcomes = markets.setdefault(market, {})
        for team in (home, away):
            for n in range(1, PLAYERS_PER_TEAM + 1):
                player = f"{team} Player {n}"
                player_rng = random.Random(f"{sport}{i}{market}{player}")
                mean = player_rng.uniform(lo, hi)
                line = _half(mean) if sd is not None else max(0.5, _half(mean - 0.5))
                for book in BOOKS:
                    book_line = line
                    if sd is not None and book != "Pinnacle":  # yardage/points lines vary by book
                        book_line = line + random.Random(f"{sport}{i}{market}{player}{book}").choice(LINE_SHIFTS)
                    p_over = 1 - NormalDist(mean, sd).cdf(book_line) if sd is not None else _poisson_over(mean, book_line)
                    over, under = _priced(p_over, book, rng, PROP_NOISE)
                    _add(outcomes, "Over", book_line, book, over, player)
                    _add(outcomes, "Under", book_line, book, under, player)
    return {k: list(v.values()) for k, v in markets.items()}


def snapshot(seed: int | None = None) -> list[dict]:
    """Return events: {id, sport, home, away, start, markets:{key:[{name, point, [player], prices:{book:price}}]}}"""
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
            for book in BOOKS:
                home_price, away_price = _priced(true_home, book, rng)
                _add(ml, home, None, book, home_price)
                _add(ml, away, None, book, away_price)

                # Lines per book are stable for a game; prices move with rng.
                book_rng = random.Random(f"{sport}{i}{book}")
                spread_shift = 0 if book == "Pinnacle" else book_rng.choice(LINE_SHIFTS)
                home_line = market_spread if fixed_spread is not None else market_spread + spread_shift
                home_price, away_price = _priced(1 - margin_dist.cdf(-home_line), book, rng)  # home covers if margin + line > 0
                _add(spreads, home, home_line, book, home_price)
                _add(spreads, away, -home_line, book, away_price)

                total_shift = 0 if book == "Pinnacle" else book_rng.choice(LINE_SHIFTS)
                total_line = max(0.5, market_total + total_shift)
                over, under = _priced(1 - total_dist.cdf(total_line), book, rng)
                _add(totals, "Over", total_line, book, over)
                _add(totals, "Under", total_line, book, under)

            events.append({
                "id": f"{sport}-{i}", "sport": sport, "home": home, "away": away, "start": start.isoformat(),
                "markets": {"moneyline": list(ml.values()), "spreads": list(spreads.values()),
                            "totals": list(totals.values()), **_props(sport, i, home, away, rng)},
            })
    return events
