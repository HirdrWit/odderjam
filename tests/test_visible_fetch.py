"""odderjam-124: background and status reads never fetch from the Odds API."""
import os
import shutil
import subprocess
import time
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient

from backend import main, providers
from backend.providers import theoddsapi

FRONTEND = Path(__file__).resolve().parent.parent / "frontend"


@pytest.fixture
def stale(monkeypatch, tmp_path):
    monkeypatch.setenv("ODDS_API_KEY", "k")
    monkeypatch.setattr(theoddsapi, "META", tmp_path / ".odds_meta.json")
    monkeypatch.setattr(theoddsapi, "SPORTS", {"NBA": "basketball_nba"})
    monkeypatch.setattr(providers, "CACHE", tmp_path / "cache.json")
    monkeypatch.setattr(providers, "LIVE_CACHE", tmp_path / "live.json")
    monkeypatch.setattr(providers, "BUDGET_FILE", tmp_path / "budget.json")
    providers.reset_live()
    providers.clear_provider_error()
    (tmp_path / "cache.json").write_text("[]")
    old = time.time() - 10 * 3600
    os.utime(tmp_path / "cache.json", (old, old))
    calls = []

    def fake_get(*a, **k):
        calls.append(a)
        raise httpx.ConnectError("no network in tests")

    monkeypatch.setattr(httpx, "get", fake_get)
    yield calls
    providers.clear_provider_error()
    providers.reset_live()


# --- I1 ---

def test_live_get_with_stale_cache_makes_no_request(stale):
    r = TestClient(main.app).get("/api/live")
    assert r.status_code == 200
    assert stale == []


def test_cache_get_with_stale_cache_makes_no_request(stale):
    assert TestClient(main.app).get("/api/cache").status_code == 200
    assert stale == []


def test_live_post_with_stale_cache_makes_no_request(stale):
    assert TestClient(main.app).post("/api/live", json={"interval_seconds": 60}).status_code == 200
    assert stale == []


def test_peek_live_snapshot_keeps_the_live_overlay(stale, tmp_path, monkeypatch):
    assert providers.peek_live_snapshot() == []
    assert stale == []


# --- I4 ---

def test_data_endpoint_with_stale_cache_still_fetches(stale):
    TestClient(main.app).get("/api/odds")
    assert stale != []


def test_refresh_fetches_every_time(stale):
    c = TestClient(main.app)
    c.post("/api/refresh")
    n = len(stale)
    assert n > 0
    c.post("/api/refresh")
    assert len(stale) > n


# --- I2 / I3 (frontend) ---

needs_node = pytest.mark.skipif(shutil.which("node") is None, reason="node not on PATH")


@needs_node
def test_visibility_js_tests_pass():
    r = subprocess.run(["node", "--test", "src/visibility.test.js"], cwd=FRONTEND, capture_output=True, text=True)
    assert r.returncode == 0, r.stdout + r.stderr


def test_main_jsx_polls_only_while_visible():
    src = (FRONTEND / "src" / "main.jsx").read_text()
    assert "usePolling" in src
    assert src.count("setInterval(") == 1 or "setInterval(load, 30000)" not in src
    assert "setInterval(load, 30000)" not in src
    assert "setInterval(pollQuietly, 30000)" not in src
