"""Bet tracker input validation (odderjam-38): bad odds, stake, pick or bankroll must not reach the database."""
import pytest
from fastapi.testclient import TestClient

from backend.main import app

GOOD = {"pick": "Chiefs", "odds": 150, "stake": 10}


@pytest.fixture
def client():
    return TestClient(app)


def _raw(client, method, url, body: str):
    """Send a raw JSON body, so NaN and Infinity reach the server unparsed by the client."""
    return client.request(method, url, content=body, headers={"Content-Type": "application/json"})


def _bets(client):
    return client.get("/api/bets").json()


@pytest.mark.parametrize("odds", [0, 50, -50, 99.99, -99.5])
def test_add_bet_rejects_invalid_odds(client, odds):
    r = client.post("/api/bets", json={**GOOD, "odds": odds})
    assert r.status_code == 422, r.text
    assert _bets(client) == []


@pytest.mark.parametrize("odds", [100, -100, 150, -110])
def test_add_bet_accepts_boundary_odds(client, odds):
    r = client.post("/api/bets", json={**GOOD, "odds": odds})
    assert r.status_code == 200, r.text
    assert r.json()["odds"] == odds


@pytest.mark.parametrize("field,value", [("odds", "NaN"), ("odds", "Infinity"), ("odds", "-Infinity"),
                                         ("stake", "NaN"), ("stake", "Infinity")])
def test_add_bet_rejects_non_finite_numbers(client, field, value):
    body = {"pick": '"Chiefs"', "odds": "150", "stake": "10", field: value}
    r = _raw(client, "POST", "/api/bets", "{" + ",".join(f'"{k}": {v}' for k, v in body.items()) + "}")
    assert r.status_code == 422, r.text
    assert _bets(client) == []


@pytest.mark.parametrize("stake", [0, -10, -0.01])
def test_add_bet_rejects_bad_stake(client, stake):
    r = client.post("/api/bets", json={**GOOD, "stake": stake})
    assert r.status_code == 422, r.text
    assert _bets(client) == []


@pytest.mark.parametrize("pick", ["", "   "])
def test_add_bet_rejects_blank_pick(client, pick):
    r = client.post("/api/bets", json={**GOOD, "pick": pick})
    assert r.status_code == 422, r.text
    assert _bets(client) == []


@pytest.mark.parametrize("field,value", [("closing_odds", 0), ("closing_odds", 50), ("closing_sharp_odds", 0),
                                         ("closing_sharp_odds", -99)])
def test_add_bet_rejects_bad_closing_odds(client, field, value):
    r = client.post("/api/bets", json={**GOOD, field: value})
    assert r.status_code == 422, r.text
    assert _bets(client) == []


def test_add_bet_accepts_null_and_valid_closing_odds(client):
    assert client.post("/api/bets", json={**GOOD, "closing_odds": None, "closing_sharp_odds": None}).status_code == 200
    r = client.post("/api/bets", json={**GOOD, "closing_odds": -120, "closing_sharp_odds": 100})
    assert r.status_code == 200, r.text
    assert r.json()["clv_pct"] is not None


@pytest.mark.parametrize("change", [{"odds": 0}, {"odds": 50}, {"stake": -10}, {"stake": 0}, {"pick": ""},
                                    {"closing_odds": 0}])
def test_update_bet_rejects_invalid_and_keeps_row(client, change):
    bet = client.post("/api/bets", json=GOOD).json()
    r = client.put(f"/api/bets/{bet['id']}", json={**GOOD, "status": "won", **change})
    assert r.status_code == 422, r.text
    (stored,) = _bets(client)
    assert (stored["pick"], stored["odds"], stored["stake"], stored["status"]) == ("Chiefs", 150, 10, "pending")
    assert stored["closing_odds"] is None


def test_import_reports_invalid_rows(client):
    csv = ("pick,odds,stake\n"
           "Good,150,10\n"
           "ZeroOdds,0,10\n"
           "FiftyOdds,50,10\n"
           "NegStake,-110,-10\n"
           "ZeroStake,-110,0\n"
           " ,-110,10\n")
    r = client.post("/api/bets/import", json={"csv": csv}).json()
    assert r["imported"] == 1
    assert sorted(e["line"] for e in r["errors"]) == [3, 4, 5, 6, 7]
    assert [b["pick"] for b in _bets(client)] == ["Good"]


@pytest.mark.parametrize("starting", [-100, -0.01])
def test_bankroll_rejects_negative(client, starting):
    client.put("/api/bankroll", json={"starting": 250})
    r = client.put("/api/bankroll", json={"starting": starting})
    assert r.status_code == 422, r.text
    assert client.get("/api/bankroll").json()["starting"] == 250


@pytest.mark.parametrize("value", ["NaN", "Infinity", "-Infinity"])
def test_bankroll_rejects_non_finite(client, value):
    client.put("/api/bankroll", json={"starting": 250})
    r = _raw(client, "PUT", "/api/bankroll", '{"starting": %s}' % value)
    assert r.status_code == 422, r.text
    assert client.get("/api/bankroll").json()["starting"] == 250


def test_bankroll_accepts_zero(client):
    r = client.put("/api/bankroll", json={"starting": 0})
    assert r.status_code == 200, r.text
    assert r.json()["starting"] == 0
