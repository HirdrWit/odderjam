"""Grade moneyline, spread and total bets from a final score.

Props are never auto-graded; ``grade`` returns None for anything it cannot decide.
"""
import re

from .markets import DRAW

SETTLEABLE = ("moneyline", "spreads", "totals")


def grade(market: str, selection: str, point: float | None, home: str, away: str,
          home_score: float, away_score: float) -> str | None:
    """Return 'won', 'lost' or 'push' for one bet on a finished game, or None if it can't be graded."""
    if market == "totals":
        if point is None or selection not in ("Over", "Under"):
            return None
        diff = home_score + away_score - point
        if selection == "Under":
            diff = -diff
    elif market in ("moneyline", "spreads"):
        if selection == DRAW and market == "moneyline":
            return "won" if home_score == away_score else "lost"
        if selection == home:
            diff = home_score - away_score
        elif selection == away:
            diff = away_score - home_score
        else:
            return None
        if market == "spreads":
            if point is None:
                return None
            diff += point
    else:
        return None
    return "won" if diff > 0 else "lost" if diff < 0 else "push"


_POINT = re.compile(r"^(.*\S)\s+([+-]?\d+(?:\.\d+)?)$")


def parse_pick(market: str, pick: str) -> tuple[str, float | None]:
    """Split a pick label ('Lakers -3.5', 'Over 220.5', 'Lakers') into (selection, point)."""
    pick = pick.strip()
    if market in ("spreads", "totals"):
        m = _POINT.match(pick)
        if m:
            return m.group(1), float(m.group(2))
    return pick, None


def final_scores(game: dict) -> tuple[float, float] | None:
    """(home, away) from an Odds API /scores entry, or None if the game isn't final."""
    if not game.get("completed") or not game.get("scores"):
        return None
    by_name = {s["name"]: s["score"] for s in game["scores"]}
    try:
        return float(by_name[game["home_team"]]), float(by_name[game["away_team"]])
    except (KeyError, TypeError, ValueError):
        return None
