from .arb import arb


def hold_pct(odds_a: float, odds_b: float) -> float:
    """Negative profit of the two-way arb == the hold paid to cover both sides."""
    return -arb([odds_a, odds_b])["profit_pct"]
