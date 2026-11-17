"""Typical game length per sport, shared by the Kalshi adapter and the Tracker's due-bet check."""

# Hours from first pitch/tip-off to expected settlement.
GAME_HOURS = {"NBA": 2.5, "NFL": 3.25, "MLB": 3.0, "NHL": 2.5}
DEFAULT_HOURS = 3.0


def game_hours(sport: str | None) -> float:
    return GAME_HOURS.get(sport, DEFAULT_HOURS)
