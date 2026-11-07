import pytest
from fastapi.testclient import TestClient

from backend import main
from backend.engine.markets import is_prop, label, line_groups
from backend.providers import mock
from backend.providers import theoddsapi
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


def make_prop(name, player, point, **prices):
    return {"name": name, "player": player, "point": point, "prices": prices}


def test_prop_groups_split_by_player_and_line():
    outs = [make_prop("Over", "P1", 0.5, X=-110), make_prop("Under", "P1", 0.5, Y=-110),
            make_prop("Over", "P2", 0.5, X=-110), make_prop("Under", "P2", 1.5, Y=-110),  # P2 lines don't match
            make_prop("Over", "P1", 1.5, X=150)]  # no Under at 1.5: incomplete
    (g,) = line_groups("player_threes", outs, "A", "B")
    assert (g["player"], g["point"]) == ("P1", 0.5)
    assert [o["name"] for o in g["outcomes"]] == ["Over", "Under"]


def test_yes_no_props():
    outs = [make_prop("Yes", "P1", None, X=150), make_prop("No", "P1", None, X=-180)]
    (g,) = line_groups("player_anytime_td", outs, "A", "B")
    assert [o["name"] for o in g["outcomes"]] == ["Yes", "No"]


def test_prop_label():
    assert label(make_prop("Over", "LeBron James", 25.5)) == "LeBron James Over 25.5"


def test_parse_odds_api_props():
    e = {"id": "1", "home_team": "A", "away_team": "B", "commence_time": "t", "bookmakers": [
        {"key": "draftkings", "title": "DraftKings", "markets": [
            {"key": "player_threes", "outcomes": [
                {"name": "Over", "description": "P1", "price": -150, "point": 0.5},
                {"name": "Under", "description": "P1", "price": 120, "point": 0.5},
                {"name": "Over", "description": "P2", "price": 110, "point": 0.5}]}]},
        {"key": "fanduel", "title": "FanDuel", "markets": [
            {"key": "player_threes", "outcomes": [{"name": "Over", "description": "P1", "price": -140, "point": 0.5}]}]},
    ]}
    m = parse_event(e, "NBA")["markets"]
    assert make_prop("Over", "P1", 0.5, DraftKings=-150, FanDuel=-140) in m["player_threes"]
    assert make_prop("Over", "P2", 0.5, DraftKings=110) in m["player_threes"]
    assert len(m["player_threes"]) == 3


def test_snapshot_fetches_props_per_event(monkeypatch):
    calls = []

    class Resp:
        def __init__(self, body):
            self.status_code, self.headers, self._body = 200, {}, body

        def json(self):
            return self._body

    def fake_get(url, params, timeout):
        calls.append((url, params["markets"]))
        game = {"id": "g1", "home_team": "A", "away_team": "B", "commence_time": "t", "bookmakers": [
            {"key": "draftkings", "title": "DraftKings", "markets": [
                {"key": "player_points", "outcomes": [{"name": "Over", "description": "P1", "price": -110, "point": 20.5}]}
                if "/events/" in url else
                {"key": "h2h", "outcomes": [{"name": "A", "price": -110}, {"name": "B", "price": -110}]}]}]}
        return Resp(game if "/events/" in url else [game])

    monkeypatch.setenv("ODDS_API_KEY", "k")
    monkeypatch.setattr(theoddsapi, "SPORTS", {"NBA": "basketball_nba"})
    monkeypatch.setattr(theoddsapi, "PROP_MARKETS", ["player_points", "batter_hits"])
    monkeypatch.setattr(theoddsapi.httpx, "get", fake_get)
    (e,) = theoddsapi.snapshot()
    assert set(e["markets"]) == {"moneyline", "player_points"}
    assert calls[1] == ("https://api.the-odds-api.com/v4/sports/basketball_nba/events/g1/odds", "player_points")

    monkeypatch.setattr(theoddsapi, "PROP_MARKETS", [])
    calls.clear()
    theoddsapi.snapshot()
    assert len(calls) == 1  # props off: no per-event requests


def test_mock_has_props_for_every_event():
    for e in mock.snapshot(seed=1):
        props = [k for k in e["markets"] if is_prop(k)]
        assert props
        assert len({o["player"] for k in props for o in e["markets"][k]}) >= 4


def test_ev_and_arbs_include_props_unless_mainlines_only(client):
    for path, params in (("/api/ev", {"min_ev": -100}), ("/api/arbs", {"min_profit": -100})):
        rows = client.get(path, params=params).json()
        prop_rows = [r for r in rows if is_prop(r["market"])]
        assert prop_rows and all(r["player"] for r in prop_rows)
        mainlines = client.get(path, params={**params, "props": "false"}).json()
        assert mainlines and not any(is_prop(r["market"]) for r in mainlines)
        assert all(r["player"] is None for r in mainlines)
    assert any(is_prop(r["market"]) for r in client.get("/api/arbs").json())  # soft-book props yield real arbs


def test_odds_screen_groups_props_under_event(client):
    e = client.get("/api/odds", params={"sport": "NBA"}).json()[0]
    assert e["markets"]["player_points"][0]["player"]
