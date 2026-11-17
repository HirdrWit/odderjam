"""Sharp Money: Kalshi trade feed, stored volume by price, polling and the /api/sharp-money view."""
import json
from datetime import datetime, timezone
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient

from backend import main, sharp_money
from backend.engine import ev
from backend.providers import exchanges, kalshi

FIXTURES = Path(__file__).parent / "fixtures"
NOW = datetime(2026, 11, 15, 20, 0, tzinfo=timezone.utc).timestamp()
KALSHI_FEE = {"model": "kalshi", "rate": 0.07}


def iso(ts: float) -> str:
    return datetime.fromtimestamp(ts, timezone.utc).isoformat()


@pytest.fixture(autouse=True)
def _clean(monkeypatch):
    for var in ("SHARP_MONEY_HOURS", "SHARP_MONEY_POLL_SECONDS", "EXCHANGES", "EXCHANGE_FEES"):
        monkeypatch.delenv(var, raising=False)
    sharp_money.reset()
    yield
    sharp_money.reset()


def trade(tid, ago, cents, size):
    return {"trade_id": tid, "ts": NOW - ago, "cents": cents, "size": size}


# AC4 — Kalshi trade feed


def test_kalshi_parse_trades():
    payload = {"trades": [
        {"trade_id": "t1", "ticker": "X", "count_fp": "12.00", "yes_price_dollars": "0.4100",
         "created_time": "2026-11-15T19:50:00Z"},
        {"trade_id": "t2", "ticker": "X", "count": 5, "yes_price": 42, "created_time": "2026-11-15T19:51:00.5Z"},
        {"trade_id": "t3", "ticker": "X", "count": 5, "created_time": "2026-11-15T19:52:00Z"},  # no price
        {"trade_id": "t4", "ticker": "X", "count": "lots", "yes_price": 42, "created_time": "2026-11-15T19:52:00Z"},
        {"ticker": "X", "count": 3, "yes_price": 40, "created_time": "2026-11-15T19:53:00Z"},  # no id
        {"trade_id": "t6", "ticker": "X", "count": 3, "yes_price": 40, "created_time": "yesterday"},
    ]}
    at = datetime(2026, 11, 15, 19, 50, tzinfo=timezone.utc).timestamp()
    assert kalshi.parse_trades(payload) == [
        {"trade_id": "t1", "cents": pytest.approx(41), "size": 12, "ts": at},
        {"trade_id": "t2", "cents": 42, "size": 5, "ts": at + 60.5},
    ]
    assert kalshi.parse_trades({}) == []


def test_kalshi_fetch_trades_paginates():
    seen = []
    pages = {None: {"trades": [{"trade_id": "a"}], "cursor": "c2"},
             "c2": {"trades": [{"trade_id": "b"}], "cursor": ""}}

    def handler(request):
        seen.append(request.url)
        assert request.url.host == "api.elections.kalshi.com"
        assert request.url.path == "/trade-api/v2/markets/trades"
        return httpx.Response(200, json=pages[request.url.params.get("cursor")])

    client = httpx.Client(transport=httpx.MockTransport(handler))
    out = kalshi.fetch_trades("KXNBAGAME-26NOV16BOSLAL-LAL", NOW - 3600.7, client)
    assert out == {"trades": [{"trade_id": "a"}, {"trade_id": "b"}]}
    assert len(seen) == 2
    assert seen[0].params["ticker"] == "KXNBAGAME-26NOV16BOSLAL-LAL"
    assert seen[0].params["min_ts"] == str(int(NOW - 3600.7))
    assert seen[1].params["cursor"] == "c2"


def test_kalshi_quotes_carry_tickers():
    quotes = kalshi.parse(json.loads((FIXTURES / "kalshi_markets.json").read_text()), "NBA", KALSHI_FEE)
    q = next(q for q in quotes if "Boston" in q["prices"])
    assert q["markets"] == {"Los Angeles L": "KXNBAGAME-26NOV16BOSLAL-LAL", "Boston": "KXNBAGAME-26NOV16BOSLAL-BOS"}
    assert all(set(q["markets"]) == set(q["prices"]) for q in quotes)


# AC5 — exchange markets kept on the event


