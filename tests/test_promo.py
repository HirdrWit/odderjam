import sqlite3

import pytest
from fastapi.testclient import TestClient

from backend import main
from backend.engine import promo
from backend.providers import mock
from backend.routes import bets


def outcome(name, point, **prices):
    return {"name": name, "point": point, "prices": prices}


# ---- math ----

def test_bonus_bet_hedge_locks_equal_profit():
    # $100 bonus at +300 (4.0), hedge at -250 (1.4): win A = 300, hedge = 300/1.4.
    r = promo.bonus_bet_hedge(100, 300, -250)
    assert r["hedge_stake"] == pytest.approx(300 / 1.4)
    if_a = 300 - r["hedge_stake"]
    if_b = r["hedge_stake"] * 0.4
    assert if_a == pytest.approx(if_b) == pytest.approx(r["profit"])
    assert r["conversion_pct"] == pytest.approx(r["profit"])


def test_bonus_bet_long_odds_convert_better():
    assert promo.bonus_bet_hedge(100, 400, -500)["conversion_pct"] > promo.bonus_bet_hedge(100, -110, -110)["conversion_pct"]


def test_profit_boost_hedge():
    # $50 at +100 with a 50% boost: winnings 75 -> boosted to +150.
    r = promo.profit_boost_hedge(50, 100, -110, 50)
    assert r["boosted_odds"] == pytest.approx(150)
    db = 1 + 100 / 110
    assert r["hedge_stake"] == pytest.approx(125 / db)
    if_a = 75 - r["hedge_stake"]
    if_b = r["hedge_stake"] * (db - 1) - 50
    assert if_a == pytest.approx(if_b) == pytest.approx(r["profit"])
    assert r["conversion_pct"] == pytest.approx(r["profit"] / 50 * 100)


def test_profit_boost_cap_and_zero_boost():
    capped = promo.profit_boost_hedge(100, 100, -110, 100, max_boost=25)
    assert capped["boosted_odds"] == pytest.approx(125)
    assert promo.profit_boost_hedge(100, 100, -110, 0)["profit"] < 0  # no boost: just paying vig


def test_second_chance_hedge():
    # $100 at +200, hedge at -150; refund on loss is a bonus bet worth 70%.
    r = promo.second_chance_hedge(100, 200, -150)
    db = 1 + 100 / 150
    assert r["hedge_stake"] == pytest.approx((300 - 70) / db)
    if_a = 200 - r["hedge_stake"]
    if_b = r["hedge_stake"] * (db - 1) - 100 + 70
    assert if_a == pytest.approx(if_b) == pytest.approx(r["profit"])
    assert r["conversion_pct"] == pytest.approx(r["profit"])


def test_second_chance_refund_value_and_cap():
    lo = promo.second_chance_hedge(100, 200, -150, refund_value=0.5)
    hi = promo.second_chance_hedge(100, 200, -150, refund_value=0.8)
    assert hi["profit"] > lo["profit"]
    # refund capped at the stake
    assert promo.second_chance_hedge(100, 200, -150, refund=500)["profit"] == pytest.approx(
        promo.second_chance_hedge(100, 200, -150)["profit"])


# ---- endpoint ----

@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(main, "get_snapshot", lambda: mock.snapshot(seed=1))
    return TestClient(main.app)


@pytest.mark.parametrize("kind", ["bonus-bet", "profit-boost", "second-chance"])
def test_promo_endpoint_ranks_and_hedges_elsewhere(client, kind):
    rows = client.get(f"/api/promo/{kind}", params={"book": "DraftKings", "amount": 50, "boost_pct": 30,
                                                     "limit": 1000}).json()
    assert rows
    assert [r["conversion_pct"] for r in rows] == sorted((r["conversion_pct"] for r in rows), reverse=True)
    assert {"moneyline", "spreads", "totals"} <= {r["market"] for r in rows}
    for r in rows:
        promo_leg, hedge = r["legs"]
        assert promo_leg["book"] == "DraftKings" and hedge["book"] != "DraftKings"
        assert hedge["book"] != "Pinnacle"
        assert promo_leg["stake"] == 50 and promo_leg["is_bonus"] == (kind == "bonus-bet")
        assert not hedge["is_bonus"]


