"""Odds format conversions."""


def american_to_decimal(a: float) -> float:
    return 1 + a / 100 if a > 0 else 1 + 100 / abs(a)


def decimal_to_american(d: float) -> float:
    return (d - 1) * 100 if d >= 2 else -100 / (d - 1)


def american_to_prob(a: float) -> float:
    return 1 / american_to_decimal(a)


def prob_to_american(p: float) -> float:
    return decimal_to_american(1 / p)
