import pytest
from fastapi.testclient import TestClient

from backend import main
from backend.engine import markets as mk
from backend.engine.parlay import parlay


def o(name, point, **prices):
    return {"name": name, "point": point, "prices": prices}


def test_parlay_ev_known_example():
    # Two +100 legs, each truly 55%: pays 4.0x, wins 30.25% of the time -> +21% EV.
    r = parlay([100, 100], [0.55, 0.55], kelly=0.25)
    assert r["decimal"] == pytest.approx(4.0)
    assert r["american"] == pytest.approx(300)
    assert r["fair_prob"] == pytest.approx(0.3025)
    assert r["ev_pct"] == pytest.approx(21.0)
    # Full Kelly: (3 * 0.3025 - 0.6975) / 3 = 0.07
    assert r["kelly_fraction"] == pytest.approx(0.07 * 0.25)


def test_parlay_negative_ev_has_zero_kelly():
    assert parlay([-110, -110], [0.5, 0.5], kelly=1)["kelly_fraction"] == 0


EVENTS = [
    {"id": "g1", "sport": "NBA", "home": "A", "away": "B", "start": "t", "markets": {
        "moneyline": [o("A", None, Pinnacle=-110, DraftKings=100, Novig=105),
                      o("B", None, Pinnacle=-110, DraftKings=-120, Novig=-125)],
        "totals": [o("Over", 220.5, Pinnacle=-110, DraftKings=-105, Novig=-110),
                   o("Under", 220.5, Pinnacle=-110, DraftKings=-115, Novig=-110)]}},
    {"id": "g2", "sport": "NBA", "home": "C", "away": "D", "start": "t", "markets": {
        "moneyline": [o("C", None, Pinnacle=-110, DraftKings=100, Novig=110, FanDuel=120),
                      o("D", None, Pinnacle=-110, DraftKings=-120, Novig=-130, FanDuel=-140)],
        "spreads": [o("C", -3.5, DraftKings=-110), o("D", 3.5, DraftKings=-110)]}},
]


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(main, "get_snapshot", lambda: EVENTS)
    return TestClient(main.app)


def leg(event_id, market, name, point=None):
    return {"event_id": event_id, "market": market, "name": name, "point": point}


def test_parlay_endpoint_prices_each_book(client):
    r = client.post("/api/parlay", json={"legs": [leg("g1", "moneyline", "A"), leg("g2", "moneyline", "C")]}).json()
    assert r["same_game"] is False
    assert r["fair_prob"] == pytest.approx(0.25)  # each leg 50% after removing the vig
    assert [b["book"] for b in r["books"]] == ["Novig", "DraftKings"]  # FanDuel lacks leg 1; best price first
    novig, dk = r["books"]
    assert novig["decimal"] == pytest.approx(2.05 * 2.10)
    assert novig["leg_odds"] == [105, 110]
    assert novig["ev_pct"] == pytest.approx((0.25 * 2.05 * 2.10 - 1) * 100)
    assert dk["ev_pct"] == pytest.approx(0.0)
    assert dk["stake"] == 0 and novig["stake"] > 0  # Kelly on the $100 default bankroll
    assert not any(b["blocked"] for b in r["books"])


def test_same_game_legs_blocked_at_books_without_sgp(client):
    r = client.post("/api/parlay", json={"legs": [leg("g1", "moneyline", "A"), leg("g1", "totals", "Over", 220.5)]}).json()
    assert r["same_game"] is True
    assert {b["book"]: b["blocked"] for b in r["books"]} == {"DraftKings": False, "Novig": True}
    assert r["books"][-1]["book"] == "Novig"  # blocked books sort last


def test_parlay_rejects_bad_legs(client):
    assert client.post("/api/parlay", json={"legs": [leg("g1", "moneyline", "A")]}).status_code == 422
    same_market = {"legs": [leg("g1", "moneyline", "A"), leg("g1", "moneyline", "B")]}
    assert client.post("/api/parlay", json=same_market).status_code == 400


def test_parlay_without_sharp_line_has_no_ev(client):
    r = client.post("/api/parlay", json={"legs": [leg("g1", "moneyline", "A"), leg("g2", "spreads", "C", -3.5)]}).json()
    assert r["fair_prob"] is None and r["legs"][1]["fair_prob"] is None
    (dk,) = r["books"]
    assert dk["ev_pct"] is None and dk["stake"] is None
    assert dk["decimal"] == pytest.approx(2.0 * (1 + 100 / 110))


def test_ev_rows_carry_leg_identity(client):
    row = client.get("/api/ev", params={"min_ev": -100}).json()[0]
    assert {"event_id", "market", "name", "point"} <= row.keys()


def test_same_market_error_names_game_and_market(client):
    r = client.post("/api/parlay", json={"legs": [leg("g1", "moneyline", "A"), leg("g1", "moneyline", "B")]})
    assert r.status_code == 400
    assert r.json()["detail"] == "Both sides of B @ A Moneyline are in the slip; remove one"


def test_same_market_error_names_spread_market(client):
    legs = [leg("g1", "moneyline", "A"), leg("g2", "spreads", "C", -3.5), leg("g2", "spreads", "D", 3.5)]
    r = client.post("/api/parlay", json={"legs": legs})
    assert r.status_code == 400
    detail = r.json()["detail"]
    assert detail == "Both sides of D @ C Spread are in the slip; remove one"
    assert "g2" not in detail and "spreads" not in detail


@pytest.mark.parametrize("market, label", [
    ("moneyline", "Moneyline"),
    ("spreads", "Spread"),
    ("totals", "Total"),
    ("player_points", "Points"),
    ("batter_total_bases", "Total Bases"),
    ("pitcher_strikeouts", "Strikeouts"),
    ("h2h_lay", "h2h_lay"),
])
def test_market_label(market, label):
    assert mk.market_label(market) == label


def test_one_missing_leg_of_three_is_listed_and_rest_priced(client):
    r = client.post("/api/parlay", json={"legs": [
        leg("g1", "moneyline", "A"), leg("zz", "moneyline", "A"), leg("g2", "moneyline", "C")]})
    assert r.status_code == 200
    d = r.json()
    assert d["missing"] == [{"index": 1, "event_id": "zz", "market": "moneyline", "name": "A", "point": None}]
    assert [l["name"] for l in d["legs"]] == ["A", "C"]
    assert [b["book"] for b in d["books"]] == ["Novig", "DraftKings"]
    assert d["fair_prob"] == pytest.approx(0.25)


def test_all_legs_missing_returns_empty_result(client):
    r = client.post("/api/parlay", json={"legs": [leg("x", "moneyline", "A"), leg("y", "moneyline", "B")]})
    assert r.status_code == 200
    d = r.json()
    assert [m["index"] for m in d["missing"]] == [0, 1]
    assert d["legs"] == [] and d["books"] == []
    assert d["fair_prob"] is None and d["fair_odds"] is None


def test_only_one_priceable_leg_left_has_no_comparison(client):
    d = client.post("/api/parlay", json={"legs": [leg("g1", "moneyline", "A"), leg("zz", "moneyline", "A")]}).json()
    assert [m["index"] for m in d["missing"]] == [1]
    assert d["books"] == [] and d["fair_prob"] is None
    assert len(d["legs"]) == 1


def test_no_missing_legs_gives_empty_list(client):
    d = client.post("/api/parlay", json={"legs": [leg("g1", "moneyline", "A"), leg("g2", "moneyline", "C")]}).json()
    assert d["missing"] == []
