"""odderjam-122: request named bookmakers instead of regions."""
import logging

import httpx
import pytest

from backend.providers import theoddsapi
from backend.providers.books import US_BOOKS, us_only

DEFAULT = ["pinnacle", "betonlineag", "draftkings", "fanduel", "betmgm", "betrivers", "espnbet", "hardrockbet",
           "novig", "prophetx"]


def _event(bk_key="draftkings", title="DraftKings"):
    return {"id": "e1", "home_team": "A", "away_team": "B", "commence_time": "2026-11-20T00:00:00Z",
            "bookmakers": [{"key": bk_key, "title": title, "last_update": "2026-11-19T00:00:00Z", "markets": [
                {"key": "h2h", "outcomes": [{"name": "A", "price": -110}, {"name": "B", "price": -110}]}]}]}


@pytest.fixture
def calls(monkeypatch, tmp_path):
    seen = []

    def fake_get(url, params=None, timeout=None):
        seen.append((url, params))
        return httpx.Response(200, json=[_event()] if url.endswith("/odds") and "/events/" not in url else _event())

    monkeypatch.setenv("ODDS_API_KEY", "k")
    monkeypatch.delenv("ODDS_BOOKMAKERS", raising=False)
    monkeypatch.setattr(theoddsapi, "META", tmp_path / "meta.json")
    monkeypatch.setattr(theoddsapi, "SPORTS", {"NBA": "basketball_nba"})
    monkeypatch.setattr(theoddsapi, "PROP_MARKETS", ["player_points"])
    monkeypatch.setattr(theoddsapi.httpx, "get", fake_get)
    return seen


def test_odds_and_props_requests_send_bookmakers_not_regions(calls):
    theoddsapi.snapshot()
    assert len(calls) == 2 and any("/events/e1/odds" in u for u, _ in calls)
    for _, params in calls:
        assert params["bookmakers"] == ",".join(DEFAULT)
        assert "regions" not in params


def test_fetch_cost_default_is_6(monkeypatch):
    monkeypatch.delenv("ODDS_BOOKMAKERS", raising=False)
    monkeypatch.setattr(theoddsapi, "SPORTS", {"NBA": "x", "NFL": "y"})
    monkeypatch.setattr(theoddsapi, "MARKETS", ["h2h", "spreads", "totals"])
    assert theoddsapi.fetch_cost() == 6


def test_env_override_and_over_ten_warns(monkeypatch, caplog):
    monkeypatch.setattr(theoddsapi, "SPORTS", {"NBA": "x", "NFL": "y"})
    monkeypatch.setattr(theoddsapi, "MARKETS", ["h2h", "spreads", "totals"])
    monkeypatch.setenv("ODDS_BOOKMAKERS", "draftkings, fanduel")
    assert theoddsapi.bookmakers() == ["draftkings", "fanduel"]
    assert theoddsapi.fetch_cost() == 6
    keys = [f"b{i}" for i in range(11)]
    monkeypatch.setenv("ODDS_BOOKMAKERS", ",".join(keys))
    with caplog.at_level(logging.WARNING):
        assert theoddsapi.bookmakers() == keys
    assert any("10" in r.message for r in caplog.records)
    assert theoddsapi.fetch_cost() == 12


def test_reference_books_stay_non_bettable_us_books_bettable():
    for b in ("pinnacle", "betonlineag"):
        assert theoddsapi.REFERENCE_ONLY[b] not in US_BOOKS
    ev = theoddsapi.parse_event({**_event(), "bookmakers": [
        _event("pinnacle", "Pinnacle")["bookmakers"][0], _event()["bookmakers"][0]]}, "NBA")
    prices = ev["markets"]["moneyline"][0]["prices"]
    assert set(prices) == {"Pinnacle", "DraftKings"}
    assert set(us_only(prices)) == {"DraftKings"}


def test_williamhill_us_shown_as_caesars():
    ev = theoddsapi.parse_event(_event("williamhill_us", "William Hill (US)"), "NBA")
    assert list(ev["markets"]["moneyline"][0]["prices"]) == ["Caesars"]
