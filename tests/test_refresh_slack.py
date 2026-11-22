"""odderjam-126: a poll tick at the chosen interval must count as stale (cache age within slack of the TTL)."""
import os
import time

import pytest
from fastapi.testclient import TestClient

from backend import main, providers
from backend.providers import theoddsapi


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
    c = TestClient(main.app)
    yield c, calls
    providers.reset_live()


def age(seconds):
    os.utime(providers.CACHE, (time.time() - seconds,) * 2)


@pytest.mark.parametrize("choice", [5, 30, 60])
def test_tick_just_before_the_lifetime_ends_refetches(client, choice):  # I1, I2
    c, calls = client
    c.put("/api/refresh-interval", json={"seconds": choice})
    providers.get_snapshot(force=True)
    age(choice - 0.05)  # tick lands a few ms early
    providers.get_snapshot()
    assert len(calls) == 2


@pytest.mark.parametrize("choice", [5, 30, 60])
def test_clearly_fresh_cache_is_still_served(client, choice):
    c, calls = client
    c.put("/api/refresh-interval", json={"seconds": choice})
    providers.get_snapshot(force=True)
    age(choice / 2)
    providers.get_snapshot()
    assert len(calls) == 1


def test_default_lifetime_unchanged(client):  # nothing saved: 120m
    c, calls = client
    providers.get_snapshot(force=True)
    age(7200 - 600)
    providers.get_snapshot()
    assert len(calls) == 1
