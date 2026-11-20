"""Live (in-play) odds: live detection, credit budget, stale-price guard, live refresh."""
import json
from datetime import datetime, timezone

import httpx
import pytest
from fastapi.testclient import TestClient

from backend import main, providers
from backend.engine import live
from backend.providers import mock, theoddsapi

NOW = datetime(2026, 11, 15, 20, 0, tzinfo=timezone.utc).timestamp()


def iso(ts: float) -> str:
    return datetime.fromtimestamp(ts, timezone.utc).isoformat()


def event(eid, start, markets, updated=None, sport="NBA", **extra):
    e = {"id": eid, "sport": sport, "home": "A", "away": "B", "start": start, "markets": markets, **extra}
    if updated is not None:
        e["updated"] = updated
    return e


def outcome(name, point, **prices):
    return {"name": name, "point": point, "prices": prices}


# --- AC1: is_live -------------------------------------------------------------------------------

def test_is_live_started_not_completed():
    assert live.is_live(event("1", iso(NOW - 3600), {}), NOW)
    assert live.is_live(event("1", iso(NOW), {}), NOW)  # just started


def test_is_live_future_completed_or_too_old():
    assert not live.is_live(event("1", iso(NOW + 60), {}), NOW)
    assert not live.is_live(event("1", iso(NOW - 600), {}, completed=True), NOW)
    # An NBA game that started 12 hours ago is over even if no completed flag came through.
    assert not live.is_live(event("1", iso(NOW - 12 * 3600), {}), NOW)


def test_is_live_unparsable_start():
    assert not live.is_live(event("1", "t", {}), NOW)
    assert not live.is_live(event("1", None, {}), NOW)


# --- AC2/AC3: budget ----------------------------------------------------------------------------

def test_budget_caps_rolling_hour():
    b = live.Budget(credits_per_hour=10)
    assert b.can_spend(6, NOW)
    b.record(6, NOW)
    assert b.used(NOW) == 6
    assert not b.can_spend(6, NOW + 10)  # 12 > 10
    assert b.can_spend(4, NOW + 10)  # exactly at the cap is allowed
    # The first spend leaves the window an hour later.
    assert b.used(NOW + 3601) == 0
    assert b.can_spend(6, NOW + 3601)


def test_budget_zero_cap_never_spends():
    assert not live.Budget(credits_per_hour=0).can_spend(1, NOW)


def test_budget_next_allowed():
    b = live.Budget(credits_per_hour=10)
    assert b.next_allowed(6, NOW) == 0
    b.record(6, NOW)
    b.record(3, NOW + 600)
    # Need used + 6 <= 10: the 6 at NOW must expire, at NOW + 3600.
    assert b.next_allowed(6, NOW + 1000) == pytest.approx(2600)
    assert b.next_allowed(1, NOW + 1000) == 0
    assert b.next_allowed(11, NOW) is None  # never fits


def test_planned_rate_and_projection():
    assert live.planned_rate(cost=6, interval_seconds=60, credits_per_hour=100) == pytest.approx(100)  # capped
    assert live.planned_rate(cost=6, interval_seconds=600, credits_per_hour=100) == pytest.approx(36)
    assert live.projected_hours(remaining=500, rate=100) == pytest.approx(5)
    assert live.projected_hours(remaining=500, rate=0) is None
    assert live.projected_hours(remaining=None, rate=100) is None


# --- AC4: price age -----------------------------------------------------------------------------

def test_price_age_oldest_of_books():
    updated = {"DraftKings": iso(NOW - 10), "FanDuel": iso(NOW - 90), "BetMGM": iso(NOW - 5000)}
    assert live.price_age(updated, ["DraftKings", "FanDuel"], NOW) == pytest.approx(90)
    assert live.price_age(updated, ["DraftKings"], NOW) == pytest.approx(10)
    assert live.price_age(updated, ["Caesars"], NOW) is None
    assert live.price_age({}, ["DraftKings"], NOW) is None


def test_is_stale_unknown_is_stale():
    assert live.is_stale(None, 60)
    assert live.is_stale(61, 60)
    assert not live.is_stale(60, 60)


# --- AC5: Odds API adapter ----------------------------------------------------------------------

API_EVENT = {
    "id": "e1", "home_team": "A", "away_team": "B", "commence_time": "2026-11-15T19:00:00Z",
    "bookmakers": [
        {"key": "draftkings", "title": "DraftKings", "last_update": "2026-11-15T19:59:30Z",
         "markets": [{"key": "h2h", "outcomes": [{"name": "A", "price": -110}, {"name": "B", "price": -110}]}]},
        {"key": "pinnacle", "title": "Pinnacle", "last_update": "2026-11-15T19:59:50Z",
         "markets": [{"key": "h2h", "outcomes": [{"name": "A", "price": -105}, {"name": "B", "price": -105}]}]},
    ],
}


