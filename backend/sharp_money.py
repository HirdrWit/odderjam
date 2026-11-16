"""Sharp Money: stored exchange trades, polling and spike rows (stub)."""


def reset() -> None:
    pass


def record(book: str, market: str, event_id: str, outcome: str, trades: list[dict]) -> int:
    return 0


def prune(now: float) -> int:
    return 0


def trades(book: str, event_id: str, outcome: str, since: float) -> list[dict]:
    return []


def last_ts(book: str, market: str) -> float | None:
    return None


def poll(events: list[dict], client, now: float, lookback: float) -> int:
    return 0


def maybe_poll(events: list[dict], now: float, client=None) -> bool:
    return False


def rows(events: list[dict], now: float, window: float, baseline: float, k: float, min_volume: float) -> list[dict]:
    return []
