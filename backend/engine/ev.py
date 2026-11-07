from .odds import american_to_decimal


def ev_pct(fair_prob: float, american: float) -> float:
    """Expected value per unit staked, as a percent."""
    return (fair_prob * american_to_decimal(american) - 1) * 100


def kelly_fraction(fair_prob: float, american: float, multiplier: float = 0.25) -> float:
    b = american_to_decimal(american) - 1
    f = (b * fair_prob - (1 - fair_prob)) / b
    return max(0.0, f) * multiplier
