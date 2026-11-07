from .odds import american_to_decimal


def bonus_bet_hedge(bonus: float, odds_bonus: float, odds_hedge: float) -> dict:
    """Free bet (stake not returned) on side A, cash hedge on side B at another book."""
    da, db = american_to_decimal(odds_bonus), american_to_decimal(odds_hedge)
    win_a = bonus * (da - 1)
    hedge = win_a / db
    profit = win_a - hedge
    return {"hedge_stake": hedge, "profit": profit, "conversion_pct": profit / bonus * 100}


def second_chance_ev(refund: float, odds: float, stake: float, fair_prob: float, refund_value: float = 0.7) -> float:
    """Rough EV of a 'lose -> bonus bet' offer on a single bet."""
    d = american_to_decimal(odds)
    win = fair_prob * stake * (d - 1)
    lose = (1 - fair_prob) * (-stake + min(refund, stake) * refund_value)
    return win + lose