def test_promo_endpoint_uses_best_other_book(monkeypatch):
    ev = {"id": "x", "sport": "NBA", "home": "A", "away": "B", "start": "t", "markets": {"moneyline": [
        outcome("A", None, DraftKings=250, FanDuel=260),
        outcome("B", None, DraftKings=-300, FanDuel=-320, BetMGM=-280, Pinnacle=-200)]}}
    monkeypatch.setattr(main, "get_snapshot", lambda: [ev])
    rows = TestClient(main.app).get("/api/promo/bonus-bet", params={"book": "DraftKings"}).json()
    assert len(rows) == 2
    top = rows[0]
    assert [leg["pick"] for leg in top["legs"]] == ["A", "B"]  # long side converts better
    assert (top["legs"][1]["book"], top["legs"][1]["odds"]) == ("BetMGM", -280)
    assert top["conversion_pct"] == pytest.approx(promo.bonus_bet_hedge(100, 250, -280)["conversion_pct"])


def test_promo_endpoint_rejects_bad_input(client):
    assert client.get("/api/promo/bonus-bet", params={"book": "Pinnacle"}).status_code == 400
    assert client.get("/api/promo/bonus-bet", params={"book": "DraftKings", "amount": 0}).status_code == 400
    assert client.get("/api/promo/nope", params={"book": "DraftKings"}).status_code == 422


# ---- tracker ----

@pytest.fixture
def db_client(tmp_path, monkeypatch):
    monkeypatch.setattr(bets, "DB", tmp_path / "t.db")
    return TestClient(main.app)


def test_bonus_bet_tracker_pl(db_client):
    c = db_client
    base = {"pick": "A", "book": "DraftKings", "odds": 300, "stake": 100, "is_bonus": True}
    won = c.post("/api/bets", json=base).json()
    lost = c.post("/api/bets", json=base).json()
    assert won["is_bonus"] is True
    assert c.get("/api/bankroll").json()["pending_stake"] == 0
    assert c.put(f"/api/bets/{won['id']}", json={**base, "status": "won"}).json()["profit"] == pytest.approx(300)
    assert c.put(f"/api/bets/{lost['id']}", json={**base, "status": "lost"}).json()["profit"] == 0
    cash = c.post("/api/bets", json={"pick": "B", "odds": -250, "stake": 70, "status": "lost"}).json()
    assert cash["is_bonus"] is False and cash["profit"] == -70
    s = c.get("/api/bets/stats").json()
    assert s["profit"] == pytest.approx(230) and s["staked"] == 70  # bonus stakes aren't cash staked
    assert c.get("/api/bankroll").json()["current"] == pytest.approx(330)


def test_old_db_gets_is_bonus_column(tmp_path, monkeypatch):
    path = tmp_path / "old.db"
    with sqlite3.connect(path) as c:
        c.execute("""CREATE TABLE bets (id INTEGER PRIMARY KEY AUTOINCREMENT, placed_at TEXT NOT NULL, event TEXT,
            sport TEXT, market TEXT DEFAULT 'moneyline', pick TEXT NOT NULL, book TEXT, odds REAL NOT NULL,
            stake REAL NOT NULL, status TEXT NOT NULL DEFAULT 'pending', closing_odds REAL, ev_pct REAL, notes TEXT)""")
        c.execute("INSERT INTO bets (placed_at,pick,odds,stake,status) VALUES ('t','X',100,10,'lost')")
    monkeypatch.setattr(bets, "DB", path)
    (b,) = TestClient(main.app).get("/api/bets").json()
    assert b["is_bonus"] is False and b["profit"] == -10
