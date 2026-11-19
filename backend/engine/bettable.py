"""Flags for +EV rows nobody should bet: in-play, longshot, too good to be true.

Pure functions. `ctx` describes one +EV row:
  market, odds (American), ev_pct, worst_ev_pct (EV under worst-case devig), is_live, live_enabled,
  max_price_age, price_age (seconds or None), update_times ({book: epoch or None}, bet book + sharps),
  sharp_probs (each sharp's own fair probability for this outcome, 0..1).
"""
import math

from . import live, markets as mk
from .exchange import DEFAULT_FEES

EXCHANGE_BOOKS = set(DEFAULT_FEES)

DEFAULT_PROFILE = {
    "odds_min": -250.0, "odds_max": 250.0,   # American; outside this is a heavy favourite / longshot
    "ev_ceiling": 8.0, "prop_ev_ceiling": 12.0,  # percent; above this the edge is probably a pricing error
    "min_ev": 0.0,                           # percent; worst-case devig EV below this is fragile
    "max_skew_seconds": 20.0,                # book vs sharp update gap allowed for a live row
    "max_sharp_spread": 0.03,                # probability (0..1) gap allowed between sharps
    "require_conservative": True,            # flag `fragile` rows (EV gone under the worst-case devig)
    "must_bet_min_ev": 2.0,                  # percent; worst-case EV a "must bet" needs
    "must_bet_odds_min": -200.0, "must_bet_odds_max": 200.0,  # American; a must bet is not a heavy favourite or longshot
    "must_bet_max_hold": 5.0,                # percent; widest sharp line hold a must bet tolerates
}

LABELS = {
    "in_play": "Game is live and the prices may not be in sync",
    "longshot": "Longshot: small fair-probability errors swing the EV a lot",
    "heavy_fav": "Heavy favourite: little to win for the risk",
    "too_good": "Too good to be true: real edges are a few percent",
    "fragile": "Edge disappears under a more cautious devig",
    "sharps_disagree": "Sharp books disagree on the fair price",
}


def _live_in_sync(ctx: dict, profile: dict) -> bool:
    if not ctx.get("live_enabled"):
        return False
    age = ctx.get("price_age")
    if age is None or age > ctx["max_price_age"]:
        return False
    times = list(ctx.get("update_times", {}).values())
    if not times or any(t is None for t in times):
        return False
    return max(times) - min(times) <= profile["max_skew_seconds"]


def flags(ctx: dict, profile: dict) -> list[str]:
    out = []
    if ctx["is_live"] and not _live_in_sync(ctx, profile):
        out.append("in_play")
    if ctx["odds"] > profile["odds_max"]:
        out.append("longshot")
    if ctx["odds"] < profile["odds_min"]:
        out.append("heavy_fav")
    ceiling = profile["prop_ev_ceiling"] if mk.is_prop(ctx["market"]) else profile["ev_ceiling"]
    if ctx["ev_pct"] > ceiling:
        out.append("too_good")
    if profile["require_conservative"] and ctx["worst_ev_pct"] < profile["min_ev"]:
        out.append("fragile")
    probs = ctx.get("sharp_probs", [])
    if len(probs) >= 2 and max(probs) - min(probs) > profile["max_sharp_spread"]:
        out.append("sharps_disagree")
    return out


MIN_MUST_BET_SHARPS = 2


