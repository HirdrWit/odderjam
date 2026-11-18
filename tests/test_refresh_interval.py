"""odderjam-125: auto-refresh interval picker (backend setting, options and frontend wiring)."""
import json
import os
import re
import shutil
import subprocess
import threading
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend import main, providers
from backend.providers import theoddsapi

FRONTEND = Path(__file__).resolve().parent.parent / "frontend"
SRC = FRONTEND / "src"
CHOICES = [0, 1, 5, 10, 30, 60, 300, 900, 1800, 3600, 7200]


@pytest.fixture
def client(monkeypatch, tmp_path):
    monkeypatch.delenv("ODDS_CACHE_MINUTES", raising=False)
    monkeypatch.delenv("ODDS_API_KEY", raising=False)
    monkeypatch.setattr(theoddsapi, "META", tmp_path / ".odds_meta.json")
    monkeypatch.setattr(providers, "CACHE", tmp_path / "cache.json")
    monkeypatch.setattr(providers, "LIVE_CACHE", tmp_path / "live.json")
    monkeypatch.setattr(providers, "BUDGET_FILE", tmp_path / "budget.json")
    providers.reset_live()
    yield TestClient(main.app)
    providers.reset_live()


def get(c):
    r = c.get("/api/refresh-interval")
    assert r.status_code == 200
    return r.json()


def test_options_list_and_default(client):
    body = get(client)
    assert [o["seconds"] for o in body["options"]] == CHOICES
    assert body["seconds"] == 7200


def test_env_default_when_nothing_saved(client, monkeypatch):
    monkeypatch.setenv("ODDS_CACHE_MINUTES", "30")
    assert get(client)["seconds"] == 1800
    assert providers._ttl() == 1800


def test_put_persists_and_sets_ttl(client):
    r = client.put("/api/refresh-interval", json={"seconds": 300})
    assert r.status_code == 200 and r.json()["seconds"] == 300
    assert get(TestClient(main.app))["seconds"] == 300  # a new client reads the saved row
    assert providers._ttl() == 300


@pytest.mark.parametrize("bad", [7, -5, 3.5, "abc", None, 10 ** 9])
def test_put_rejects_values_outside_the_list(client, bad):
    r = client.put("/api/refresh-interval", json={"seconds": bad})
    assert r.status_code == 422
    assert get(client)["seconds"] == 7200


def test_put_rejects_nan(client):
    r = client.put("/api/refresh-interval", content='{"seconds": NaN}', headers={"content-type": "application/json"})
    assert r.status_code == 422


def test_off_is_saved_and_keeps_the_default_cache_lifetime(client):
    assert client.put("/api/refresh-interval", json={"seconds": 0}).json()["seconds"] == 0
    assert get(client)["seconds"] == 0
    assert providers._ttl() == 7200


def test_get_snapshot_uses_the_chosen_lifetime(client, monkeypatch):
    monkeypatch.setenv("ODDS_API_KEY", "k")
    calls = []
    monkeypatch.setattr(providers, "_fetch", lambda: calls.append(1) or [{"id": "e"}])
    monkeypatch.setattr(providers, "_store", lambda *a, **k: None)
    monkeypatch.setattr(providers, "_fetched", lambda *a, **k: None, raising=False)
    client.put("/api/refresh-interval", json={"seconds": 60})
    providers.get_snapshot(force=True)
    assert len(calls) == 1
    os.utime(providers.CACHE, (time.time() - 30,) * 2)
    providers.get_snapshot()
    assert len(calls) == 1  # 30s old, lifetime 60s
    os.utime(providers.CACHE, (time.time() - 90,) * 2)
    providers.get_snapshot()
    assert len(calls) == 2  # 90s old


def test_cost_per_hour_and_time_left(client, monkeypatch):
    monkeypatch.setattr(theoddsapi, "fetch_cost", lambda: 6)
    monkeypatch.setattr(providers, "cache_info", lambda: {"remaining": "130", "live": True, "prop_markets": []})
    opts = {o["seconds"]: o for o in get(client)["options"]}
    assert opts[30]["credits_per_hour"] == 720
    assert opts[30]["hours_left"] == pytest.approx(130 / 720)
    assert opts[7200]["credits_per_hour"] == 3
    assert opts[0]["credits_per_hour"] == 0 and opts[0]["hours_left"] is None


def test_unknown_remaining_leaves_time_left_empty(client, monkeypatch):
    monkeypatch.setattr(theoddsapi, "fetch_cost", lambda: 6)
    monkeypatch.setattr(providers, "cache_info", lambda: {"live": False, "prop_markets": []})
    opts = {o["seconds"]: o for o in get(client)["options"]}
    assert opts[30]["credits_per_hour"] == 720 and opts[30]["hours_left"] is None


def test_saving_an_interval_leaves_live_settings_alone(client):
    before = client.get("/api/live").json()
    client.put("/api/refresh-interval", json={"seconds": 5})
    after = client.get("/api/live").json()
    for k in ("enabled", "interval_seconds", "credits_per_hour", "max_price_age"):
        assert after[k] == before[k]


def test_parallel_requests_make_one_odds_api_call(client, monkeypatch):
    monkeypatch.setenv("ODDS_API_KEY", "k")
    calls = []

    def slow():
        calls.append(1)
        time.sleep(0.2)
        return [{"id": "e"}]

    monkeypatch.setattr(providers, "_fetch", slow)
    monkeypatch.setattr(providers, "_store", lambda *a, **k: None)
    monkeypatch.setattr(providers, "_fetched", lambda *a, **k: None, raising=False)
    client.put("/api/refresh-interval", json={"seconds": 1})
    ts = [threading.Thread(target=providers.get_snapshot) for _ in range(4)]
    [t.start() for t in ts]
    [t.join() for t in ts]
    assert len(calls) == 1


# --- frontend ---
@pytest.mark.skipif(shutil.which("node") is None, reason="node not installed")
def test_refresh_js():
    r = subprocess.run(["node", "--test", "src/refresh.test.js"], cwd=FRONTEND, capture_output=True, text=True)
    assert r.returncode == 0, r.stdout + r.stderr


def test_hook_polling_uses_the_chosen_interval():
    hooks = (SRC / "hooks.js").read_text()
    assert "./refresh.js" in hooks and "tickAllowed" in hooks and "intervalMs" in hooks
    assert "document.hidden" in hooks or "document.visibilityState" in hooks


def test_settings_dialog_has_the_picker():
    main_src = (SRC / "main.jsx").read_text()
    dialog = main_src[main_src.index("function SettingsDialog"):]
    dialog = dialog[:dialog.index("\n}\n")]
    assert "Auto-refresh" in dialog and "optionText" in dialog and "/api/refresh-interval" in main_src
