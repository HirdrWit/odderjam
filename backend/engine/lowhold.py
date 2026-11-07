from typing import Any

from .arb import arb


def hold_pct(odds_a: float, odds_b: float) -> float:
    """Negative profit of the two-way arb == the hold paid to cover both sides."""
    return -arb([odds_a, odds_b])["profit_pct"]


def best_pair(prices_a: dict[str, float], prices_b: dict[str, float], book: str | None = None,
              stake: float = 100.0) -> dict[str, Any] | None:
    """Lowest-hold way to bet both sides of a two-way market.

    ``prices_a``/``prices_b`` map book -> American odds for each side. With ``book`` set, one leg
    must be placed at that book (e.g. the one with a rollover to clear); the other leg takes the
    best price anywhere. Returns None if no valid pair exists.
    """
    def best_price(prices: dict[str, float]) -> tuple[str, float] | None:
        """Return the (book, odds) with the highest odds, or None if there are no prices."""
        return max(prices.items(), key=lambda kv: kv[1]) if prices else None

    if book is None:
        candidates = [(best_price(prices_a), best_price(prices_b))]
    else:
        candidates = []
        if book in prices_a:
            candidates.append(((book, prices_a[book]), best_price(prices_b)))
        if book in prices_b:
            candidates.append((best_price(prices_a), (book, prices_b[book])))
    valid = [pair for pair in candidates if pair[0] and pair[1]]
    if not valid:
        return None
    legs = min(valid, key=lambda pair: hold_pct(pair[0][1], pair[1][1]))
    result = arb([price for _, price in legs], bankroll=stake)
    return {
        "legs": [{"book": book_name, "odds": price, "stake": leg_stake} for (book_name, price), leg_stake in zip(legs, result["stakes"])],
        "hold_pct": -result["profit_pct"],
        "payout": result["payout"],
        "expected_loss": stake - result["payout"],
    }
