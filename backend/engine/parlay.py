from math import prod

from .odds import american_to_decimal, decimal_to_american


def parlay(american_legs: list[float], fair_probs: list[float] | None = None) -> dict:
    dec = prod(american_to_decimal(a) for a in american_legs)
    out = {"decimal": dec, "american": decimal_to_american(dec)}
    if fair_probs:
        p = prod(fair_probs)
        out["fair_prob"] = p
        out["ev_pct"] = (p * dec - 1) * 100
    return out