def test_parse_event_records_last_update():
    e = theoddsapi.parse_event(API_EVENT, "NBA")
    assert e["updated"] == {"DraftKings": "2026-11-15T19:59:30Z", "Pinnacle": "2026-11-15T19:59:50Z"}


def test_live_only_fetch_sends_commence_time_to(monkeypatch, tmp_path):
    calls = []

    def fake_get(url, params, timeout):
        calls.append(params)
        return httpx.Response(200, json=[API_EVENT])

    monkeypatch.setenv("ODDS_API_KEY", "k")
    monkeypatch.setattr(theoddsapi, "META", tmp_path / "meta.json")
    monkeypatch.setattr(theoddsapi, "SPORTS", {"NBA": "basketball_nba"})
    monkeypatch.setattr(theoddsapi.httpx, "get", fake_get)

    theoddsapi.snapshot()
    assert "commenceTimeTo" not in calls[-1]
    events = theoddsapi.snapshot(live_only=True, now=NOW)
    assert calls[-1]["commenceTimeTo"] == "2026-11-15T20:00:00Z"
    assert [e["id"] for e in events] == ["e1"]


def test_fetch_cost(monkeypatch):
    monkeypatch.setattr(theoddsapi, "SPORTS", {"NBA": "x", "NFL": "y"})
    monkeypatch.setattr(theoddsapi, "MARKETS", ["h2h", "spreads", "totals"])
    assert theoddsapi.fetch_cost() == 2 * 1 * 3  # sports x ceil(10 bookmakers / 10) x markets


# --- AC6: provider live refresh -----------------------------------------------------------------

BASE = [event("pre", iso(NOW + 7200), {"moneyline": []}), event("inplay", iso(NOW - 1800), {"moneyline": []}, tag="old")]
LIVE_EVENTS = [event("inplay", iso(NOW - 1800), {"moneyline": []}, tag="new")]


@pytest.fixture
def live_provider(monkeypatch, tmp_path):
    monkeypatch.setenv("ODDS_API_KEY", "k")
    monkeypatch.setattr(providers, "CACHE", tmp_path / "cache.json")
    monkeypatch.setattr(providers, "LIVE_CACHE", tmp_path / "live.json")
    monkeypatch.setattr(providers, "BUDGET_FILE", tmp_path / "budget.json")
    (tmp_path / "cache.json").write_text(json.dumps(BASE))
    fetches = []

    def fake_live():
        fetches.append(1)
        return LIVE_EVENTS

    monkeypatch.setattr(providers, "_fetch", lambda: pytest.fail("pre-game cache is fresh; must not refetch"))
    monkeypatch.setattr(providers, "_fetch_live", fake_live)
    monkeypatch.setattr(providers, "_fetch_cost", lambda: 4)
    providers.reset_live()
    yield fetches
    providers.reset_live()


def test_live_refresh_overlays_and_records(live_provider):
    providers.set_live(enabled=True, interval_seconds=30, credits_per_hour=100)
    snap = providers.get_snapshot(now=NOW)
    assert live_provider == [1]
    by_id = {e["id"]: e for e in snap}
    assert set(by_id) == {"pre", "inplay"}
    assert by_id["inplay"]["tag"] == "new"
    assert providers.budget().used(NOW) == 4
    assert json.loads(providers.BUDGET_FILE.read_text())  # spend survives a restart


def test_live_refresh_respects_budget_and_interval(live_provider):
    providers.set_live(enabled=True, interval_seconds=30, credits_per_hour=8)
    providers.get_snapshot(now=NOW)
    providers.get_snapshot(now=NOW + 10)  # inside the interval
    assert live_provider == [1]
    providers.get_snapshot(now=NOW + 40)
    assert live_provider == [1, 1]
    snap = providers.get_snapshot(now=NOW + 80)  # 4 + 4 + 4 > 8: budget exhausted
    assert live_provider == [1, 1]
    assert {e["id"]: e for e in snap}["inplay"]["tag"] == "new"  # still serves the last live prices


def test_live_refresh_off_never_fetches(live_provider):
    snap = providers.get_snapshot(now=NOW)
    assert live_provider == []
    assert {e["id"]: e for e in snap}["inplay"]["tag"] == "old"


# --- AC7/AC8/AC9: endpoints ---------------------------------------------------------------------

FRESH = {"DraftKings": iso(NOW - 5), "FanDuel": iso(NOW - 10), "Pinnacle": iso(NOW - 5)}
STALE = {"DraftKings": iso(NOW - 300), "FanDuel": iso(NOW - 300), "Pinnacle": iso(NOW - 5)}
ARB_ML = {"moneyline": [outcome("A", None, DraftKings=110, FanDuel=-120, Pinnacle=-105),
                        outcome("B", None, DraftKings=-120, FanDuel=110, Pinnacle=-105)]}
EVENTS = [
    event("live-fresh", iso(NOW - 1800), ARB_ML, FRESH),
    event("live-stale", iso(NOW - 1800), ARB_ML, STALE),
    event("pre-stale", iso(NOW + 7200), ARB_ML, STALE),
]


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(main, "get_snapshot", lambda: EVENTS)
    monkeypatch.setattr(main, "peek_live_snapshot", lambda: EVENTS)
    monkeypatch.setattr(main, "_now", lambda: NOW)
    providers.reset_live()
    yield TestClient(main.app)
    providers.reset_live()


