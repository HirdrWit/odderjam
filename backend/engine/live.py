"""Live (in-play) events: live detection, the live-refresh credit budget and price age.

Pure functions: the current time is always passed in as an epoch float.
"""
from datetime import datetime

# Longest a game in each sport can plausibly run, in hours. Past this a started game counts as over
# even if no completed flag came through.
MAX_GAME_HOURS = {"NBA": 3.5, "NFL": 4.5, "MLB": 4.5, "NHL": 3.5}
DEFAULT_GAME_HOURS = 4.0
WINDOW = 3600.0  # the budget is a rolling hour


def parse_time(s) -> float | None:
    """ISO 8601 string (a trailing "Z" is allowed) -> epoch seconds, or None if it can't be parsed."""
    if not isinstance(s, str):
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp()
    except ValueError:
        return None


def is_live(event: dict, now: float) -> bool:
    start = parse_time(event.get("start"))
    if start is None or start > now or event.get("completed"):
        return False
    return now - start < MAX_GAME_HOURS.get(event.get("sport"), DEFAULT_GAME_HOURS) * 3600


class Budget:
    """Credits spent on live refreshes, capped per rolling hour. `spent` is a list of (ts, cost)."""

    def __init__(self, credits_per_hour: float, spent: list | None = None):
        self.credits_per_hour = credits_per_hour
        self.spent = [(float(ts), float(cost)) for ts, cost in (spent or [])]

    def _window(self, now: float) -> list[tuple[float, float]]:
        return [(ts, c) for ts, c in self.spent if ts > now - WINDOW]

    def used(self, now: float) -> float:
        return sum(c for _, c in self._window(now))

    def can_spend(self, cost: float, now: float) -> bool:
        return self.used(now) + cost <= self.credits_per_hour

    def record(self, cost: float, now: float) -> None:
        self.spent.append((float(now), float(cost)))

    def set_last_cost(self, cost: float) -> None:
        """Replace the cost of the newest entry (an estimate) with what the call really cost."""
        if self.spent:
            ts, _ = self.spent[-1]
            self.spent[-1] = (ts, float(cost))

    def prune(self, now: float) -> None:
        self.spent = self._window(now)

    def next_allowed(self, cost: float, now: float) -> float | None:
        """Seconds until `cost` fits in the window: 0 if it fits now, None if it never can."""
        if cost > self.credits_per_hour:
            return None
        used = self.used(now)
        if used + cost <= self.credits_per_hour:
            return 0.0
        for ts, c in sorted(self._window(now)):
            used -= c
            if used + cost <= self.credits_per_hour:
                return ts + WINDOW - now
        return None  # unreachable: once every entry expires, cost <= cap fits


def planned_rate(cost: float, interval_seconds: float, credits_per_hour: float) -> float:
    """Credits per hour live refresh will burn: one fetch per interval, capped by the budget."""
    if interval_seconds <= 0:
        return float(credits_per_hour)
    return min(float(credits_per_hour), cost * 3600 / interval_seconds)


def projected_hours(remaining: float | None, rate: float) -> float | None:
    if remaining is None or rate <= 0:
        return None
    return remaining / rate


def price_age(updated: dict, books, now: float) -> float | None:
    """Age in seconds of the oldest known price among `books`; None if none of them has a timestamp."""
    ages = [now - t for t in (parse_time(updated.get(b)) for b in books) if t is not None]
    return max(ages) if ages else None


def is_stale(age: float | None, max_age: float) -> bool:
    return age is None or age > max_age
