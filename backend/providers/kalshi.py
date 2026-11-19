"""Kalshi public market data adapter (game winner markets).

Each game is a Kalshi event with one market per team; YES on a team's market pays if that team
wins. Backing a team can also be done with NO on the opponent's market, so each side is priced at
the cheaper of the two. Prices are taker asks, converted to American odds after Kalshi's fee.
"""
import logging
import time
from datetime import datetime

import httpx

from ..engine.exchange import contract_to_american
from ..engine.gamehours import GAME_HOURS

BOOK = "Kalshi"
BASE = "https://api.elections.kalshi.com/trade-api/v2"
SERIES = {"NBA": "KXNBAGAME", "NFL": "KXNFLGAME", "MLB": "KXMLBGAME", "NHL": "KXNHLGAME"}
SPORTS = set(SERIES)
# GAME_HOURS (first pitch/tip-off to expected settlement) is used when a market only carries
# expected_expiration_time, so matching compares like with like (doubleheaders, back-to-backs).
OPEN = {"active", "open"}
MAX_PAGES = 10
TRADE_TIMEOUT = 5  # seconds per trades page; polling runs inside a request
TRADE_FETCH_SECONDS = 10.0  # stop paging one market's trades after this long
_clock = time.monotonic
log = logging.getLogger(__name__)


def _ask_cents(market: dict, side: str) -> float | None:
    """The ask for ``side`` ("yes"/"no") in cents, from the dollar field or the legacy cent field."""
    dollars = market.get(f"{side}_ask_dollars")
    if dollars not in (None, ""):
        return float(dollars) * 100
    cents = market.get(f"{side}_ask")
    return None if cents is None else float(cents)


def _iso(ts: str) -> str:
    return datetime.fromisoformat(ts.replace("Z", "+00:00")).isoformat()


def _ask_dollars_available(market: dict, side: str, cents: float) -> float | None:
    """Dollars resting at ``side``'s best ask (contracts x price), or None when the market gives no size."""
    size = market.get(f"{side}_ask_size_fp")
    if size in (None, ""):
        size = market.get(f"{side}_ask_size")
    try:
        return None if size in (None, "") else round(float(size) * cents / 100, 2)
    except (TypeError, ValueError):
        return None


def _best(fee: dict, *options: tuple[float | None, float | None]) -> tuple[float | None, float | None]:
    """(American odds, dollars available) of the cheapest option; options are ``(cents, dollars)``."""
    best = (None, None)
    for cents, dollars in options:
        if cents is None:
            continue
        a = contract_to_american(cents, fee)
        if a is not None and (best[0] is None or a > best[0]):
            best = (a, dollars)
    return best


def parse(payload: dict, sport: str, fee: dict) -> list[dict]:
    """Quotes ``{book, sport, start, prices: {team: american}, markets: {team: ticker}}`` from GET /markets."""
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
        prices, tickers, liquidity = {}, {}, {}
        for team, other in ((a, b), (b, a)):
            options = []
            for mkt, side in ((team, "yes"), (other, "no")):
                cents = _ask_cents(mkt, side)
                options.append((cents, None if cents is None else _ask_dollars_available(mkt, side, cents)))
            price, dollars = _best(fee, *options)
            if price is not None:
                prices[team["yes_sub_title"]] = price
                tickers[team["yes_sub_title"]] = team.get("ticker")
                liquidity[team["yes_sub_title"]] = dollars
        if len(prices) == 2:
            # ``start`` is the market's timestamp; ``lag_hours`` is how far it trails the game start.
            # ``markets`` maps each team to its market ticker, for the Sharp Money trade feed.
            quotes.append({"book": BOOK, "sport": sport, "start": _iso(start), "lag_hours": lag, "prices": prices,
                           "markets": tickers, "liquidity": liquidity})
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



def _num(market: dict, dollars: str, legacy: str, scale: float) -> float | None:
    """A trade field from its string ``*_dollars``/``*_fp`` form, else the legacy numeric field."""
    v = market.get(dollars)
    if v not in (None, ""):
        return float(v) * scale
    v = market.get(legacy)
    return None if v is None else float(v)


def parse_trades(payload: dict) -> list[dict]:
    """Trades ``{trade_id, cents, size, ts}`` from a GET /markets/trades response; ``cents`` is the YES price.

    Every match has a YES buyer and a NO buyer; the taker is the side that crossed the spread. A trade
    whose taker bought NO carries ``taker: "no"``: that money backed the other side, at ``100 - cents``.
    A trade missing its id, price, count or time, or carrying an unparsable one, is skipped.
    """
    out = []
    for t in payload.get("trades", []):
        try:
            cents = _num(t, "yes_price_dollars", "yes_price", 100)
            size = _num(t, "count_fp", "count", 1)
            ts = datetime.fromisoformat(t["created_time"].replace("Z", "+00:00")).timestamp()
        except (KeyError, TypeError, ValueError, AttributeError):
            continue
        if not t.get("trade_id") or cents is None or size is None:
            continue
        trade = {"trade_id": str(t["trade_id"]), "cents": cents, "size": size, "ts": ts}
        if t.get("taker_side") == "no":
            trade["taker"] = "no"
        out.append(trade)
    return out


def fetch_trades(ticker: str, min_ts: float, client: httpx.Client) -> dict:
    """Public trades on one market since ``min_ts`` (epoch seconds), following the cursor.

    Kalshi lists trades newest first, so if the page cap or the TRADE_FETCH_SECONDS time cap stops the
    walk it is the oldest trades that are missing; that is logged.
    """
    trades, cursor, deadline = [], None, _clock() + TRADE_FETCH_SECONDS
    for _ in range(MAX_PAGES):
        if cursor and _clock() >= deadline:
            log.warning("kalshi %s: trades fetch out of time after %d trades, oldest not fetched", ticker, len(trades))
            break
        params = {"ticker": ticker, "min_ts": int(min_ts), "limit": 1000}
        if cursor:
            params["cursor"] = cursor
        r = client.get(f"{BASE}/markets/trades", params=params, timeout=TRADE_TIMEOUT)
        r.raise_for_status()
        body = r.json()
        trades.extend(body.get("trades", []))
        cursor = body.get("cursor")
        if not cursor:
            break
    else:
        log.warning("kalshi %s: over %d trades since %d, oldest not fetched", ticker, len(trades), int(min_ts))
    return {"trades": trades}
