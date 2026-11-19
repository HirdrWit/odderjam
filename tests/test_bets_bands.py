import pytest
from fastapi.testclient import TestClient

from backend.main import app


@pytest.fixture
def client():
    return TestClient(app)


def add(client, odds, ev=None, status="won", closing=None, stake=100):
    body = {"pick": "x", "sport": "NBA", "book": "FD", "odds": odds, "stake": stake,
            "status": status, "ev_pct": ev}
    if closing is not None:
        body["closing_odds"] = closing
    r = client.post("/api/bets", json=body)
    assert r.status_code == 200, r.text


def names(rows):
    return {g["name"]: g for g in rows}


@pytest.mark.parametrize("odds,band", [
    (-201, "-inf..-200"), (-200, "-200..-110"), (-111, "-200..-110"),
    (-110, "-110..+110"), (100, "-110..+110"), (109, "-110..+110"),
    (110, "+110..+200"), (199, "+110..+200"), (200, "+200..+400"),
    (399, "+200..+400"), (400, "+400..inf"),
])
def test_odds_band_edges(client, odds, band):
    add(client, odds)
    s = client.get("/api/bets/analytics").json()
    assert [g["name"] for g in s["by_odds_band"]] == [band]


@pytest.mark.parametrize("ev,band", [
    (0, "0-2"), (1.99, "0-2"), (2, "2-4"), (4, "4-6"), (6, "6-10"), (9.99, "6-10"), (10, "10+"), (25, "10+"),
])
def test_ev_band_edges(client, ev, band):
    add(client, -110, ev=ev)
    s = client.get("/api/bets/analytics").json()
    assert [g["name"] for g in s["by_ev_band"]] == [band]


def test_no_ev_or_negative_ev_left_out_of_ev_bands(client):
    add(client, -110)
    add(client, -110, ev=-1)
    s = client.get("/api/bets/analytics").json()
    assert s["by_ev_band"] == [] and len(s["by_odds_band"]) == 1


def test_clv_ignores_bets_without_close(client):
    add(client, 150, closing=130)   # beat the close
    add(client, 150, closing=170)   # did not
    add(client, 150)                # no close: not counted as 0
    g = names(client.get("/api/bets/analytics").json()["by_odds_band"])["+110..+200"]
    assert g["bets"] == 3
    assert g["beat_close_pct"] == pytest.approx(50)
    up = (2.5 / 2.3 - 1) * 100
    down = (2.5 / 2.7 - 1) * 100
    assert g["avg_clv"] == pytest.approx((up + down) / 2)


def test_clv_null_when_no_closing_lines(client):
    add(client, 150)
    g = client.get("/api/bets/analytics").json()["by_odds_band"][0]
    assert g["avg_clv"] is None and g["beat_close_pct"] is None


def test_expected_profit_is_stake_times_ev(client):
    add(client, 150, ev=3, stake=100, status="lost")
    add(client, 160, ev=5, stake=50, status="won")
    s = client.get("/api/bets/analytics").json()
    assert names(s["by_ev_band"])["2-4"]["expected_profit"] == pytest.approx(3)
    assert names(s["by_ev_band"])["4-6"]["expected_profit"] == pytest.approx(2.5)
    assert names(s["by_odds_band"])["+110..+200"]["expected_profit"] == pytest.approx(5.5)
    assert s["expected_profit"] == pytest.approx(5.5)
    assert names(s["by_odds_band"])["+110..+200"]["profit"] == pytest.approx(50 * 1.6 - 100)


def test_pending_bets_excluded(client):
    add(client, 150, ev=3, status="pending")
    assert client.get("/api/bets/analytics").json()["by_odds_band"] == []
    assert "by_ev_band" in client.get("/api/bets/stats").json()
