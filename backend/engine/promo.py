"""Promo conversion math: turn a sportsbook promo into a locked-in cash profit with a hedge.

Every hedge function puts the promo on side A (at the promo book) and a cash hedge on
side B (at another book), sized so profit is the same whichever side wins.
"""
from .odds import american_to_decimal, decimal_to_american


def bonus_bet_hedge(bonus: float, odds_bonus: float, odds_hedge: float) -> dict:
    """Free bet (stake not returned) on side A, cash hedge on side B at another book."""
    da, db = american_to_decimal(odds_bonus), american_to_decimal(odds_hedge)
    win_a = bonus * (da - 1)
    hedge = win_a / db
    profit = win_a - hedge
    return {"hedge_stake": hedge, "profit": profit, "conversion_pct": profit / bonus * 100}


def profit_boost_hedge(stake: float, odds_boost: float, odds_hedge: float, boost_pct: float,
                       max_boost: float | None = None) -> dict:
    """Cash bet on side A with winnings boosted by boost_pct %, extra winnings capped at max_boost.

    conversion_pct is the locked profit as a % of the boosted stake.
    """
    da, db = american_to_decimal(odds_boost), american_to_decimal(odds_hedge)
    base = stake * (da - 1)
    extra = base * boost_pct / 100
    if max_boost is not None:
        extra = min(extra, max_boost)
    winnings = base + extra
    hedge = (stake + winnings) / db
    profit = winnings - hedge
    return {"hedge_stake": hedge, "profit": profit, "conversion_pct": profit / stake * 100,
            "boosted_odds": decimal_to_american(1 + winnings / stake)}


def second_chance_hedge(stake: float, odds_promo: float, odds_hedge: float, refund: float | None = None,
                        refund_value: float = 0.7) -> dict:
    """Cash bet on side A; if it loses, up to `refund` comes back as a bonus bet worth refund_value per $.

    conversion_pct is the locked profit as a % of the refund amount.
    """
    da, db = american_to_decimal(odds_promo), american_to_decimal(odds_hedge)
    refunded = stake if refund is None else min(refund, stake)
    hedge = (stake * da - refunded * refund_value) / db
    profit = stake * (da - 1) - hedge
    return {"hedge_stake": hedge, "profit": profit,
            "conversion_pct": profit / refunded * 100 if refunded else 0.0}


def second_chance_ev(refund: float, odds: float, stake: float, fair_prob: float, refund_value: float = 0.7) -> float:
    """Rough EV of a 'lose -> bonus bet' offer on a single bet."""
    d = american_to_decimal(odds)
    win = fair_prob * stake * (d - 1)
    lose = (1 - fair_prob) * (-stake + min(refund, stake) * refund_value)
    return win + lose
