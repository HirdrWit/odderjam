"""Live mode edge cases: failed live fetches, ended games in the live cache, non-finite settings, untimed legs."""
import json
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient

from backend import main, providers

NOW = datetime(2026, 11, 15, 20, 0, tzinfo=timezone.utc).timestamp()


def iso(ts: float) -> str:
    return datetime.fromtimestamp(ts, timezone.utc).isoformat()


ARB_ML = {"moneyline": [{"name": "A", "point": None, "prices": {"DraftKings": 110, "FanDuel": -120}},
                        {"name": "B", "point": None, "prices": {"DraftKings": -120, "FanDuel": 110}}]}


def event(eid, start, updated):
    return {"id": eid, "sport": "NBA", "home": "A", "away": "B", "start": start, "markets": ARB_ML,
            "updated": updated}


@pytest.fixture
def provider(monkeypatch, tmp_path):
    monkeypatch.setenv("ODDS_API_KEY", "k")
    monkeypatch.setattr(providers, "CACHE", tmp_path / "cache.json")
    monkeypatch.setattr(providers, "LIVE_CACHE", tmp_path / "live.json")
    monkeypatch.setattr(providers, "BUDGET_FILE", tmp_path / "budget.json")
    monkeypatch.setattr(providers, "_fetch_cost", lambda: 4)
    monkeypatch.setattr(providers, "_fetch", lambda: pytest.fail("pre-game cache is fresh; must not refetch"))
    (tmp_path / "cache.json").write_text("[]")
    providers.reset_live()
    yield tmp_path
    providers.reset_live()


def test_failed_live_fetch_counts_and_waits_for_interval(provider, monkeypatch):
    calls = []

    def boom():
        calls.append(1)
        raise TimeoutError

    monkeypatch.setattr(providers, "_fetch_live", boom)
    providers.set_live(enabled=True, interval_seconds=30, credits_per_hour=100)
    for dt in (0, 1, 2, 3):
        providers.get_snapshot(now=NOW + dt)
    assert calls == [1]  # not retried on every request
    assert providers.budget().used(NOW + 3) == 4  # a partly-sent fetch may already have been charged


def test_ended_game_in_live_cache_is_not_served(provider, monkeypatch):
    ended = event("g", iso(NOW - 6 * 3600), {"DraftKings": iso(NOW - 3 * 3600), "FanDuel": iso(NOW - 3 * 3600)})
    (provider / "live.json").write_text(json.dumps([ended]))
    monkeypatch.setattr(providers, "_fetch_live", lambda: pytest.fail("budget exhausted; must not fetch"))
    providers.set_live(enabled=True, credits_per_hour=0)
    assert providers.get_snapshot(now=NOW) == []


@pytest.fixture
def client(monkeypatch, tmp_path):
    monkeypatch.setattr(providers, "BUDGET_FILE", tmp_path / "budget.json")
    monkeypatch.setattr(main, "_now", lambda: NOW)
    providers.reset_live()
    yield TestClient(main.app)
    providers.reset_live()


def test_live_settings_reject_non_finite(client):
    r = client.post("/api/live", content='{"credits_per_hour": 1e999}', headers={"Content-Type": "application/json"})
    assert r.status_code == 422
    assert client.get("/api/live").status_code == 200


def test_live_row_with_untimed_leg_is_stale(client, monkeypatch):
    # FanDuel has no timestamp: the arb's age is unknown, so live mode must hide it.
    e = event("g", iso(NOW - 1800), {"DraftKings": iso(NOW - 5)})
    monkeypatch.setattr(main, "get_snapshot", lambda: [e])
    assert client.get("/api/arbs").json()[0]["price_age_seconds"] is None
    providers.set_live(enabled=True, max_price_age=60)
    assert client.get("/api/arbs").json() == []
