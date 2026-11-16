"""Pick'em (PrizePicks / Underdog style) slip math. Stubs: see odderjam-18."""

DEFAULT_PAYOUTS: dict[str, dict[int, dict[int, float]]] = {"power": {}, "flex": {}}


def hit_distribution(probs: list[float]) -> list[float]:
    return []


def slip_ev(probs: list[float], table: dict[int, float]) -> dict:
    return {"expected_return": 0.0, "ev_pct": 0.0, "win_prob": 0.0}


def breakeven_prob(table: dict[int, float], n: int) -> float:
    return 0.0


def validate_table(table: dict[int, dict[int, float]]) -> None:
    return None


def best_slips(legs: list[dict], size: int, table: dict[int, float], top: int = 3) -> list[dict]:
    return []


def parse_lines(text: str) -> tuple[list[dict], list[dict]]:
    return [], []
