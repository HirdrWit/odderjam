import pytest
from fastapi.testclient import TestClient

from backend import main
from backend.engine.markets import label, line_groups
from backend.providers import mock
from backend.providers.theoddsapi import parse_event


def make_outcome(name, point, **prices):
    return {"name": name, "point": point, "prices": prices}


def test_spread_groups_pair_home_and_away_at_same_line():
    outs = [make_outcome("A", -3.5, X=-110), make_outcome("B", 3.5, X=-110), make_outcome("A", -4.5, Y=100), make_outcome("B", 4.5, Y=-120),
            make_outcome("A", -2.5, Z=-130)]  # -2.5 has no away side: incomplete, skipped
    groups = line_groups("spreads", outs, "A", "B")
    assert [g["point"] for g in groups] == [-4.5, -3.5]
    for g in groups:
        home, away = g["outcomes"]
        assert (home["name"], away["name"]) == ("A", "B")
        assert home["point"] == -away["point"]


def test_total_groups_only_match_same_point():
    outs = [make_outcome("Over", 220.5, X=-110), make_outcome("Under", 221.5, Y=-110), make_outcome("Under", 220.5, X=-110)]
    groups = line_groups("totals", outs, "A", "B")
    assert len(groups) == 1 and groups[0]["point"] == 220.5
    assert [o["name"] for o in groups[0]["outcomes"]] == ["Over", "Under"]


def test_three_way_moneyline_requires_draw():
    outs = [make_outcome("A", None, X=200), make_outcome("B", None, X=150), make_outcome("Draw", None, X=220)]
    (g,) = line_groups("moneyline", outs, "A", "B")
    assert [o["name"] for o in g["outcomes"]] == ["A", "B", "Draw"]
    assert line_groups("moneyline", outs[:1] + outs[2:], "A", "B") == []


def test_label():
    assert label(make_outcome("A", None)) == "A"
    assert label(make_outcome("A", -3.5)) == "A -3.5"
    assert label(make_outcome("B", 3.5)) == "B +3.5"
    assert label(make_outcome("Over", 220.5)) == "Over 220.5"


def test_parse_odds_api_event():
    e = {"id": "1", "home_team": "A", "away_team": "B", "commence_time": "t", "bookmakers": [
        {"key": "pinnacle", "title": "Pinnacle", "markets": [
            {"key": "h2h", "outcomes": [{"name": "A", "price": -120}, {"name": "B", "price": 110}]},
            {"key": "spreads", "outcomes": [{"name": "A", "price": -105, "point": -2.5},
                                            {"name": "B", "price": -105, "point": 2.5}]}]},
        {"key": "draftkings", "title": "DraftKings", "markets": [
            {"key": "spreads", "outcomes": [{"name": "A", "price": -110, "point": -3.5},
                                            {"name": "B", "price": -110, "point": 3.5}]},
            {"key": "totals", "outcomes": [{"name": "Over", "price": -110, "point": 44.5},
                                           {"name": "Under", "price": -110, "point": 44.5}]}]},
        {"key": "betfair", "title": "Betfair", "markets": [
            {"key": "h2h", "outcomes": [{"name": "A", "price": -100}, {"name": "B", "price": 100}]}]},
    ]}
    m = parse_event(e, "NFL")["markets"]
    assert m["moneyline"] == [make_outcome("A", None, Pinnacle=-120), make_outcome("B", None, Pinnacle=110)]
    assert make_outcome("A", -2.5, Pinnacle=-105) in m["spreads"] and make_outcome("A", -3.5, DraftKings=-110) in m["spreads"]
    assert len(m["spreads"]) == 4  # different lines stay separate outcomes
    assert m["totals"] == [make_outcome("Over", 44.5, DraftKings=-110), make_outcome("Under", 44.5, DraftKings=-110)]


def test_mock_has_spreads_totals_with_books_at_different_lines():
    events = mock.snapshot(seed=1)
    for key in ("spreads", "totals"):
        assert all(e["markets"][key] for e in events)
        assert any(len({o["point"] for o in e["markets"][key] if o["name"] != e["away"]}) > 1 for e in events)


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(main, "get_snapshot", lambda: mock.snapshot(seed=1))
    return TestClient(main.app)


def test_ev_and_arbs_return_spread_and_total_rows(client):
    ev = client.get("/api/ev", params={"min_ev": -100}).json()
    arbs = client.get("/api/arbs", params={"min_profit": -100}).json()
    for rows in (ev, arbs):
        assert {"moneyline", "spreads", "totals"} <= {r["market"] for r in rows}
        assert all("point" in r for r in rows)
    for r in arbs:
        if r["market"] == "totals":
            assert {leg["point"] for leg in r["legs"]} == {r["point"]}
        if r["market"] == "spreads":
            home, away = r["legs"]
            assert home["point"] == r["point"] == -away["point"]


def test_arbs_never_mix_lines(monkeypatch):
    # Over 220.5 +150 and Under 221.5 +150 would "arb" only if the different lines were wrongly matched.
    ev = {"id": "x", "sport": "NBA", "home": "A", "away": "B", "start": "t", "markets": {"totals": [
        make_outcome("Over", 220.5, DraftKings=150, Pinnacle=-110), make_outcome("Under", 220.5, FanDuel=-200, Pinnacle=-110),
        make_outcome("Over", 221.5, BetMGM=-200), make_outcome("Under", 221.5, Caesars=150)]}}
    monkeypatch.setattr(main, "get_snapshot", lambda: [ev])
    c = TestClient(main.app)
    assert c.get("/api/arbs").json() == []
    rows = c.get("/api/ev", params={"min_ev": -100}).json()
    assert {(r["pick"], r["book"]) for r in rows} == {("Over 220.5", "DraftKings"), ("Under 220.5", "FanDuel")}
