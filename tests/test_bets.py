import pytest
from fastapi.testclient import TestClient

from backend.main import app
from backend.routes import bets


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(bets, "DB", tmp_path / "t.db")
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


def _bet(client, **kw):
    return client.post("/api/bets", json={"odds": 100, "stake": 10, **kw}).json()


def _settle(client, b, status):
    keep = {k: b[k] for k in ("pick", "sport", "book", "market", "odds", "stake", "strategy")}
    return client.put(f"/api/bets/{b['id']}", json={**keep, "status": status}).json()


def test_grouping_by_market_and_strategy(client):
    _settle(client, _bet(client, pick="A", market="spreads", strategy="ev"), "won")
    _settle(client, _bet(client, pick="B", market="spreads", strategy="arb"), "lost")
    _settle(client, _bet(client, pick="C", market="totals", strategy="ev"), "won")
    _settle(client, _bet(client, pick="D", market="moneyline"), "push")
    _bet(client, pick="E", market="moneyline", strategy="ev")  # pending: not grouped
    s = client.get("/api/bets/stats").json()
    by_market = {g["name"]: g for g in s["by_market"]}
    assert by_market["spreads"]["bets"] == 2 and by_market["spreads"]["profit"] == pytest.approx(0)
    assert by_market["totals"]["profit"] == pytest.approx(10)
    by_strategy = {g["name"]: g for g in s["by_strategy"]}
    assert by_strategy["ev"] == {"name": "ev", "bets": 2, "staked": 20, "profit": 20, "roi_pct": 100}
    assert by_strategy["arb"]["profit"] == -10 and by_strategy["manual"]["bets"] == 1
    assert [g["name"] for g in s["by_strategy"]][0] == "ev"  # best profit first
    (today,) = s["daily"]
    assert today["bets"] == 4 and today["profit"] == pytest.approx(10) and today["cumulative"] == pytest.approx(10)


def test_settled_at_and_daily_cumulative(client):
    a = _bet(client, pick="A")
    assert a["settled_at"] is None
    won = _settle(client, a, "won")
    assert won["settled_at"]
    assert _settle(client, won, "pending")["settled_at"] is None
    client.post("/api/bets/import", json={"csv": "pick,odds,stake,status,placed_at,settled_at\n"
                                                 "X,100,5,lost,2026-01-01T10:00:00,2026-01-02T03:00:00\n"
                                                 "Y,100,5,won,2026-01-03T10:00:00,\n"})
    daily = client.get("/api/bets/stats").json()["daily"]
    assert [(d["date"], d["profit"], d["cumulative"]) for d in daily[:2]] == [
        ("2026-01-02", -5, -5), ("2026-01-03", 5, 0)]


def test_filters(client):
    _bet(client, pick="A", sport="NBA", book="FanDuel")
    _bet(client, pick="B", sport="NFL", book="FanDuel", strategy="ev")
    _settle(client, _bet(client, pick="C", sport="NBA", book="DraftKings"), "won")
    picks = lambda q: sorted(b["pick"] for b in client.get(f"/api/bets?{q}").json())
    assert picks("sport=NBA") == ["A", "C"]
    assert picks("book=FanDuel&sport=NBA") == ["A"]
    assert picks("status=won") == ["C"]
    assert picks("strategy=ev") == ["B"]
    assert picks("date_from=2000-01-01&date_to=2000-12-31") == []
    assert client.get("/api/bets/stats?sport=NBA").json()["total_bets"] == 2


def test_csv_round_trip(client):
    _settle(client, _bet(client, pick="Lakers -3.5", market="spreads", sport="NBA", strategy="ev",
                         event="Celtics @ Lakers"), "won")
    text = client.get("/api/bets/export.csv").text
    assert text.splitlines()[0].startswith("id,placed_at,settled_at,event,")
    r = client.post("/api/bets/import", json={"csv": text + "bad,,,,,,,,notanumber\n"}).json()
    assert r["imported"] == 1 and r["errors"][0]["line"] == 3
    a, b = client.get("/api/bets").json()
    for k in ("placed_at", "settled_at", "pick", "market", "strategy", "selection", "point", "status", "profit"):
        assert a[k] == b[k], k
    assert a["selection"] == "Lakers" and a["point"] == -3.5


def test_auto_settle(client, monkeypatch):
    games = [
        {"id": "g1", "sport": "NBA", "completed": True, "commence_time": "2099-01-01T00:00:00Z",
         "home_team": "Lakers", "away_team": "Celtics",
         "scores": [{"name": "Lakers", "score": "110"}, {"name": "Celtics", "score": "107"}]},
        {"id": "g2", "sport": "NBA", "completed": False, "commence_time": "2099-01-01T00:00:00Z",
         "home_team": "Heat", "away_team": "Bucks", "scores": None},
    ]
    asked = []
    monkeypatch.setattr(bets.providers, "get_scores", lambda sports: asked.append(sports) or games)
    ev = "Celtics @ Lakers"
    spread = _bet(client, pick="Lakers -3.5", market="spreads", sport="NBA", event=ev)
    push = _bet(client, pick="Lakers -3", market="spreads", sport="NBA", event_id="g1")
    total = _bet(client, pick="Over 216.5", market="totals", sport="NBA", event=ev)
    ml = _bet(client, pick="Lakers", market="moneyline", sport="NBA", event=ev)
    live = _bet(client, pick="Heat", sport="NBA", event="Bucks @ Heat")
    prop = _bet(client, pick="LeBron Over 25.5", market="player_points", sport="NBA", event=ev)
    r = client.post("/api/bets/settle").json()
    assert asked == [["NBA"]] and r["checked"] == 5
    status = {b["id"]: b["status"] for b in client.get("/api/bets").json()}
    assert status[spread["id"]] == "lost" and status[push["id"]] == "push"
    assert status[total["id"]] == "won" and status[ml["id"]] == "won"
    assert status[live["id"]] == "pending" and status[prop["id"]] == "pending"


def test_auto_settle_needs_live_key(client, monkeypatch):
    monkeypatch.delenv("ODDS_API_KEY", raising=False)
    assert client.post("/api/bets/settle").json() == {"checked": 0, "settled": []}  # nothing to do, no API call
    _bet(client, pick="X", sport="NBA")
    assert client.post("/api/bets/settle").status_code == 400
