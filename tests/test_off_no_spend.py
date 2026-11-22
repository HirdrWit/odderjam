"""odderjam-141: with auto-refresh Off no background read spends Odds API credits."""
import os
import time

import pytest
from fastapi.testclient import TestClient

from backend import main, providers, refresh
from backend.providers import theoddsapi

DAY = 86400
ROUTES = ["/api/odds", "/api/ev", "/api/arbs", "/api/lowhold", "/api/middles", "/api/sharp-money"]


@pytest.fixture
def client(monkeypatch, tmp_path):
    monkeypatch.delenv("ODDS_CACHE_MINUTES", raising=False)
    monkeypatch.setenv("ODDS_API_KEY", "k")
    monkeypatch.setattr(theoddsapi, "META", tmp_path / ".odds_meta.json")
    monkeypatch.setattr(providers, "CACHE", tmp_path / "cache.json")
    monkeypatch.setattr(providers, "LIVE_CACHE", tmp_path / "live.json")
    monkeypatch.setattr(providers, "BUDGET_FILE", tmp_path / "budget.json")
    providers.reset_live()
    calls = []
    monkeypatch.setattr(providers, "_fetch", lambda: calls.append(1) or [{"id": "e"}])
    monkeypatch.setattr(providers, "_store", lambda *a, **k: None)
    monkeypatch.setattr(providers, "_fetched", lambda *a, **k: None, raising=False)
    c = TestClient(main.app, raise_server_exceptions=False)
    yield c, calls
    providers.reset_live()


def age(seconds):
    os.utime(providers.CACHE, (time.time() - seconds,) * 2)


def seeded(client, choice):
    c, calls = client
    c.put("/api/refresh-interval", json={"seconds": choice})
    providers.get_snapshot(force=True)
    calls.clear()
    return c, calls


@pytest.mark.parametrize("route", ROUTES)
def test_off_read_routes_never_fetch_a_stale_cache(client, route):  # I1
    c, calls = seeded(client, 0)
    age(30 * DAY)
    for _ in range(3):
        c.get(route)
    assert calls == []


def test_off_serves_the_stale_snapshot(client):  # I1
    c, calls = seeded(client, 0)
    age(30 * DAY)
    assert providers.get_snapshot() == [{"id": "e"}]
    assert calls == []


def test_off_refresh_button_still_fetches_once(client):  # I2
    c, calls = seeded(client, 0)
    age(30 * DAY)
    assert c.post("/api/refresh").status_code == 200
    assert len(calls) == 1


def test_off_on_show_refresh_does_not_fetch(client):  # I3
    c, calls = seeded(client, 0)
    age(30 * DAY)
    assert c.post("/api/refresh?on_show=true").status_code == 200
    assert calls == []


def test_off_cache_info_reports_no_ttl(client):  # I3
    c, _ = seeded(client, 0)
    assert c.get("/api/cache").json()["ttl_seconds"] is None


def test_off_with_no_cache_file_fetches_once(client):  # I4
    c, calls = client
    c.put("/api/refresh-interval", json={"seconds": 0})
    providers.get_snapshot()
    providers.get_snapshot()
    assert len(calls) == 1


def test_timed_choice_still_refetches_stale_cache(client):  # I5
    c, calls = seeded(client, 7200)
    age(7300)
    providers.get_snapshot()
    assert len(calls) == 1


def test_timed_cache_info_keeps_numeric_ttl(client):  # I5
    c, _ = seeded(client, 300)
    assert c.get("/api/cache").json()["ttl_seconds"] == 300


def test_off_24h_of_polling_makes_no_fetch(client, monkeypatch):  # I6
    c, calls = seeded(client, 0)
    start = time.time()
    clock = {"now": start}
    monkeypatch.setattr(time, "time", lambda: clock["now"])
    for _ in range(DAY // 30):
        clock["now"] += 30
        c.get("/api/ev")
        c.get("/api/cache")
    assert calls == []


def test_off_lifetime_is_none_and_docs_do_not_keep_default():  # I7
    assert refresh.cache_lifetime.__doc__ and "keeps the default" not in refresh.cache_lifetime.__doc__
    assert "keeps the default" not in (refresh.__doc__ or "")
