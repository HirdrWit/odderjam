"""Live (in-play) events: live detection, the live-refresh credit budget and price age."""


def is_live(event: dict, now: float) -> bool:
    return False


class Budget:
    def __init__(self, credits_per_hour: float, spent: list | None = None):
        self.credits_per_hour = credits_per_hour
        self.spent = list(spent or [])

    def used(self, now: float) -> float:
        return 0.0

    def can_spend(self, cost: float, now: float) -> bool:
        return False

    def record(self, cost: float, now: float) -> None:
        pass

    def next_allowed(self, cost: float, now: float) -> float | None:
        return None


def planned_rate(cost: float, interval_seconds: float, credits_per_hour: float) -> float:
    return 0.0


def projected_hours(remaining: float | None, rate: float) -> float | None:
    return None


def price_age(updated: dict, books, now: float) -> float | None:
    return None


def is_stale(age: float | None, max_age: float) -> bool:
    return False
