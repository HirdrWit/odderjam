"""Middle bets: opposing legs on one number at different books.

A middle pairs a low-line bet with a high-line bet on the same number.

Both legs are expressed on one scoring variable ``x`` (the game total, or the home
team's winning margin for spreads):

* leg A ("over") wins when ``x > line_a``,
* leg B ("under") wins when ``x < line_b``.

With ``line_a < line_b`` every result wins at least one leg, and a result inside
the window (``line_a < x < line_b``) wins both. A result exactly on a whole-number
line pushes that leg.
"""
import math
from statistics import NormalDist

from .odds import american_to_decimal

# Standard deviation of the final margin and the final total, per sport (rough historical values).
SPREAD_SD = {"NFL": 13.5, "NBA": 12.0, "MLB": 4.2, "NHL": 2.4}
TOTAL_SD = {"NFL": 10.0, "NBA": 18.0, "MLB": 4.4, "NHL": 2.3}

# NFL margins cluster on key numbers. Approximate multipliers of a smooth normal's mass at
# each absolute margin, fitted by eye to historical margin frequencies (3 ~15%, 7 ~9%, ties ~0.2%).
NFL_KEY_MULT = {0: 0.1, 1: 0.75, 2: 0.65, 3: 2.6, 4: 1.0, 5: 0.85, 6: 1.15, 7: 1.7, 8: 0.9,
                10: 1.25, 14: 1.15}


def split(odds_a: float, odds_b: float, total: float = 100.0) -> tuple[float, float]:
    """Stakes on A and B, summing to `total`, that make the two single-leg outcomes pay the same.

    Missing low (only B wins) pays ``sb*db - total``; missing high (only A wins) pays
    ``sa*da - total``. Equal when ``sa*da == sb*db``.
    """
    da, db = american_to_decimal(odds_a), american_to_decimal(odds_b)
    sa = total * db / (da + db)
    return sa, total - sa


def settle(x: float, line_a: float, odds_a: float, stake_a: float,
           line_b: float, odds_b: float, stake_b: float) -> float:
    """Net profit of both legs for final result `x`."""
    da, db = american_to_decimal(odds_a), american_to_decimal(odds_b)
    a = stake_a * (da - 1) if x > line_a else 0.0 if x == line_a else -stake_a
    b = stake_b * (db - 1) if x < line_b else 0.0 if x == line_b else -stake_b
    return a + b


def middle(line_a: float, odds_a: float, line_b: float, odds_b: float, stake: float = 100.0,
           stakes: tuple[float, float] | None = None) -> dict:
    """Over `line_a` at one book, under `line_b` at another (line_b > line_a => middle window).

    `stake` is the total risked, split with `split()` unless explicit `stakes` are given.
    ``miss_low`` is the result below the window (only B wins), ``miss_high`` above it (only A wins).
    """
    sa, sb = stakes if stakes is not None else split(odds_a, odds_b, stake)
    da, db = american_to_decimal(odds_a), american_to_decimal(odds_b)
    miss_low = sb * (db - 1) - sa
    miss_high = sa * (da - 1) - sb
    return {
        "window": line_b - line_a,
        "stake_a": sa,
        "stake_b": sb,
        "win_both": sa * (da - 1) + sb * (db - 1),
        "miss_low": miss_low,
        "miss_high": miss_high,
        "worst_case": min(miss_low, miss_high),
    }


def outcome_pmf(center: float, sd: float, key_mult: dict[int, float] | None = None,
                lo: float | None = None) -> dict[int, float]:
    """Probability of each whole-number result: a normal discretised to integers.

    `key_mult` reweights results by absolute value (key numbers); `lo` drops results below it
    (e.g. totals can't be negative). The result is renormalised to sum to 1.
    """
    dist = NormalDist(center, sd)
    start = math.floor(center - 6 * sd)
    if lo is not None:
        start = max(start, math.ceil(lo))
    pmf = {}
    for k in range(start, math.ceil(center + 6 * sd) + 1):
        p = dist.cdf(k + 0.5) - dist.cdf(k - 0.5)
        if key_mult:
            p *= key_mult.get(abs(k), 1.0)
        pmf[k] = p
    z = sum(pmf.values())
    return {k: p / z for k, p in pmf.items()}


def model_pmf(sport: str, market: str, center: float) -> dict[int, float]:
    """Result distribution for `market` ("spreads" -> home margin, "totals" -> total) around `center`."""
    if market == "spreads":
        return outcome_pmf(center, SPREAD_SD.get(sport, 12.0), NFL_KEY_MULT if sport == "NFL" else None)
    return outcome_pmf(center, TOTAL_SD.get(sport, 10.0), lo=0)


def middle_ev(m: dict, line_a: float, odds_a: float, line_b: float, odds_b: float,
              pmf: dict[int, float]) -> dict:
    """Hit probability (both legs win) and expected profit of middle `m` under result distribution `pmf`."""
    hit = sum(p for k, p in pmf.items() if line_a < k < line_b)
    ev = sum(p * settle(k, line_a, odds_a, m["stake_a"], line_b, odds_b, m["stake_b"]) for k, p in pmf.items())
    total = m["stake_a"] + m["stake_b"]
    return {"hit_prob": hit, "ev": ev, "ev_pct": ev / total * 100 if total else 0.0}
