from fastapi.testclient import TestClient

from backend.main import app
from backend.providers.books import US_BOOKS, us_name, us_only


def test_us_filter():
    assert us_name("draftkings") == "DraftKings"
    assert us_name("Betfair") is None and us_name("Bovada") is None
    assert us_only({"Pinnacle": 1, "FanDuel": 2, "Betfair": 3}) == {"FanDuel": 2}


def test_api_hides_non_us_books():
    c = TestClient(app)
    for e in c.get("/api/odds").json():
        for outcomes in e["markets"].values():
            assert all("Pinnacle" not in o["prices"] for o in outcomes)
    for r in c.get("/api/ev").json():
        assert r["book"] != "Pinnacle"
    for r in c.get("/api/arbs").json():
        assert all(l["book"] != "Pinnacle" for l in r["legs"])


def test_bet_link_prefers_deep_link_then_homepage():
    from backend.providers.books import BOOK_URLS, bet_link
    deep = {"links": {"FanDuel": "https://fd/bet/1"}}
    assert bet_link("FanDuel", deep) == "https://fd/bet/1"
    assert bet_link("DraftKings", deep) == BOOK_URLS["DraftKings"]
    assert bet_link("DraftKings", None) == BOOK_URLS["DraftKings"]
    assert bet_link("Unknown Book") is None
    assert set(BOOK_URLS) == US_BOOKS


def test_mock_rows_carry_bet_links(monkeypatch):
    from backend import main
    from backend.providers import mock
    monkeypatch.setattr(main, "get_snapshot", lambda: mock.snapshot(seed=1))
    c = TestClient(main.app)
    ev = c.get("/api/ev", params={"min_ev": -100}).json()
    arbs = c.get("/api/arbs", params={"min_profit": -100}).json()
    assert ev and all(r["link"].startswith("https://") and "odderjam-mock" in r["link"] for r in ev)
    assert arbs and all("odderjam-mock" in leg["link"] for r in arbs for leg in r["legs"])
    for e in c.get("/api/odds").json():
        for outcomes in e["markets"].values():
            assert all(set(o["links"]) <= set(o["prices"]) for o in outcomes)  # no Pinnacle links leak


def test_parse_event_links(monkeypatch):
    from backend.providers import theoddsapi
    monkeypatch.setattr(theoddsapi, "STATE", "")
    e = {"id": "1", "home_team": "A", "away_team": "B", "commence_time": "t", "bookmakers": [
        {"key": "draftkings", "title": "DraftKings", "link": "https://dk/event", "markets": [
            {"key": "h2h", "link": "https://dk/market", "outcomes": [
                {"name": "A", "price": -120, "link": "https://dk/slip/A"}, {"name": "B", "price": 110}]}]},
        {"key": "betmgm", "title": "BetMGM", "link": "https://sports.{state}.betmgm.com/e", "markets": [
            {"key": "h2h", "outcomes": [{"name": "A", "price": -110}, {"name": "B", "price": -110}]}]},
        {"key": "fanduel", "title": "FanDuel", "markets": [
            {"key": "h2h", "outcomes": [{"name": "A", "price": -110}, {"name": "B", "price": -110}]}]},
    ]}
    a, b = theoddsapi.parse_event(e, "NFL")["markets"]["moneyline"]
    assert a["links"] == {"DraftKings": "https://dk/slip/A"}  # {state} link dropped without ODDS_STATE
    assert b["links"] == {"DraftKings": "https://dk/market"}
    monkeypatch.setattr(theoddsapi, "STATE", "nj")
    a, _ = theoddsapi.parse_event(e, "NFL")["markets"]["moneyline"]
    assert a["links"]["BetMGM"] == "https://sports.nj.betmgm.com/e"
