"""Graceful failures (odderjam-112): bad input is a 4xx, upstream failures are reported, not hidden."""
import json
from datetime import datetime, timezone

import httpx
import pytest
from fastapi.testclient import TestClient

from backend import alerts, main, providers
from backend.providers import theoddsapi

client = TestClient(main.app, raise_server_exceptions=False)
BOOK = "DraftKings"


@pytest.mark.parametrize("qs", [
    "amount=nan", "amount=inf", "amount=1e308", "amount=0", "amount=-5",
    "boost_pct=-200", "boost_pct=nan", "boost_pct=1e308",
    "max_boost=nan", "max_boost=-1", "refund_value=nan", "refund_value=-1", "refund_value=1e308",
    "limit=-3", "limit=0", "limit=100000",
])
def test_promo_rejects_bad_numbers(qs):
    r = client.get(f"/api/promo/profit-boost?book={BOOK}&{qs}")
    assert r.status_code == 422, (qs, r.status_code, r.text[:80])


def test_promo_accepts_sane_values():
    r = client.get(f"/api/promo/profit-boost?book={BOOK}&amount=50&boost_pct=30&max_boost=100&limit=5")
    assert r.status_code == 200


@pytest.mark.parametrize("qs", ["kelly=1e308", "kelly=1.5", "kelly=nan"])
def test_ev_kelly_capped_at_one(qs):
    assert client.get(f"/api/ev?{qs}").status_code == 422


def test_ev_kelly_one_is_fine():
    assert client.get("/api/ev?kelly=1").status_code == 200


@pytest.mark.parametrize("qs", ["min_window=nan", "max_cost=nan", "min_window=inf", "min_window=-1"])
def test_middles_rejects_non_finite(qs):
    assert client.get(f"/api/middles?{qs}").status_code == 422


def test_center_of_empty_market_is_none():
    assert main._center("totals", [], "Home") is None


def test_middles_skips_market_with_no_lines(monkeypatch):
    monkeypatch.setattr(main, "_unsuspect_outcomes", lambda key, e: [])
    assert client.get("/api/middles").status_code == 200


def test_csv_import_bad_event_start_is_a_row_error():
    body = ("pick,market,odds,stake,book,event_start\n"
            "Lakers ML,moneyline,110,10,DraftKings,not-a-date\n"
            "Celtics ML,moneyline,120,10,DraftKings,\n")
    r = client.post("/api/bets/import", json={"csv": body})
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["imported"] == 1
    assert [e["line"] for e in out["errors"]] == [2]
    assert "event_start" in out["errors"][0]["error"]


def test_add_bet_bad_event_start_is_422():
    r = client.post("/api/bets", json={"pick": "A", "market": "moneyline", "odds": 110, "stake": 5,
                                       "book": "DraftKings", "event_start": "garbage"})
    assert r.status_code == 422


def _settle_setup(monkeypatch, exc):
    client.post("/api/bets", json={"pick": "Lakers ML", "market": "moneyline", "odds": 110, "stake": 5,
                                   "book": "DraftKings", "sport": "NBA"})

    def boom(sports):
        raise exc
    monkeypatch.setattr(providers, "get_scores", boom)


@pytest.mark.parametrize("exc", [
    providers.ProviderError("out of credits", status=401),
    providers.ProviderError("rate limited", status=429),
    httpx.ConnectTimeout("slow"),
    httpx.ConnectError("down"),
])
def test_settle_reports_provider_failure(monkeypatch, exc):
    _settle_setup(monkeypatch, exc)
    r = client.post("/api/bets/settle")
    assert r.status_code == 502, r.text
    assert "odds provider" in r.json()["detail"]


class Resp:
    def __init__(self, status, payload=None, headers=None):
        self.status_code, self._p, self.headers = status, payload or [], headers or {}

    def json(self):
        return self._p


@pytest.fixture
def api(monkeypatch, tmp_path):
    monkeypatch.setenv("ODDS_API_KEY", "k")
    monkeypatch.setattr(theoddsapi, "META", tmp_path / "meta.json")
    monkeypatch.setattr(providers, "CACHE", tmp_path / "cache.json")
    monkeypatch.setattr(providers, "LIVE_CACHE", tmp_path / "live.json")
    providers.reset_live()
    providers.clear_provider_error()
    yield tmp_path
    providers.clear_provider_error()


