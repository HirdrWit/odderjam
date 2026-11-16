"""Sharp Money: volume spikes in exchange trades.

A trade is ``{ts, cents, size}``: when it matched (epoch seconds), the contract price it matched at
(0-100 cents, the side being tracked) and how many contracts changed hands. Exchanges publish every
match, so a burst of volume well above the usual rate points at informed money. The burst's
volume-weighted price is the price that money paid; any sportsbook paying more is +EV against it.

Pure functions: the current time is always passed in.
"""
import math

from .ev import ev_pct
from .odds import prob_to_american


def _valid(t: dict) -> bool:
    return 0 < t["cents"] < 100 and t["size"] > 0


def volume_by_price(trades: list[dict]) -> list[dict]:
    """Matched volume per price, largest first (ties: lower price first). Bad trades are ignored."""
    by: dict[float, float] = {}
    for t in trades:
        if _valid(t):
            by[t["cents"]] = by.get(t["cents"], 0.0) + t["size"]
    return [{"cents": c, "volume": v} for c, v in sorted(by.items(), key=lambda cv: (-cv[1], cv[0]))]


def _check(name: str, value: float, allow_zero: bool = False) -> None:
    ok = math.isfinite(value) and (value >= 0 if allow_zero else value > 0)
    if not ok:
        raise ValueError(f"{name} must be a finite number {'>= 0' if allow_zero else '> 0'}, got {value!r}")


def detect(trades: list[dict], now: float, window: float = 600.0, baseline: float = 7200.0, k: float = 3.0,
           min_volume: float = 0.0) -> dict | None:
    """The spike in the last ``window`` seconds, or None.

    The window is ``(now - window, now]``; the baseline is the ``baseline`` seconds before it,
    ``(now - window - baseline, now - window]``, scaled to one window's length. A spike needs at least
    ``min_volume`` contracts in the window and strictly more than ``k`` x the baseline. ``ratio`` is
    None when the baseline period had no trades.
    """
    _check("window", window)
    _check("baseline", baseline)
    _check("k", k)
    _check("min_volume", min_volume, allow_zero=True)
    start, base_start = now - window, now - window - baseline
    recent = [t for t in trades if _valid(t) and start < t["ts"] <= now]
    base_volume = sum(t["size"] for t in trades if _valid(t) and base_start < t["ts"] <= start)
    volume = sum(t["size"] for t in recent)
    base = base_volume * window / baseline
    if not recent or volume < min_volume or volume <= k * base:
        return None
    vwap = sum(t["cents"] * t["size"] for t in recent) / volume
    fair = vwap / 100
    return {
        "volume": volume, "baseline": base, "ratio": volume / base if base else None,
        "vwap_cents": vwap, "fair_prob": fair, "price": prob_to_american(fair),
        "trades": len(recent), "by_price": volume_by_price(recent),
    }


def beating(prices: dict[str, float], fair_prob: float) -> list[dict]:
    """Books whose price is +EV against ``fair_prob``, best EV first."""
    out = [{"book": b, "price": p, "ev_pct": ev_pct(fair_prob, p)} for b, p in prices.items()]
    return sorted((r for r in out if r["ev_pct"] > 0), key=lambda r: -r["ev_pct"])
