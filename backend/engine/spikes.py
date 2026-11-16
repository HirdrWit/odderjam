"""Sharp Money: volume spikes in exchange trades (stub)."""


def volume_by_price(trades: list[dict]) -> list[dict]:
    return []


def detect(trades: list[dict], now: float, window: float = 600.0, baseline: float = 7200.0, k: float = 3.0,
           min_volume: float = 0.0) -> dict | None:
    return None


def beating(prices: dict[str, float], fair_prob: float) -> list[dict]:
    return []