def test_scores_non_200_raises_provider_error(api, monkeypatch):
    monkeypatch.setattr(httpx, "get", lambda *a, **k: Resp(429))
    with pytest.raises(providers.ProviderError) as e:
        theoddsapi.scores(["NBA"])
    assert e.value.status == 429


def test_snapshot_failure_is_recorded_with_no_cache_and_does_not_500(api, monkeypatch):
    monkeypatch.setattr(httpx, "get", lambda *a, **k: Resp(401))
    assert providers.get_snapshot() == []
    err = providers.cache_info()["provider_error"]
    assert err["status"] == 401 and err["at"]


def test_network_error_with_no_cache_does_not_500(api, monkeypatch):
    def down(*a, **k):
        raise httpx.ConnectError("down")
    monkeypatch.setattr(httpx, "get", down)
    assert providers.get_snapshot() == []
    assert providers.cache_info()["provider_error"]["status"] is None


def test_failures_back_off_instead_of_calling_every_poll(api, monkeypatch):
    calls = []

    def fail(*a, **k):
        calls.append(1)
        return Resp(429)
    monkeypatch.setattr(httpx, "get", fail)
    providers.get_snapshot()
    n = len(calls)
    providers.get_snapshot()
    providers.get_snapshot()
    assert len(calls) == n


def test_stale_cache_served_but_error_reported(api, monkeypatch):
    (api / "cache.json").write_text("[]")
    monkeypatch.setattr(providers, "_ttl", lambda: 0)
    monkeypatch.setattr(httpx, "get", lambda *a, **k: Resp(401))
    providers.get_snapshot()
    assert providers.cache_info()["provider_error"]["status"] == 401


def test_success_clears_provider_error(api, monkeypatch):
    providers.record_provider_error(401)
    monkeypatch.setattr(providers, "_fetch", lambda: [])
    providers.clear_provider_error()
    assert "provider_error" not in providers.cache_info()


def test_cache_info_tolerates_truncated_meta(api, monkeypatch):
    (api / ".odds_meta.json").write_text('{"remaining": "12')
    monkeypatch.setattr(providers, "CACHE", api / "cache.json")
    info = providers.cache_info()
    assert info["live"] is True
    assert client.get("/api/cache").status_code == 200


def test_meta_written_atomically(api, monkeypatch):
    monkeypatch.setattr(theoddsapi, "META", api / ".odds_meta.json")
    monkeypatch.setattr(httpx, "get", lambda *a, **k: Resp(200, [], {"x-requests-remaining": "9"}))
    theoddsapi._get("http://x", {})
    assert json.loads((api / ".odds_meta.json").read_text())["remaining"] == "9"
    assert [p.name for p in api.iterdir() if p.name.endswith(".tmp")] == []


def test_add_alert_survives_evaluation_failure(monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("webhook exploded")
    monkeypatch.setattr(alerts, "evaluate", boom)
    r = client.post("/api/alerts/rules", json={"kind": "ev", "min_value": 3})
    assert r.status_code == 200, r.text
    assert len(client.get("/api/alerts/rules").json()) == 1


def test_partial_provider_failure_is_reported(api, monkeypatch):
    calls = []

    def mixed(url, params=None, **k):
        calls.append(url)
        if len(calls) == 1:
            return Resp(429)
        return Resp(200, [{"id": "e"}])
    monkeypatch.setattr(httpx, "get", mixed)
    monkeypatch.setattr(theoddsapi, "parse_event", lambda e, s: {"id": e["id"], "markets": {}})
    monkeypatch.setattr(theoddsapi, "SPORTS", {"NBA": "a", "NFL": "b"})
    monkeypatch.setattr(theoddsapi, "props_for", lambda s: [])
    monkeypatch.setattr(providers, "_fetch", theoddsapi.snapshot)
    providers.get_snapshot(force=True)
    assert providers.cache_info()["provider_error"]["status"] == 429
