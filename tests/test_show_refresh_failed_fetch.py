"""odderjam-127 review: a show-refresh queued behind a failing fetch must not fetch again."""
import os
import threading
import time

from fastapi.testclient import TestClient

from backend import main, providers


def test_show_refresh_after_failed_inflight_fetch_does_not_refetch(monkeypatch, tmp_path):
    monkeypatch.setenv("ODDS_API_KEY", "k")
    monkeypatch.setattr(providers, "CACHE", tmp_path / "cache.json")
    monkeypatch.setattr(providers, "LIVE_CACHE", tmp_path / "live.json")
    monkeypatch.setattr(providers, "BUDGET_FILE", tmp_path / "budget.json")
    providers.reset_live()
    providers.clear_provider_error()
    (tmp_path / "cache.json").write_text("[]")
    old = time.time() - 10 * 3600
    os.utime(tmp_path / "cache.json", (old, old))
    calls, started = [], threading.Event()

    def failing():
        calls.append(1)
        started.set()
        time.sleep(0.4)
        raise RuntimeError("429")

    monkeypatch.setattr(providers, "_fetch", failing)
    try:
        t = threading.Thread(target=providers.get_snapshot)
        t.start()
        assert started.wait(2)
        assert TestClient(main.app).post("/api/refresh?on_show=true").status_code == 200
        t.join()
        assert len(calls) == 1
    finally:
        providers.clear_provider_error()
        providers.reset_live()