def test_odds_rows_flag_live_and_filter(client):
    rows = client.get("/api/odds").json()
    assert {r["id"]: r["live"] for r in rows} == {"live-fresh": True, "live-stale": True, "pre-stale": False}
    ages = {r["id"]: r["price_age_seconds"] for r in rows}
    assert ages["live-fresh"] == pytest.approx(10)  # oldest US-book price; Pinnacle is not shown
    assert ages["pre-stale"] == pytest.approx(300)
    assert [r["id"] for r in client.get("/api/odds", params={"live": "true"}).json()] == ["live-fresh", "live-stale"]
    assert [r["id"] for r in client.get("/api/odds", params={"live": "false"}).json()] == ["pre-stale"]


TOOLS = ["/api/arbs", "/api/lowhold", "/api/ev"]


def _events(rows):
    return {r["event_id"] for r in rows}


def test_tool_rows_flag_live_and_drop_stale(client):
    providers.set_live(enabled=True, max_price_age=60)
    for url in TOOLS:
        rows = client.get(url, params={"min_ev": -100} if url == "/api/ev" else {"max_hold": 100}).json()
        assert _events(rows) == {"live-fresh", "pre-stale"}, url
        assert all(r["live"] == (r["event_id"] == "live-fresh") for r in rows), url
        assert all(r["price_age_seconds"] is not None for r in rows), url
    arb = next(r for r in client.get("/api/arbs").json() if r["event_id"] == "live-fresh")
    assert arb["price_age_seconds"] == pytest.approx(10)  # oldest of the two legs


def test_middles_rows_flag_live_and_drop_stale(client, monkeypatch):
    totals = {"totals": [outcome("Over", 220.5, DraftKings=-110), outcome("Under", 220.5, DraftKings=-110),
                         outcome("Over", 222.5, FanDuel=-110), outcome("Under", 222.5, FanDuel=-110)]}
    evs = [event("live-fresh", iso(NOW - 1800), totals, FRESH), event("live-stale", iso(NOW - 1800), totals, STALE)]
    monkeypatch.setattr(main, "get_snapshot", lambda: evs)
    providers.set_live(enabled=True, max_price_age=60)
    rows = client.get("/api/middles").json()
    assert rows and _events(rows) == {"live-fresh"}
    assert all(r["live"] for r in rows)


def test_tool_rows_not_dropped_when_live_mode_off(client):
    rows = client.get("/api/arbs").json()
    assert _events(rows) == {"live-fresh", "live-stale", "pre-stale"}


def test_live_endpoint_reports_budget(client, monkeypatch, tmp_path):
    # Isolate the spend ledger: the real .odds_cache.budget.json holds the running server's spend.
    monkeypatch.setattr(providers, "BUDGET_FILE", tmp_path / "budget.json")
    monkeypatch.setattr(providers, "_budget", None)
    monkeypatch.setattr(providers, "_fetch_cost", lambda: 6)
    monkeypatch.setattr(providers, "_remaining", lambda: 500.0)
    monkeypatch.setattr(providers, "_now", lambda: NOW)
    r = client.post("/api/live", json={"enabled": True, "interval_seconds": 60, "credits_per_hour": 100,
                                        "max_price_age": 45})
    assert r.status_code == 200
    providers.budget().record(12, NOW - 100)
    providers.budget().record(6, NOW - 4000)  # outside the hour
    s = client.get("/api/live").json()
    assert s["enabled"] is True
    assert s["interval_seconds"] == 60 and s["credits_per_hour"] == 100 and s["max_price_age"] == 45
    assert s["cost_per_fetch"] == 6
    assert s["used_last_hour"] == pytest.approx(12)
    assert s["planned_rate"] == pytest.approx(100)
    assert s["remaining"] == pytest.approx(500)
    assert s["projected_hours"] == pytest.approx(5)
    assert s["live_events"] == 2


@pytest.mark.parametrize("body", [{"interval_seconds": 0}, {"credits_per_hour": -1}, {"max_price_age": 0},
                                  {"interval_seconds": "fast"}])
def test_live_endpoint_rejects_invalid(client, body):
    assert client.post("/api/live", json=body).status_code == 422
    assert client.get("/api/live").json()["enabled"] is False


# --- AC11: mock data ----------------------------------------------------------------------------

def test_mock_has_live_and_updated():
    events = mock.snapshot(seed=1, now=NOW)
    assert any(live.is_live(e, NOW) for e in events)
    assert any(not live.is_live(e, NOW) for e in events)
    for e in events:
        books = {b for outs in e["markets"].values() for o in outs for b in o["prices"]}
        assert books <= set(e["updated"]), e["id"]
        assert live.price_age(e["updated"], books, NOW) >= 0
