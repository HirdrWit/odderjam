"""Merge exchange and prediction-market quotes into sportsbook events as extra books.

A quote is ``{book, sport, start, prices: {team name as the exchange writes it: american}}``.
It is matched to the event of the same sport whose two teams it names, starting closest in time
(within a tolerance, so doubleheaders and next week's rematch land on the right game). Only
moneyline (game winner) prices are merged.

Enrichment is opt-in: set ``EXCHANGES`` to a comma list such as ``Kalshi,Polymarket``.
"""
import logging
import os
from datetime import datetime

import httpx

from ..engine.exchange import fee_for
from . import kalshi, polymarket
from .teams import same_team

PLATFORMS = {"Kalshi": kalshi, "Polymarket": polymarket}
log = logging.getLogger(__name__)


def _ts(s: str) -> datetime:
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


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


def merge_quotes(events: list[dict], quotes: list[dict], tolerance_hours: float = 12) -> list[dict]:
    """Add each quote's prices to its matching event's moneyline outcomes (events are updated in place)."""
    for q in quotes:
        start = _ts(q["start"])
        best = None
        for e in events:
            if e["sport"] != q["sport"]:
                continue
            mapping = _sides(q, e)
            gap = abs((_ts(e["start"]) - start).total_seconds()) / 3600
            if mapping and gap <= tolerance_hours and (best is None or gap < best[0]):
                best = (gap, e, mapping)
        if best is None:
            continue
        _, e, mapping = best
        outcomes = e["markets"].setdefault("moneyline", [])
        for name, price in q["prices"].items():
            team = mapping[name]
            o = next((o for o in outcomes if o["name"] == team), None)
            if o is None:
                o = {"name": team, "point": None, "prices": {}}
                outcomes.append(o)
            o["prices"][q["book"]] = price
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
            except (httpx.HTTPError, ValueError, KeyError, TypeError) as exc:
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
