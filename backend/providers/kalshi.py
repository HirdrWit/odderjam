"""Kalshi public market data adapter (game winner markets).

Each game is a Kalshi event with one market per team; YES on a team's market pays if that team
wins. Backing a team can also be done with NO on the opponent's market, so each side is priced at
the cheaper of the two. Prices are taker asks, converted to American odds after Kalshi's fee.
"""
from datetime import datetime

import httpx

from ..engine.exchange import contract_to_american

BOOK = "Kalshi"
BASE = "https://api.elections.kalshi.com/trade-api/v2"
SERIES = {"NBA": "KXNBAGAME", "NFL": "KXNFLGAME", "MLB": "KXMLBGAME", "NHL": "KXNHLGAME"}
SPORTS = set(SERIES)
# Hours from first pitch/tip-off to expected settlement, used when a market only carries
# expected_expiration_time, so matching compares like with like (doubleheaders, back-to-backs).
GAME_HOURS = {"NBA": 2.5, "NFL": 3.25, "MLB": 3.0, "NHL": 2.5}
OPEN = {"active", "open"}
MAX_PAGES = 10


def _ask_cents(market: dict, side: str) -> float | None:
    """The ask for ``side`` ("yes"/"no") in cents, from the dollar field or the legacy cent field."""
    dollars = market.get(f"{side}_ask_dollars")
    if dollars not in (None, ""):
        return float(dollars) * 100
    cents = market.get(f"{side}_ask")
    return None if cents is None else float(cents)


def _iso(ts: str) -> str:
    return datetime.fromisoformat(ts.replace("Z", "+00:00")).isoformat()


def _best(fee: dict, *cents: float | None) -> float | None:
    prices = [a for a in (contract_to_american(c, fee) for c in cents if c is not None) if a is not None]
    return max(prices, default=None)


def parse(payload: dict, sport: str, fee: dict) -> list[dict]:
    """Quotes ``{book, sport, start, prices: {team: american}}`` from a GET /markets response."""
    by_event: dict[str, list[dict]] = {}
    for m in payload.get("markets", []):
        if m.get("status") in OPEN and m.get("yes_sub_title"):
            by_event.setdefault(m["event_ticker"], []).append(m)
    quotes = []
    for markets in by_event.values():
        if len(markets) != 2:
            continue
        a, b = markets
        start, lag = a.get("occurrence_datetime"), 0.0
        if not start:
            start, lag = a.get("expected_expiration_time"), GAME_HOURS.get(sport, 3.0)
        if not start:
            continue  # close_time can be weeks after the game, too loose to match on
        prices = {}
        for team, other in ((a, b), (b, a)):
            price = _best(fee, _ask_cents(team, "yes"), _ask_cents(other, "no"))
            if price is not None:
                prices[team["yes_sub_title"]] = price
        if len(prices) == 2:
            # ``start`` is the market's timestamp; ``lag_hours`` is how far it trails the game start.
            quotes.append({"book": BOOK, "sport": sport, "start": _iso(start), "lag_hours": lag, "prices": prices})
    return quotes


def fetch(sport: str, client: httpx.Client) -> dict:
    """All open game-winner markets for a sport, following the pagination cursor."""
    markets, cursor = [], None
    for _ in range(MAX_PAGES):
        params = {"series_ticker": SERIES[sport], "status": "open", "limit": 1000}
        if cursor:
            params["cursor"] = cursor
        r = client.get(f"{BASE}/markets", params=params, timeout=20)
        r.raise_for_status()
        body = r.json()
        markets.extend(body.get("markets", []))
        cursor = body.get("cursor")
        if not cursor:
            break
    return {"markets": markets}


def parse_trades(payload: dict) -> list[dict]:
    return []


def fetch_trades(ticker: str, min_ts: float, client: httpx.Client) -> dict:
    return {"trades": []}
