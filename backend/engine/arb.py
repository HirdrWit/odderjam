from .odds import american_to_decimal


def arb(american_odds: list[float], bankroll: float = 100.0) -> dict:
    """Two or more mutually exclusive outcomes, best odds for each.

    Returns profit_pct (positive means arbitrage) and stake split.
    """
    dec = [american_to_decimal(a) for a in american_odds]
    inv = sum(1 / d for d in dec)
    stakes = [bankroll / d / inv for d in dec]
    return {
        "profit_pct": (1 / inv - 1) * 100,
        "stakes": stakes,
        "payout": bankroll / inv,
    }
