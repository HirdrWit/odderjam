"""Seeded mock odds so every tool works offline."""
import random
from datetime import datetime, timedelta, timezone

BOOKS = ["Pinnacle", "DraftKings", "FanDuel", "BetMGM", "Caesars", "bet365", "BetRivers", "Fanatics"]
GAMES = {
    "NBA": [("Lakers", "Celtics"), ("Warriors", "Nuggets"), ("Bucks", "Heat")],
    "NFL": [("Chiefs", "Bills"), ("Eagles", "Cowboys"), ("49ers", "Ravens")],
    "MLB": [("Yankees", "Dodgers"), ("Braves", "Astros")],
    "NHL": [("Rangers", "Bruins"), ("Oilers", "Avalanche")],
}


def _to_american(p: float) -> int:
    d = 1 / p
    a = (d - 1) * 100 if d >= 2 else -100 / (d - 1)
    return int(round(a))


def snapshot(seed: int | None = None) -> list[dict]:
    """Return events: {id, sport, home, away, start, markets:{moneyline:{book:{home,away}}}}"""
    rng = random.Random(seed if seed is not None else int(datetime.now().timestamp() // 30))
    events = []
    for sport, games in GAMES.items():
        for i, (home, away) in enumerate(games):
            rs = random.Random(f"{sport}{i}")
            true_home = rs.uniform(0.3, 0.7)
            start = datetime.now(timezone.utc) + timedelta(hours=rs.randint(2, 48))
            ml: dict[str, dict[str, int]] = {}
            for b in BOOKS:
                vig = 0.025 if b == "Pinnacle" else rng.uniform(0.04, 0.06)
                noise = 0.0 if b == "Pinnacle" else rng.gauss(0, 0.025)
                ph = min(0.95, max(0.05, true_home + noise))
                ml[b] = {
                    "home": _to_american(min(0.97, ph * (1 + vig / 2) )),
                    "away": _to_american(min(0.97, (1 - ph) * (1 + vig / 2))),
                }
            events.append({
                "id": f"{sport}-{i}", "sport": sport, "home": home, "away": away,
                "start": start.isoformat(), "markets": {"moneyline": ml},
            })
    return events
