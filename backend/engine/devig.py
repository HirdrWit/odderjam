"""Remove the vig from a set of mutually exclusive outcome probabilities."""
import math


def multiplicative(probs: list[float]) -> list[float]:
    s = sum(probs)
    return [p / s for p in probs]


def additive(probs: list[float]) -> list[float]:
    """Subtract an equal share of the overround from every outcome.

    A very long longshot in a wide market can go below zero; such outcomes are
    clamped to 0 and the rest are renormalised so the result still sums to 1.
    """
    margin = (sum(probs) - 1) / len(probs)
    fair = [max(p - margin, 0.0) for p in probs]
    s = sum(fair)
    return [p / s for p in fair]


def power(probs: list[float]) -> list[float]:
    """Find k so that sum(p**k) == 1 (bisection)."""
    lo, hi = 0.5, 5.0
    for _ in range(60):
        k = (lo + hi) / 2
        if sum(p**k for p in probs) > 1:
            lo = k
        else:
            hi = k
    return [p**k for p in probs]


def _shin_probs(probs: list[float], z: float) -> list[float]:
    s = sum(probs)
    return [(math.sqrt(z * z + 4 * (1 - z) * p * p / s) - z) / (2 * (1 - z)) for p in probs]


def shin(probs: list[float]) -> list[float]:
    """Shin (1993): margin comes from insider trading share z; solve z so the fair probs sum to 1.

    Pushes more of the margin onto longshots than multiplicative does.
    """
    if sum(probs) <= 1:
        return multiplicative(probs)
    lo, hi = 0.0, 0.999
    for _ in range(100):
        z = (lo + hi) / 2
        if sum(_shin_probs(probs, z)) > 1:
            lo = z
        else:
            hi = z
    return _shin_probs(probs, (lo + hi) / 2)


def worst_case(probs: list[float]) -> list[float]:
    """Fair prob = max of multiplicative and power results (conservative for the bettor).

    A higher fair prob means a lower EV, so each outcome takes the less favourable
    estimate. The result does not sum to 1.
    """
    m, p = multiplicative(probs), power(probs)
    return [max(a, b) for a, b in zip(m, p)]


METHODS = {"multiplicative": multiplicative, "additive": additive, "power": power, "shin": shin,
           "worst_case": worst_case}