def test_merge_quotes_records_exchange_markets():
    e = {"id": "a", "sport": "NBA", "home": "Los Angeles Lakers", "away": "Boston Celtics",
         "start": "2026-11-17T03:30:00Z", "markets": {}}
    quotes = [{"book": "Kalshi", "sport": "NBA", "start": "2026-11-17T03:30:00+00:00",
               "prices": {"Boston": -161, "Los Angeles L": 150},
               "markets": {"Boston": "T-BOS", "Los Angeles L": "T-LAL"}},
              {"book": "Polymarket", "sport": "NBA", "start": "2026-11-17T03:30:00+00:00",
               "prices": {"Celtics": -150, "Lakers": 140}}]
    (out,) = exchanges.merge_quotes([e], quotes)
    assert out["exchange_markets"] == {"Kalshi": {"Boston Celtics": "T-BOS", "Los Angeles Lakers": "T-LAL"}}
    assert "Kalshi" in exchanges.TRADE_PLATFORMS


# AC6 — stored once, pruned by age


def test_record_dedupes_and_prunes(monkeypatch):
    rows = [trade("t1", 100, 40, 10), trade("t2", 50, 41, 20)]
    assert sharp_money.record("Kalshi", "T-LAL", "a", "Lakers", rows) == 2
    assert sharp_money.record("Kalshi", "T-LAL", "a", "Lakers", rows) == 0
    assert sharp_money.record("Polymarket", "P", "a", "Lakers", [trade("t1", 10, 50, 5)]) == 1  # ids are per book
    got = sharp_money.trades("Kalshi", "a", "Lakers", since=NOW - 1000)
    assert got == [{"ts": NOW - 100, "cents": 40, "size": 10}, {"ts": NOW - 50, "cents": 41, "size": 20}]
    assert sharp_money.trades("Kalshi", "a", "Lakers", since=NOW - 60) == [{"ts": NOW - 50, "cents": 41, "size": 20}]
    assert sharp_money.last_ts("Kalshi", "T-LAL") == NOW - 50

    sharp_money.record("Kalshi", "T-LAL", "a", "Lakers", [trade("old", 25 * 3600, 40, 10)])
    sharp_money.prune(NOW)  # default: keep 24 hours
    assert len(sharp_money.trades("Kalshi", "a", "Lakers", since=0)) == 2
    monkeypatch.setenv("SHARP_MONEY_HOURS", "0.02")  # 72 seconds
    sharp_money.prune(NOW)
    assert sharp_money.trades("Kalshi", "a", "Lakers", since=0) == [{"ts": NOW - 50, "cents": 41, "size": 20}]


# AC7 — polling


def _event(eid, start, markets):
    return {"id": eid, "sport": "NBA", "home": "H", "away": "A", "start": iso(start), "markets": {},
            "exchange_markets": {"Kalshi": markets}}


def test_poll_resumes_and_skips_failures(monkeypatch):
    calls = []

    def fetch_trades(ticker, min_ts, client):
        calls.append((ticker, min_ts))
        if ticker == "BAD":
            raise httpx.ConnectError("down")
        return {"trades": [{"trade_id": f"{ticker}-1", "count": 7, "yes_price": 40,
                            "created_time": iso(NOW - 5)}]}

    monkeypatch.setattr(kalshi, "fetch_trades", fetch_trades)
    sharp_money.record("Kalshi", "RESUME", "e1", "H", [trade("old", 100, 40, 1)])
    events = [_event("e1", NOW + 3600, {"H": "RESUME", "A": "BAD"}),
              _event("e2", NOW - 1800, {"H": "LIVE"}),          # in play: polled
              _event("e3", NOW - 10 * 3600, {"H": "FINISHED"})]  # long over: not polled
    stored = sharp_money.poll(events, client=None, now=NOW, lookback=7200)
    assert stored == 2
    assert dict(calls) == {"RESUME": NOW - 100, "BAD": NOW - 7200, "LIVE": NOW - 7200}
    assert sharp_money.trades("Kalshi", "e2", "H", since=0) == [{"ts": NOW - 5, "cents": 40, "size": 7}]


