"""odderjam-123: credits left in the strip, and the real cost of each live fetch in the budget."""
import json
import re
import shutil
import subprocess
from datetime import datetime, timezone
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient

from backend import main, providers
from backend.providers import theoddsapi

NOW = datetime(2026, 11, 15, 20, 0, tzinfo=timezone.utc).timestamp()
FRONTEND = Path(__file__).resolve().parent.parent / "frontend"


class Resp:
    def __init__(self, headers=None, payload=None, status=200):
        self.status_code, self.headers, self._p = status, headers or {}, payload or []

    def json(self):
        return self._p


def hdr(remaining, used, last):
    return {"x-requests-remaining": str(remaining), "x-requests-used": str(used), "x-requests-last": str(last)}


@pytest.fixture
def api(monkeypatch, tmp_path):
    monkeypatch.setenv("ODDS_API_KEY", "k")
    monkeypatch.setattr(theoddsapi, "META", tmp_path / ".odds_meta.json")
    monkeypatch.setattr(theoddsapi, "SPORTS", {"NBA": "basketball_nba", "NFL": "americanfootball_nfl"})
    monkeypatch.setattr(providers, "CACHE", tmp_path / "cache.json")
    monkeypatch.setattr(providers, "LIVE_CACHE", tmp_path / "live.json")
    monkeypatch.setattr(providers, "BUDGET_FILE", tmp_path / "budget.json")
    providers.reset_live()
    yield tmp_path
    providers.reset_live()


def respond(monkeypatch, headers_per_call):
    calls = iter(headers_per_call)
    monkeypatch.setattr(httpx, "get", lambda *a, **k: Resp(next(calls)))


# --- I1 ---

def test_cache_info_returns_remaining_used_and_last_cost(api, monkeypatch):
    respond(monkeypatch, [hdr(134, 66, 3), hdr(131, 69, 3)])
    theoddsapi.snapshot(live_only=True, now=NOW)
    info = providers.cache_info()
    assert float(info["remaining"]) == 131
    assert float(info["used"]) == 69
    assert float(info["last_cost"]) == 3


# --- I3 ---

def test_snapshot_sums_last_cost_across_calls(api, monkeypatch):
    respond(monkeypatch, [hdr(100, 1, 3), hdr(96, 5, 4)])
    theoddsapi.snapshot(live_only=True, now=NOW)
    assert theoddsapi.last_fetch_cost() == 7


def test_last_fetch_cost_starts_over_each_fetch(api, monkeypatch):
    respond(monkeypatch, [hdr(100, 1, 3), hdr(97, 4, 3), hdr(97, 4, 0), hdr(97, 4, 0)])
    theoddsapi.snapshot(live_only=True, now=NOW)
    theoddsapi.snapshot(live_only=True, now=NOW)
    assert theoddsapi.last_fetch_cost() == 0


def test_last_fetch_cost_unknown_without_headers(api, monkeypatch):
    respond(monkeypatch, [{}, {}])
    theoddsapi.snapshot(live_only=True, now=NOW)
    assert theoddsapi.last_fetch_cost() is None


def live_with(monkeypatch, real, fetch=lambda: []):
    monkeypatch.setattr(providers, "_fetch", lambda: [])
    monkeypatch.setattr(providers, "_fetch_live", fetch)
    monkeypatch.setattr(providers, "_fetch_cost", lambda: 4)
    monkeypatch.setattr(providers, "_real_cost", lambda: real)
    providers.set_live(enabled=True, interval_seconds=30, credits_per_hour=100)


def test_zero_cost_live_fetch_adds_nothing_to_budget(api, monkeypatch):
    live_with(monkeypatch, 0)
    providers.get_snapshot(now=NOW)
    assert providers.budget().used(NOW) == 0
    assert json.loads(providers.BUDGET_FILE.read_text())[0][1] == 0  # the correction is persisted


def test_real_cost_replaces_the_estimate(api, monkeypatch):
    live_with(monkeypatch, 2)
    providers.get_snapshot(now=NOW)
    assert providers.budget().used(NOW) == 2


def test_zero_cost_fetch_still_waits_for_the_interval(api, monkeypatch):
    calls = []
    live_with(monkeypatch, 0, lambda: calls.append(1) or [])
    for dt in (0, 1, 2):
        providers.get_snapshot(now=NOW + dt)
    assert calls == [1]


def test_unknown_real_cost_keeps_the_estimate(api, monkeypatch):
    live_with(monkeypatch, None)
    providers.get_snapshot(now=NOW)
    assert providers.budget().used(NOW) == 4


# --- I4 ---

def test_failing_fetch_counts_toward_interval_and_keeps_estimate(api, monkeypatch):
    calls = []

    def boom():
        calls.append(1)
        raise TimeoutError

    live_with(monkeypatch, None, boom)
    for dt in (0, 1, 2):
        providers.get_snapshot(now=NOW + dt)
    assert calls == [1]
    assert providers.budget().used(NOW + 2) == 4


def test_failing_fetch_records_the_partial_real_cost(api, monkeypatch):
    def boom():
        raise TimeoutError

    live_with(monkeypatch, 3, boom)
    providers.get_snapshot(now=NOW)
    assert providers.budget().used(NOW) == 3


# --- I5 ---

def test_refresh_endpoint_fetches_every_time(api, monkeypatch):
    fetches = []
    monkeypatch.setattr(providers, "_live", lambda: True)
    monkeypatch.setattr(providers, "_fetch", lambda: fetches.append(1) or [])
    client = TestClient(main.app)
    for _ in range(3):
        assert client.post("/api/refresh").status_code == 200
    assert len(fetches) == 3


# --- I2 ---

@pytest.mark.skipif(shutil.which("node") is None, reason="node not installed")
def test_credits_js():
    r = subprocess.run(["node", "--test", "src/credits.test.js"], cwd=FRONTEND, capture_output=True, text=True)
    assert r.returncode == 0, r.stdout + r.stderr


def test_strip_renders_credits_text():
    main_jsx = (FRONTEND / "src" / "main.jsx").read_text()
    strip = main_jsx[main_jsx.index("function FreshnessStrip"):main_jsx.index("/**\n * \"Bet\" button")]
    assert re.search(r"creditsText\(info\)", strip)
    assert "creditsText" in re.search(r"import \{[^}]*\} from './freshness.js'", main_jsx).group(0)
