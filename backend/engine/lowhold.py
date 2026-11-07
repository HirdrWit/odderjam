from .arb import arb


def hold_pct(odds_a: float, odds_b: float) -> float:
    """Negative profit of the two-way arb == the hold paid to cover both sides."""
    return -arb([odds_a, odds_b])["profit_pct"]


def best_pair(prices_a: dict[str, float], prices_b: dict[str, float], book: str | None = None,
              stake: float = 100.0) -> dict | None:
    """Lowest-hold way to bet both sides of a two-way market.

    ``prices_a``/``prices_b`` map book -> American odds for each side. With ``book`` set, one leg
    must be placed at that book (e.g. the one with a rollover to clear); the other leg takes the
    best price anywhere. Returns None if no valid pair exists.
    """
    def best(prices):
        return max(prices.items(), key=lambda kv: kv[1]) if prices else None

    if book is None:
        candidates = [(best(prices_a), best(prices_b))]
    else:
        candidates = []
        if book in prices_a:
            candidates.append(((book, prices_a[book]), best(prices_b)))
        if book in prices_b:
            candidates.append((best(prices_a), (book, prices_b[book])))
    candidates = [c for c in candidates if c[0] and c[1]]
    if not candidates:
        return None
    legs = min(candidates, key=lambda c: hold_pct(c[0][1], c[1][1]))
    result = arb([price for _, price in legs], bankroll=stake)
    return {
        "legs": [{"book": b, "odds": price, "stake": s} for (b, price), s in zip(legs, result["stakes"])],
        "hold_pct": -result["profit_pct"],
        "payout": result["payout"],
        "expected_loss": stake - result["payout"],
    }
