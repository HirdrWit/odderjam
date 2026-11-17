"""Sanity check for markets whose prices look stale or mismatched.

A real market never holds far below zero, and spread or total prices never reach thousands.
The Odds Screen (frontend/src/odds.js isSuspectMarket mirrors this) and every opportunity
scanner use the same two limits, so a bad line is never shown as a best price or an edge.
"""
from .odds import american_to_prob

HOLD_FLOOR_PCT = -10.0  # best-price hold below this is impossible for a real market
ODDS_CAP = 5000  # |American odds| above this on a spread or total is a stale or mismatched price
CAPPED_MARKETS = ("spreads", "totals")


def is_suspect_market(market: str, outcomes: list[dict]) -> bool:
    """True when one line's outcomes (every side of it) have a hold below the floor or odds beyond the cap."""
    prices = [[p for p in o["prices"].values() if p is not None] for o in outcomes]
    if market in CAPPED_MARKETS and any(abs(p) > ODDS_CAP for side in prices for p in side):
        return True
    if prices and all(prices):
        hold = (sum(american_to_prob(max(side)) for side in prices) - 1) * 100
        return hold < HOLD_FLOOR_PCT
    return False
