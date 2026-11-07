"""Remove the vig from a set of mutually exclusive outcome probabilities."""


def multiplicative(probs: list[float]) -> list[float]:
    s = sum(probs)
    return [p / s for p in probs]


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


def worst_case(probs: list[float]) -> list[float]:
    """Fair prob = min of multiplicative and power results (conservative for the bettor)."""
    m, p = multiplicative(probs), power(probs)
    return [max(a, b) for a, b in zip(m, p)]  # higher fair prob => lower EV


METHODS = {"multiplicative": multiplicative, "power": power, "worst_case": worst_case}
