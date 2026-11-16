"""odderjam-39: out-of-range numeric query params on the analytics endpoints return 422, not 200."""
import pytest
from fastapi.testclient import TestClient

from backend import main
from backend.providers import mock

NON_FINITE = ["nan", "inf", "-inf"]


@pytest.fixture
def client(monkeypatch):  # conftest gives each test its own DB
    monkeypatch.setattr(main, "get_snapshot", lambda: mock.snapshot(seed=1))
    return TestClient(main.app)


def _rejected(client, url, params, name):
    r = client.get(url, params=params)
    assert r.status_code == 422, (params, r.status_code, r.text[:200])
    assert any(name in str(e.get("loc", "")) or name in e.get("msg", "") for e in r.json()["detail"]), r.text
    return r


@pytest.mark.parametrize("total", ["0", "-50", *NON_FINITE])
def test_arbs_rejects_bad_total(client, total):
    _rejected(client, "/api/arbs", {"total": total}, "total")


def test_arbs_without_total_uses_bankroll(client):
    client.put("/api/bankroll", json={"starting": 1000})
    rows = client.get("/api/arbs", params={"min_profit": -100, "round_to": 0}).json()
    assert rows and all(r["total_stake"] == pytest.approx(1000, abs=0.05) for r in rows)


@pytest.mark.parametrize("url", ["/api/arbs", "/api/ev"])
@pytest.mark.parametrize("value", ["-1", *NON_FINITE])
def test_rejects_bad_round_to(client, url, value):
    _rejected(client, url, {"round_to": value}, "round_to")


@pytest.mark.parametrize("url", ["/api/arbs", "/api/ev"])
def test_round_to_zero_means_cents(client, url):
    assert client.get(url, params={"round_to": 0}).status_code == 200


@pytest.mark.parametrize("url", ["/api/arbs", "/api/ev"])
@pytest.mark.parametrize("value", ["0", "-1", *NON_FINITE])
def test_rejects_bad_max_side(client, url, value):
    _rejected(client, url, {"max_side": value}, "max_side")


@pytest.mark.parametrize("value", ["0", "-1", *NON_FINITE])
def test_ev_rejects_bad_kelly(client, value):
    _rejected(client, "/api/ev", {"kelly": value}, "kelly")


@pytest.mark.parametrize("value", ["-1", *NON_FINITE])
def test_ev_rejects_bad_max_hold(client, value):
    _rejected(client, "/api/ev", {"max_hold": value}, "max_hold")


def test_ev_max_hold_zero_ok(client):
    assert client.get("/api/ev", params={"max_hold": 0}).status_code == 200


@pytest.mark.parametrize("value", ["0", "-5", *NON_FINITE])
def test_lowhold_rejects_bad_stake(client, value):
    _rejected(client, "/api/lowhold", {"stake": value}, "stake")


@pytest.mark.parametrize("url", ["/api/arbs", "/api/ev"])
def test_rejects_inverted_odds_range(client, url):
    r = client.get(url, params={"odds_min": 500, "odds_max": 100})
    assert r.status_code == 422, r.text[:200]
    assert "odds_min" in r.text and "odds_max" in r.text


@pytest.mark.parametrize("url", ["/api/arbs", "/api/ev"])
@pytest.mark.parametrize("value", NON_FINITE)
def test_rejects_non_finite_odds_bounds(client, url, value):
    _rejected(client, url, {"odds_min": value}, "odds_min")
    _rejected(client, url, {"odds_max": value}, "odds_max")


@pytest.mark.parametrize("url", ["/api/arbs", "/api/ev"])
def test_equal_odds_range_ok(client, url):
    assert client.get(url, params={"odds_min": 100, "odds_max": 100}).status_code == 200


@pytest.mark.parametrize("url", ["/api/arbs", "/api/ev", "/api/lowhold"])
def test_defaults_ok(client, url):
    r = client.get(url)
    assert r.status_code == 200 and isinstance(r.json(), list)