def test_maybe_poll_throttled(monkeypatch):
    polls = []
    monkeypatch.setattr(sharp_money, "poll", lambda events, client, now, lookback: polls.append(now) or 0)
    events = [_event("e1", NOW + 3600, {"H": "T"})]
    assert sharp_money.maybe_poll([{"id": "x", "start": iso(NOW), "markets": {}}], NOW) is False  # nothing to poll
    assert sharp_money.maybe_poll(events, NOW) is True
    assert sharp_money.maybe_poll(events, NOW + 30) is False
    assert sharp_money.maybe_poll(events, NOW + 61) is True
    monkeypatch.setenv("SHARP_MONEY_POLL_SECONDS", "300")
    assert sharp_money.maybe_poll(events, NOW + 200) is False
    assert polls == [NOW, NOW + 61]


# AC8 — the API


def _snapshot():
    return [{
        "id": "g1", "sport": "NBA", "home": "Los Angeles Lakers", "away": "Boston Celtics", "start": iso(NOW + 3600),
        "markets": {"moneyline": [
            {"name": "Los Angeles Lakers", "point": None,
             "prices": {"Kalshi": 150, "Polymarket": 300, "Pinnacle": 200, "DraftKings": 160, "FanDuel": 120}},
            {"name": "Boston Celtics", "point": None, "prices": {"Kalshi": -170, "DraftKings": -200}},
        ]},
        "exchange_markets": {"Kalshi": {"Los Angeles Lakers": "T-LAL", "Boston Celtics": "T-BOS"}},
    }]


@pytest.fixture
def api(monkeypatch):
    monkeypatch.setattr(main, "get_snapshot", lambda force=False: _snapshot())
    monkeypatch.setattr(main, "_now", lambda: NOW)
    monkeypatch.setattr(kalshi, "fetch_trades", lambda ticker, min_ts, client: {"trades": []})
    return TestClient(main.app)


def test_api_sharp_money_rows(api):
    baseline = [trade(f"b{i}", 900 + i * 600, 38, 10) for i in range(10)]  # 100 contracts over 100 minutes
    burst = [trade("s1", 60, 40, 300), trade("s2", 120, 40, 100)]
    sharp_money.record("Kalshi", "T-LAL", "g1", "Los Angeles Lakers", baseline + burst)
    sharp_money.record("Kalshi", "T-BOS", "g1", "Boston Celtics", baseline)  # steady: no spike
    params = {"window_minutes": 10, "baseline_minutes": 100, "k": 3, "min_volume": 50}
    (row,) = api.get("/api/sharp-money", params=params).json()
    assert row["event_id"] == "g1" and row["event"] == "Boston Celtics @ Los Angeles Lakers"
    assert row["sport"] == "NBA" and row["exchange"] == "Kalshi" and row["market"] == "T-LAL"
    assert row["outcome"] == "Los Angeles Lakers" and row["start"] == iso(NOW + 3600)
    assert row["volume"] == 400 and row["baseline"] == pytest.approx(10)  # 100 contracts over 10 windows
    assert row["ratio"] == pytest.approx(40)
    assert row["vwap_cents"] == pytest.approx(40) and row["fair_prob"] == pytest.approx(0.4)
    assert row["price"] == pytest.approx(150)
    # Exchanges and non-US books are never listed; only books beating the spike price.
    assert row["books"] == [{"book": "DraftKings", "price": 160, "ev_pct": pytest.approx(ev.ev_pct(0.4, 160))}]

    params["min_volume"] = 10_000
    assert api.get("/api/sharp-money", params=params).json() == []


@pytest.mark.parametrize("bad", [
    {"window_minutes": 0}, {"window_minutes": "inf"}, {"baseline_minutes": -1}, {"k": 0}, {"k": "inf"},
    {"min_volume": -1}, {"min_volume": "nan"},
])
def test_api_sharp_money_validation(api, bad):
    assert api.get("/api/sharp-money", params=bad).status_code == 422


# odderjam-78 — is an exchange configured?


def test_api_sharp_money_status_unconfigured(api):
    assert api.get("/api/sharp-money/status").json() == {"configured": False, "exchanges": []}


def test_api_sharp_money_status_configured(api, monkeypatch):
    monkeypatch.setenv("EXCHANGES", "Kalshi, Polymarket")  # Polymarket has no trade feed
    assert api.get("/api/sharp-money/status").json() == {"configured": True, "exchanges": ["Kalshi"]}
