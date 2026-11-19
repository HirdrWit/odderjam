"""Polymarket Gamma API adapter (game moneyline markets).

A moneyline market has two outcomes, one per team. The first outcome is bought at ``bestAsk``;
the second at ``1 - bestBid`` (selling the first is buying the second). Without order book
depth the listed ``outcomePrices`` are used.
"""
import json
from datetime import datetime

import httpx

from ..engine.exchange import contract_to_american

BOOK = "Polymarket"
BASE = "https://gamma-api.polymarket.com"
TAGS = {"NBA": "nba", "NFL": "nfl", "MLB": "mlb", "NHL": "nhl"}
SPORTS = set(TAGS)


def _list(v) -> list:
    return json.loads(v) if isinstance(v, str) else list(v or [])


def _iso(ts: str) -> str:
    """Normalise Gamma timestamps ("2026-11-17 03:30:00+00", "...Z") to ISO 8601."""
    ts = ts.strip().replace(" ", "T").replace("Z", "+00:00")
    if len(ts) >= 3 and ts[-3] in "+-" and ts[-3:].lstrip("+-").isdigit():
        ts += ":00"
    dt = datetime.fromisoformat(ts)
    if dt.tzinfo is None:
        raise ValueError(f"timestamp without a UTC offset: {ts}")
    return dt.isoformat()


def _asks(m: dict) -> list[float]:
    listed = [float(p) for p in _list(m.get("outcomePrices"))]
    ask, bid = m.get("bestAsk"), m.get("bestBid")
    if ask is not None and bid is not None:
        return [float(ask), 1 - float(bid)]
    return listed


def _liquidity(m: dict, asks: list[float]) -> list[float | None]:
    """Dollars resting at each outcome's price: shares at the best ask / bid x that outcome's price. None if unknown."""
    ask_size, bid_size = m.get("bestAskSize"), m.get("bestBidSize")
    if m.get("bestAsk") is None or m.get("bestBid") is None:
        return [None, None]
    out = []
    for size, price in ((ask_size, asks[0]), (bid_size, asks[1])):
        out.append(None if size in (None, "") else round(float(size) * price, 2))
    return out


def parse(payload: list, sport: str, fee: dict) -> list[dict]:
    """Quotes ``{book, sport, start, prices: {team: american}}`` from a GET /events response."""
    quotes = []
    for e in payload:
        if e.get("closed"):
            continue
        for m in e.get("markets", []):
            if m.get("sportsMarketType") != "moneyline" or m.get("closed") or m.get("active") is False:
                continue
            try:
                names, asks = _list(m.get("outcomes")), _asks(m)
                start = m.get("gameStartTime") or e.get("startTime")
                if len(names) != 2 or len(asks) != 2 or not start:
                    continue
                prices = {n: contract_to_american(round(a * 100, 4), fee) for n, a in zip(names, asks)}
                if all(p is not None for p in prices.values()):
                    quotes.append({"book": BOOK, "sport": sport, "start": _iso(start), "prices": prices,
                                   "liquidity": dict(zip(names, _liquidity(m, asks)))})
            except (ValueError, TypeError):
                continue  # one malformed market never drops the rest
    return quotes


def fetch(sport: str, client: httpx.Client) -> list:
    """Open events for a sport's tag."""
    r = client.get(f"{BASE}/events", params={"tag_slug": TAGS[sport], "closed": "false", "limit": 500}, timeout=20)
    r.raise_for_status()
    return r.json()