def must_bet(row: dict, profile: dict) -> dict:
    """Does a +EV row pass every check? `row` is a /api/ev row.

    Returns {"must_bet", "reasons", "missing"}. Reasons are "<check>: text"; when the row is not a
    must bet they name every failed check (the first one first). `missing` lists checks that could not
    run for lack of data (worst_ev, sharp_counterparty, sharp_movement): they skip, they do not fail.
    """
    passed, failed, missing = [], [], []

    def check(name: str, ok: bool, good: str, bad: str) -> None:
        (passed if ok else failed).append(f"{name}: {good if ok else bad}")

    flags = [f for f in row.get("flags", []) if f != "sharp_counterparty"]
    check("flags", not flags, "no bettable flags", f"flagged {', '.join(flags)}")
    worst = row.get("worst_ev_pct")
    if worst is None:
        missing.append("worst_ev")
    else:
        floor = profile["must_bet_min_ev"]
        check("worst_ev", worst >= floor, f"worst-case EV {worst:.1f}% (needs {floor:g}%)",
              f"worst-case EV {worst:.1f}% is under {floor:g}%")
    lo, hi, odds = profile["must_bet_odds_min"], profile["must_bet_odds_max"], row["odds"]
    check("odds", lo <= odds <= hi, f"odds {odds:+g} within {lo:+g}..{hi:+g}",
          f"odds {odds:+g} outside {lo:+g}..{hi:+g}")
    n = len(row.get("sharps", []))
    check("sharps", n >= MIN_MUST_BET_SHARPS, f"{n} sharps priced the line",
          f"only {n} sharp(s) priced the line (needs {MIN_MUST_BET_SHARPS})")
    hold, cap = row.get("sharp_hold_pct"), profile["must_bet_max_hold"]
    if hold is None:
        missing.append("sharp_hold")
    else:
        check("hold", hold <= cap, f"sharp hold {hold:.1f}% (max {cap:g}%)", f"sharp hold {hold:.1f}% is over {cap:g}%")
    if row.get("book") in EXCHANGE_BOOKS:
        if "sharp_counterparty" in row.get("flags", []):
            failed.append("counterparty: the other side of this exchange bet is a sharp")
        elif "exchange_liquidity" not in row:
            missing.append("sharp_counterparty")
        else:
            passed.append("counterparty: no sharp on the other side")
    if row.get("arb_backed"):
        passed.append("arb_backed: one leg of an arbitrage")
    move = row.get("sharp_move")
    if move is None:
        missing.append("sharp_movement")
    elif move == "toward":
        passed.append("steam: sharps are moving toward this bet")
    return {"must_bet": not failed, "reasons": failed or passed, "missing": missing}


def profile_error(profile: dict) -> str | None:
    """Message for a nonsense profile (non-finite, negative, inverted odds range), else None."""
    if not all(math.isfinite(v) for v in profile.values()):
        return "bettable thresholds must be finite numbers"
    if profile["odds_min"] > profile["odds_max"]:
        return f"bettable_odds_min ({profile['odds_min']:g}) is greater than bettable_odds_max ({profile['odds_max']:g})"
    if profile["must_bet_odds_min"] > profile["must_bet_odds_max"]:
        return (f"must_bet_odds_min ({profile['must_bet_odds_min']:g}) is greater than "
                f"must_bet_odds_max ({profile['must_bet_odds_max']:g})")
    for k in ("ev_ceiling", "prop_ev_ceiling", "max_skew_seconds", "max_sharp_spread",
              "must_bet_min_ev", "must_bet_max_hold"):
        if profile[k] < 0:
            return f"{k} must not be negative"
    return None


# Multi-leg rows (arbs, middles, low hold): a row is only as good as its stalest leg.

LEG_SKEW_SECONDS = 20.0  # legs priced further apart than this were not seen at the same moment
TOO_GOOD_ARB_PCT = 5.0  # an arb above this is almost always a bad line
TOO_GOOD_MIDDLE_EV_PCT = 10.0  # plausibility ceiling for a middle's expected value (percent of stake)
LONGSHOT_ODDS = 1000  # a leg above +1000


def multi_leg_flags(event: dict, books: list[str], prices: list[float], now: float, *,
                    profit_pct: float | None = None, ev_pct: float | None = None) -> list[str]:
    """Flags for a row with one leg per (book, price). Order: in_play, leg_skew, too_good, longshot_leg."""
    flags = []
    if live.is_live(event, now):
        flags.append("in_play")
    updated = event.get("updated", {})
    times = [t for t in (live.parse_time(updated.get(b)) for b in books) if t is not None]
    if len(times) > 1 and max(times) - min(times) > LEG_SKEW_SECONDS:
        flags.append("leg_skew")
    if (profit_pct is not None and profit_pct > TOO_GOOD_ARB_PCT) \
            or (ev_pct is not None and ev_pct > TOO_GOOD_MIDDLE_EV_PCT):
        flags.append("too_good")
    if any(p > LONGSHOT_ODDS for p in prices):
        flags.append("longshot_leg")
    return flags
