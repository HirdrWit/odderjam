from .odds import american_to_decimal


def middle(line_a: float, odds_a: float, line_b: float, odds_b: float, stake: float = 100.0) -> dict:
    """Over `line_a` at one book, under `line_b` at another (line_b > line_a => middle window).

    Win both inside the window; otherwise win one, lose one.
    """
    da, db = american_to_decimal(odds_a), american_to_decimal(odds_b)
    both = stake * (da - 1) + stake * (db - 1)
    one = stake * (da - 1) - stake  # approx, when only A wins; B-only symmetric
    one_b = stake * (db - 1) - stake
    return {
        "window": line_b - line_a,
        "win_both": both,
        "miss_a": one,
        "miss_b": one_b,
        "worst_case": min(one, one_b),
    }
