"""Sharp Money review fixes: taker direction, poll time budget, baseline within retention."""
from datetime import datetime, timezone

import httpx
import pytest
from fastapi.testclient import TestClient

from backend import main, sharp_money
from backend.providers import kalshi

NOW = datetime(2026, 11, 15, 20, 0, tzinfo=timezone.utc).timestamp()


def iso(ts: float) -> str:
    return datetime.fromtimestamp(ts, timezone.utc).isoformat()


@pytest.fixture(autouse=True)
def _clean(monkeypatch):
    for var in ("SHARP_MONEY_HOURS", "SHARP_MONEY_POLL_SECONDS", "SHARP_MONEY_POLL_BUDGET"):
        monkeypatch.delenv(var, raising=False)
    sharp_money.reset()
    yield
    sharp_money.reset()


def _event(eid, markets):
    return {"id": eid, "sport": "NBA", "home": "H", "away": "A", "start": iso(NOW + 3600), "markets": {},
            "exchange_markets": {"Kalshi": markets}}


def test_parse_trades_marks_no_takers():
    payload = {"trades": [
        {"trade_id": "y", "count": 1, "yes_price": 30, "taker_side": "yes", "created_time": iso(NOW)},
        {"trade_id": "n", "count": 2, "yes_price": 30, "taker_side": "no", "created_time": iso(NOW)},
    ]}
    yes, no = kalshi.parse_trades(payload)
    assert "taker" not in yes and no["taker"] == "no" and no["cents"] == 30


def test_no_taker_volume_backs_the_other_side(monkeypatch):
    """Buying NO on H's market is money on A: it must not show as a spike on H at H's YES price."""
    monkeypatch.setattr(kalshi, "fetch_trades", lambda ticker, min_ts, client: {"trades": [
        {"trade_id": f"{ticker}-n", "count": 500, "yes_price": 30, "taker_side": "no", "created_time": iso(NOW - 5)},
        {"trade_id": f"{ticker}-y", "count": 10, "yes_price": 30, "taker_side": "yes", "created_time": iso(NOW - 5)},
    ]} if ticker == "T-H" else {"trades": []})
    sharp_money.poll([_event("e1", {"H": "T-H", "A": "T-A"})], client=None, now=NOW, lookback=3600)
    assert sharp_money.trades("Kalshi", "e1", "A", since=0) == [{"ts": NOW - 5, "cents": 70, "size": 500}]
    assert sharp_money.trades("Kalshi", "e1", "H", since=0) == [{"ts": NOW - 5, "cents": 30, "size": 10}]


def test_no_taker_dropped_without_a_known_other_side(monkeypatch):
    monkeypatch.setattr(kalshi, "fetch_trades", lambda ticker, min_ts, client: {"trades": [
        {"trade_id": "n", "count": 5, "yes_price": 30, "taker_side": "no", "created_time": iso(NOW - 5)}]})
    assert sharp_money.poll([_event("e1", {"H": "T-H"})], client=None, now=NOW, lookback=3600) == 0


def test_poll_stops_at_its_time_budget(monkeypatch):
    ticks = iter([0.0, 1.0, 20.0, 30.0])  # deadline 15s: first market polled, then out of time
    monkeypatch.setattr(sharp_money, "_clock", lambda: next(ticks))
    seen = []
    monkeypatch.setattr(kalshi, "fetch_trades", lambda ticker, min_ts, client: seen.append(ticker) or {"trades": []})
    sharp_money.poll([_event("e1", {"H": "T-H", "A": "T-A"})], client=None, now=NOW, lookback=3600)
    assert seen == ["T-H"]


def test_api_rejects_baseline_beyond_retention(monkeypatch):
    monkeypatch.setattr(main, "get_snapshot", lambda force=False: [])
    c = TestClient(main.app)
    assert c.get("/api/sharp-money", params={"window_minutes": 10, "baseline_minutes": 24 * 60}).status_code == 422
    assert c.get("/api/sharp-money", params={"window_minutes": 10, "baseline_minutes": 23 * 60}).status_code == 200
    monkeypatch.setenv("SHARP_MONEY_HOURS", "48")
    assert c.get("/api/sharp-money", params={"window_minutes": 10, "baseline_minutes": 24 * 60}).status_code == 200


def test_fetch_trades_stops_paging_at_its_time_cap(monkeypatch):
    ticks = iter([0.0, 4.0, 11.0, 12.0])  # cap 10s: start, page 2 allowed at 4s, page 3 refused at 11s
    monkeypatch.setattr(kalshi, "_clock", lambda: next(ticks))
    pages = []

    def handler(request):
        pages.append(request.url.params.get("cursor"))
        return httpx.Response(200, json={"trades": [{"trade_id": str(len(pages))}], "cursor": f"c{len(pages)}"})

    out = kalshi.fetch_trades("T", NOW - 60, httpx.Client(transport=httpx.MockTransport(handler)))
    assert pages == [None, "c1"] and len(out["trades"]) == 2
