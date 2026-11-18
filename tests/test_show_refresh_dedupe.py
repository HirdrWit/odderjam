"""odderjam-127: a tab shown during a cold-cache fetch must not trigger a second fetch."""
import json
import os
import threading
import time

import pytest
from fastapi.testclient import TestClient

from backend import main, providers


@pytest.fixture
def env(monkeypatch, tmp_path):
    monkeypatch.setenv("ODDS_API_KEY", "k")
    monkeypatch.setattr(providers, "CACHE", tmp_path / "cache.json")
    monkeypatch.setattr(providers, "LIVE_CACHE", tmp_path / "live.json")
    monkeypatch.setattr(providers, "BUDGET_FILE", tmp_path / "budget.json")
    providers.reset_live()
    providers.clear_provider_error()
    calls = []
    started = threading.Event()

    def fake_fetch():
        calls.append(1)
        started.set()
        time.sleep(0.4)
        return [{"id": "e", "n": len(calls)}]

    monkeypatch.setattr(providers, "_fetch", fake_fetch)
    yield tmp_path, calls, started
    providers.reset_live()
    providers.clear_provider_error()


def _make_stale(tmp_path):
    (tmp_path / "cache.json").write_text("[]")
    old = time.time() - 10 * 3600
    os.utime(tmp_path / "cache.json", (old, old))


def test_show_refresh_during_cold_fetch_fetches_once(env):  # I1
    tmp_path, calls, started = env
    _make_stale(tmp_path)
    t = threading.Thread(target=providers.get_snapshot)
    t.start()
    assert started.wait(2)
    r = TestClient(main.app).post("/api/refresh?on_show=true")
    t.join()
    assert r.status_code == 200
    assert len(calls) == 1


def test_show_refresh_with_stale_cache_fetches_once(env):  # I2
    tmp_path, calls, _ = env
    _make_stale(tmp_path)
    assert TestClient(main.app).post("/api/refresh?on_show=true").status_code == 200
    assert len(calls) == 1


def test_plain_refresh_always_fetches(env):  # I3
    tmp_path, calls, _ = env
    _make_stale(tmp_path)
    t = threading.Thread(target=providers.get_snapshot)
    t.start()
    assert env[2].wait(2)
    TestClient(main.app).post("/api/refresh")
    t.join()
    assert len(calls) == 2
    TestClient(main.app).post("/api/refresh")
    assert len(calls) == 3


def test_frontend_show_refresh_sends_on_show():
    src = (main.Path(__file__).parent.parent / "frontend/src/main.jsx").read_text() if hasattr(main, "Path") else \
        __import__("pathlib").Path(__file__).resolve().parent.parent.joinpath("frontend/src/main.jsx").read_text()
    assert "/api/refresh?on_show=true" in src
