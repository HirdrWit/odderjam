"""Merge exchange and prediction-market quotes into sportsbook events as extra books.

A quote is ``{book, sport, start, prices: {team name as the exchange writes it: american}}``.
It is matched to the event of the same sport whose two teams it names, starting closest in time
(within a tolerance, so doubleheaders and next week's rematch land on the right game). Only
moneyline (game winner) prices are merged.

Enrichment is opt-in: set ``EXCHANGES`` to a comma list such as ``Kalshi,Polymarket``.
"""
import logging
import os
from datetime import datetime, timedelta

import httpx

from ..engine.exchange import fee_for
from . import kalshi, polymarket
from .teams import same_team

PLATFORMS = {"Kalshi": kalshi, "Polymarket": polymarket}
# Platforms with a public trade feed (parse_trades/fetch_trades), polled for Sharp Money.
TRADE_PLATFORMS = {"Kalshi": kalshi}
log = logging.getLogger(__name__)


def _ts(s: str) -> datetime:
    dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
    if dt.tzinfo is None:
        raise ValueError(f"timestamp without a UTC offset: {s}")
    return dt


def _sides(quote: dict, e: dict) -> dict[str, str] | None:
    """Map each quote team to the event's home/away name, or None unless the mapping is one-to-one."""
    mapping = {}
    for name in quote["prices"]:
        hits = [t for t in (e["home"], e["away"]) if same_team(name, t)]
        if len(hits) != 1:
            return None
        mapping[name] = hits[0]
    if len(mapping) != 2 or len(set(mapping.values())) != 2:
        return None
    return mapping


def _match(q: dict, events: list[dict], tolerance_hours: float) -> tuple[float, dict, dict] | None:
    """(gap hours, event, name mapping) for the event closest to the quote's game start, or None."""
    start = _ts(q["start"])
    lag = timedelta(hours=float(q.get("lag_hours", 0.0)))
    best = None
    for e in events:
        if e["sport"] != q["sport"]:
            continue
        mapping = _sides(q, e)
        if not mapping:
            continue
        gap = abs((_ts(e["start"]) + lag - start).total_seconds()) / 3600
        if gap <= tolerance_hours and (best is None or gap < best[0]):
            best = (gap, e, mapping)
    return best


def merge_quotes(events: list[dict], quotes: list[dict], tolerance_hours: float = 12) -> list[dict]:
    """Add each quote's prices to its matching event's moneyline outcomes (events are updated in place).

    If two quotes from one book land on the same event, the one closest in time wins. A malformed
    quote is skipped. A quote's ``markets`` ({team: market id}) are kept on the event as
    ``exchange_markets[book][event team]``, so Sharp Money knows which markets to poll.
    """
    placed: dict[tuple[str, int], tuple[float, dict, dict, dict]] = {}
    for q in quotes:
        try:
            m = _match(q, events, tolerance_hours)
        except (ValueError, TypeError, KeyError) as exc:
            log.warning("exchange quote skipped: %s", exc)
            continue
        if m is None:
            continue
        gap, e, mapping = m
        key = (q["book"], id(e))
        if key not in placed or gap < placed[key][0]:
            placed[key] = (gap, e, q, mapping)
    for _, e, q, mapping in placed.values():
        outcomes = e["markets"].setdefault("moneyline", [])
        for name, price in q["prices"].items():
            team = mapping[name]
            o = next((o for o in outcomes if o["name"] == team), None)
            if o is None:
                o = {"name": team, "point": None, "prices": {}}
                outcomes.append(o)
            o["prices"][q["book"]] = price
        for name, dollars in (q.get("liquidity") or {}).items():
            if dollars is not None and name in mapping:  # missing stays missing, never 0
                o = next(o for o in outcomes if o["name"] == mapping[name])
                o.setdefault("liquidity", {})[q["book"]] = dollars
        tickers = q.get("markets")
        if tickers:
            e.setdefault("exchange_markets", {})[q["book"]] = {
                mapping[name]: t for name, t in tickers.items() if name in mapping and t}
    return events


def collect(platforms: list[str], sports: set[str], client: httpx.Client) -> list[dict]:
    """Quotes from every platform and sport it covers; a platform that fails is skipped."""
    quotes = []
    for name in platforms:
        mod = PLATFORMS.get(name)
        if mod is None:
            continue
        fee = fee_for(name)
        for sport in sorted(sports & mod.SPORTS):
            try:
                quotes.extend(mod.parse(mod.fetch(sport, client), sport, fee))
            except Exception as exc:  # noqa: BLE001 - third-party payloads; never fail the sportsbook snapshot
                log.warning("exchange %s %s skipped: %s", name, sport, exc)
    return quotes


def enabled() -> list[str]:
    return [p.strip() for p in os.environ.get("EXCHANGES", "").split(",") if p.strip()]


def enrich(events: list[dict], platforms: list[str] | None = None, client: httpx.Client | None = None) -> list[dict]:
    """Events with exchange moneyline prices merged in, for the platforms in ``EXCHANGES``."""
    platforms = enabled() if platforms is None else platforms
    if not platforms or not events:
        return events
    sports = {e["sport"] for e in events}
    if client is not None:
        return merge_quotes(events, collect(platforms, sports, client))
    with httpx.Client() as c:
        return merge_quotes(events, collect(platforms, sports, c))
