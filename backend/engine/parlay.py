from math import prod

from .ev import kelly_fraction
from .odds import american_to_decimal, decimal_to_american


def parlay(american_legs: list[float], fair_probs: list[float] | None = None, kelly: float | None = None) -> dict:
    """Combine legs into one parlay price.

    Fair probability is the product of each leg's no-vig probability (legs are treated
    as independent; correlation is not modelled). With ``kelly`` set, adds the Kelly
    fraction of bankroll to stake at that multiplier.
    """
    dec = prod(american_to_decimal(a) for a in american_legs)
    out = {"decimal": dec, "american": decimal_to_american(dec)}
    if fair_probs:
        p = prod(fair_probs)
        out["fair_prob"] = p
        out["ev_pct"] = (p * dec - 1) * 100
        if kelly is not None:
            out["kelly_fraction"] = kelly_fraction(p, out["american"], kelly)
    return out
