"""Practical stake sizing: round stakes to a book-friendly increment and cap each side.

Books flag odd amounts ($13.47) and big stakes, so stakes get rounded (e.g. to $5) and kept
under a per-side maximum. Rounding breaks an arb's perfect balance, so the arb sizer picks the
rounded stakes that keep the worst outcome as good as possible, without going over the entered
total, and reports the profit for each outcome. It flags when rounding turns a profitable arb into
a loss on some outcome, and when no rounding fits inside the total.
frontend/src/calc.js mirrors this module; keep them in sync.
"""
import math
from itertools import product

from .arb import arb
from .odds import american_to_decimal

CENT = 0.01
EPS = 1e-9


def _inc(increment: float | None) -> float:
    return increment if increment and increment > 0 else CENT


def stake_cap(increment: float | None, max_per_side: float | None) -> float:
    """Largest stake allowed on one side: the max rounded down to the increment."""
    if not max_per_side or max_per_side <= 0:
        return math.inf
    inc = _inc(increment)
    cap = math.floor(max_per_side / inc + EPS) * inc
    if cap <= 0:
        raise ValueError("max stake per side is smaller than the rounding increment")
    return round(cap, 2)


def round_stake(stake: float, increment: float | None = 1.0, max_per_side: float | None = None) -> float:
    """Single bet (e.g. a +EV Kelly stake): nearest increment, then capped."""
    inc = _inc(increment)
    rounded = math.floor(stake / inc + 0.5 + EPS) * inc
    return round(min(max(rounded, 0.0), stake_cap(increment, max_per_side)), 2)


def _choices(target: float, inc: float, cap: float) -> list[float]:
    steps = target / inc
    lo = math.floor(steps + 1e-6) * inc
    near = (lo,) if abs(steps - round(steps)) < 1e-6 else (lo, lo + inc)
    opts = {round(x, 2) for x in near if 0 < x <= cap + EPS}
    return sorted(opts) or [round(min(inc, cap), 2)]


def size_arb(american_odds: list[float], total: float, increment: float | None = 1.0,
             max_per_side: float | None = None) -> dict:
    """Rounded, capped stakes for an arb (or low-hold) bet across mutually exclusive outcomes.

    The ideal split of `total` is scaled down if a side would exceed `max_per_side`, then each
    stake is rounded down or up one increment. Of those combinations that add up to at most
    `total`, the one with the best worst-case return (as % of total staked) wins; ties go to the
    total nearest the target. If none fits (a side's ideal stake is under one increment), the best
    of all combinations is used and `over_total` is set.
    """
    dec = [american_to_decimal(a) for a in american_odds]
    ideal = arb(american_odds, total)
    inc, cap = _inc(increment), stake_cap(increment, max_per_side)
    scale = min(1.0, cap / max(ideal["stakes"])) if ideal["stakes"] else 1.0
    target_total = total * scale
    targets = [s * scale for s in ideal["stakes"]]

    def score(stakes):
        staked = sum(stakes)
        worst = min(s * d for s, d in zip(stakes, dec)) - staked
        return round(worst / staked, 9), -abs(staked - target_total)

    combos = list(product(*(_choices(t, inc, cap) for t in targets)))
    within = [c for c in combos if sum(c) <= total + EPS]
    stakes = list(max(within or combos, key=score))
    staked = round(sum(stakes), 2)
    profits = [s * d - staked for s, d in zip(stakes, dec)]
    lo, hi = min(profits), max(profits)
    rounding_loss = ideal["profit_pct"] >= 0 and lo < -EPS
    over_total = staked > total + EPS
    warnings = []
    if over_total:
        warnings.append(f"Rounded stakes total ${staked:.2f}, ${staked - total:.2f} over the ${total:.2f} entered; "
                        "use a smaller increment or a larger total")
    if rounding_loss:
        warnings.append(f"Rounded stakes lose up to ${-lo:.2f} on one outcome; use a smaller increment")
    return {
        "stakes": stakes,
        "ideal_stakes": targets,
        "total_stake": staked,
        "profits": profits,
        "min_profit": lo,
        "max_profit": hi,
        "min_profit_pct": lo / staked * 100,
        "ideal_profit_pct": ideal["profit_pct"],
        "capped": scale < 1.0,
        "rounding_loss": rounding_loss,
        "over_total": over_total,
        "warning": "; ".join(warnings) or None,
    }


def size_bonus_hedge(bonus: float, odds_bonus: float, odds_hedge: float, increment: float | None = 1.0,
                     max_per_side: float | None = None) -> dict:
    """Bonus bet (stake not returned) on A, cash hedge on B: rounded/capped hedge stake."""
    da, db = american_to_decimal(odds_bonus), american_to_decimal(odds_hedge)
    win_a = bonus * (da - 1)
    ideal = win_a / db
    inc, cap = _inc(increment), stake_cap(increment, max_per_side)

    def profits(h):
        return win_a - h, h * (db - 1)

    hedge = max(_choices(min(ideal, cap), inc, cap), key=lambda h: (min(profits(h)), -abs(h - ideal)))
    if_a, if_b = profits(hedge)
    return {"hedge_stake": hedge, "ideal_hedge": ideal, "profit_if_bonus_wins": if_a, "profit_if_hedge_wins": if_b,
            "min_profit": min(if_a, if_b), "max_profit": max(if_a, if_b), "capped": ideal > cap,
            "conversion_pct": min(if_a, if_b) / bonus * 100}
