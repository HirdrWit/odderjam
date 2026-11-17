"""Flags for +EV rows nobody should bet: in-play, longshot, too good to be true.

Pure functions. `ctx` describes one +EV row:
  market, odds (American), ev_pct, worst_ev_pct (EV under worst-case devig), is_live, live_enabled,
  max_price_age, price_age (seconds or None), update_times ({book: epoch or None}, bet book + sharps),
  sharp_probs (each sharp's own fair probability for this outcome, 0..1).
"""
import math

from . import markets as mk

DEFAULT_PROFILE = {
    "odds_min": -250.0, "odds_max": 250.0,   # American; outside this is a heavy favourite / longshot
    "ev_ceiling": 8.0, "prop_ev_ceiling": 12.0,  # percent; above this the edge is probably a pricing error
    "min_ev": 0.0,                           # percent; worst-case devig EV below this is fragile
    "max_skew_seconds": 20.0,                # book vs sharp update gap allowed for a live row
    "max_sharp_spread": 0.03,                # probability (0..1) gap allowed between sharps
    "require_conservative": True,            # flag `fragile` rows (EV gone under the worst-case devig)
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


def profile_error(profile: dict) -> str | None:
    """Message for a nonsense profile (non-finite, negative, inverted odds range), else None."""
    if not all(math.isfinite(v) for v in profile.values()):
        return "bettable thresholds must be finite numbers"
    if profile["odds_min"] > profile["odds_max"]:
        return f"bettable_odds_min ({profile['odds_min']:g}) is greater than bettable_odds_max ({profile['odds_max']:g})"
    for k in ("ev_ceiling", "prop_ev_ceiling", "max_skew_seconds", "max_sharp_spread"):
        if profile[k] < 0:
            return f"{k} must not be negative"
    return None
