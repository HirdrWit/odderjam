"""Pick'em (PrizePicks / Underdog style) slip math.

A pick'em slip is n player-prop picks paid at a fixed multiplier of the stake
depending on how many hit. A payout table maps hits -> multiplier for one slip
size; a full table set maps size -> that table::

    {2: {2: 3.0}, 3: {3: 5.0}}                 # power: all legs must hit
    {3: {3: 2.25, 2: 1.25}}                    # flex: partial hits pay less

Legs are treated as independent (correlation is not modelled).
"""
import math
from heapq import nlargest
from itertools import combinations

MIN_LEGS, MAX_LEGS = 2, 6

# Typical published multipliers; they vary by app and change over time, so the UI lets the user edit them.
DEFAULT_PAYOUTS: dict[str, dict[int, dict[int, float]]] = {
    "power": {2: {2: 3.0}, 3: {3: 5.0}, 4: {4: 10.0}, 5: {5: 20.0}, 6: {6: 37.5}},
    "flex": {3: {3: 2.25, 2: 1.25}, 4: {4: 5.0, 3: 1.5}, 5: {5: 10.0, 4: 2.0, 3: 0.4},
             6: {6: 25.0, 5: 2.0, 4: 0.4}},
}

# Slip search only combines this many of the most likely legs (C(12, 6) = 924 slips at most).
CANDIDATE_POOL = 12


def hit_distribution(probs: list[float]) -> list[float]:
    """P(exactly k legs hit) for k = 0..n, for independent legs (Poisson-binomial)."""
    dist = [1.0]
    for p in probs:
        nxt = [0.0] * (len(dist) + 1)
        for k, q in enumerate(dist):
            nxt[k] += q * (1 - p)
            nxt[k + 1] += q * p
        dist = nxt
    return dist


def slip_ev(probs: list[float], table: dict[int, float]) -> dict:
    """Expected return (multiple of stake), EV % and the chance of any paying result."""
    dist = hit_distribution(probs)
    ret = sum(dist[k] * m for k, m in table.items() if 0 <= k < len(dist))
    win = sum(dist[k] for k, m in table.items() if 0 <= k < len(dist) and m > 0)
    return {"expected_return": ret, "ev_pct": (ret - 1) * 100, "win_prob": win}


def breakeven_prob(table: dict[int, float], n: int) -> float:
    """Per-leg probability at which an n-leg slip of equal legs has zero EV (bisection).

    Expected return rises with the leg probability for any table whose multipliers grow with hits.
    """
    lo, hi = 0.0, 1.0
    for _ in range(60):
        mid = (lo + hi) / 2
        if slip_ev([mid] * n, table)["expected_return"] < 1:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2


def validate_table(table: dict[int, dict[int, float]]) -> None:
    """Raise ValueError unless every size is 2..6, hits are 0..size and multipliers are finite and >= 0."""
    for n, tiers in table.items():
        if not MIN_LEGS <= n <= MAX_LEGS:
            raise ValueError(f"slip size {n} is outside {MIN_LEGS}..{MAX_LEGS}")
        for hits, mult in tiers.items():
            if not 0 <= hits <= n:
                raise ValueError(f"{hits} hits is impossible on a {n}-leg slip")
            if not math.isfinite(mult) or mult < 0:
                raise ValueError(f"multiplier {mult} for {hits}/{n} must be finite and >= 0")


def _valid(slip: tuple[dict, ...]) -> bool:
    players = [leg["player"].casefold() for leg in slip]
    return len(set(players)) == len(players) and len({leg["event_id"] for leg in slip}) > 1


def _candidates(legs: list[dict]) -> list[dict]:
    """The legs worth combining: each player's most likely leg, the CANDIDATE_POOL best of those,
    with the best leg from a second event swapped in if they would all come from one event.

    A slip holds one leg per player, and with payouts that rise with hits a more likely leg never
    lowers EV, so a player's weaker legs can be dropped before the search.
    """
    best: dict[str, dict] = {}
    for leg in legs:
        key = leg["player"].casefold()
        if key not in best or leg["prob"] > best[key]["prob"]:
            best[key] = leg
    ranked = sorted(best.values(), key=lambda leg: leg["prob"], reverse=True)
    pool = ranked[:CANDIDATE_POOL]
    events = {leg["event_id"] for leg in pool}
    if len(events) == 1:
        other = next((leg for leg in ranked[CANDIDATE_POOL:] if leg["event_id"] not in events), None)
        if other:
            pool[-1] = other
    return pool


def best_slips(legs: list[dict], size: int, table: dict[int, float], top: int = 3) -> list[dict]:
    """Top slips of exactly `size` legs, best EV first.

    Each leg needs "player", "event_id" and "prob". A slip never holds two legs on one
    player, and never has every leg from one event (both are highly correlated).
    """
    pool = _candidates(legs)
    scored = []
    for slip in combinations(pool, size):
        if _valid(slip):
            r = slip_ev([leg["prob"] for leg in slip], table)
            scored.append({"legs": list(slip), **r})
    return nlargest(top, scored, key=lambda s: s["ev_pct"])


SIDES = {"over": "Over", "under": "Under", "o": "Over", "u": "Under"}


def parse_lines(text: str) -> tuple[list[dict], list[dict]]:
    """Parse pasted pick'em lines, one per row: `player, market, line[, over|under]` (comma or tab separated).

    Returns (lines, errors); blank rows are skipped, bad rows are reported with their 1-based row number.
    """
    lines, errors = [], []
    for row, raw in enumerate(text.splitlines(), start=1):
        if not raw.strip():
            continue
        parts = [s.strip() for s in raw.split("\t" if "\t" in raw else ",")]
        err = None
        if len(parts) not in (3, 4) or not parts[0] or not parts[1]:
            err = "expected: player, market, line[, over|under]"
        else:
            try:
                point = float(parts[2])
                if not math.isfinite(point):
                    raise ValueError
            except ValueError:
                err = f"line {parts[2]!r} is not a number"
            side = None
            if not err and len(parts) == 4 and parts[3]:
                side = SIDES.get(parts[3].casefold())
                if side is None:
                    err = f"side {parts[3]!r} must be over or under"
        if err:
            errors.append({"row": row, "text": raw.strip(), "error": err})
        else:
            lines.append({"player": parts[0], "market": parts[1], "point": point, "side": side})
    return lines, errors
