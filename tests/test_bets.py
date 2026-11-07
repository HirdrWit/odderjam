import pytest
from fastapi.testclient import TestClient

from backend.main import app


@pytest.fixture
def client():
    return TestClient(app)


def test_crud_and_stats(client):
    a = client.post("/api/bets", json={"pick": "Chiefs", "sport": "NFL", "book": "FanDuel", "odds": 150, "stake": 100}).json()
    b = client.post("/api/bets", json={"pick": "Lakers", "sport": "NBA", "book": "FanDuel", "odds": -110, "stake": 110}).json()
    assert a["status"] == "pending" and a["profit"] == 0
    won = client.put(f"/api/bets/{a['id']}", json={"pick": "Chiefs", "sport": "NFL", "book": "FanDuel", "odds": 150,
                                                   "stake": 100, "status": "won", "closing_odds": 130}).json()
    assert won["profit"] == pytest.approx(150)
    assert won["clv_pct"] == pytest.approx((2.5 / 2.3 - 1) * 100)
    client.put(f"/api/bets/{b['id']}", json={"pick": "Lakers", "sport": "NBA", "book": "FanDuel", "odds": -110,
                                             "stake": 110, "status": "lost"})
    s = client.get("/api/bets/stats").json()
    assert s["profit"] == pytest.approx(40) and s["staked"] == 210
    assert s["win_rate_pct"] == 50 and s["by_book"][0]["name"] == "FanDuel"
    assert client.delete(f"/api/bets/{a['id']}").json() == {"ok": True}
    assert client.delete(f"/api/bets/{a['id']}").status_code == 404


def test_bankroll_follows_results(client):
    assert client.get("/api/bankroll").json()["current"] == 100
    b = client.post("/api/bets", json={"pick": "X", "odds": 100, "stake": 10}).json()
    assert client.get("/api/bankroll").json()["current"] == 100  # pending doesn't change it
    client.put(f"/api/bets/{b['id']}", json={"pick": "X", "odds": 100, "stake": 10, "status": "won"})
    assert client.get("/api/bankroll").json()["current"] == pytest.approx(110)
    assert client.put("/api/bankroll", json={"starting": 200}).json()["current"] == pytest.approx(210)
