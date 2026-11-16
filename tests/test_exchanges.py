"""Prediction markets and exchanges as books (Kalshi, Polymarket, Novig, ProphetX)."""
import json
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient

from backend import main, providers
from backend.engine.exchange import apply_commission, contract_to_american, fee_for
from backend.providers import exchanges, kalshi, polymarket, theoddsapi
from backend.providers.books import us_name
from backend.providers.teams import same_team

FIXTURES = Path(__file__).parent / "fixtures"
KALSHI_FEE = {"model": "kalshi", "rate": 0.07}
NO_FEE = {"model": "none"}


def load(name):
    return json.loads((FIXTURES / name).read_text())


@pytest.fixture(autouse=True)
def _no_fee_env(monkeypatch):
    monkeypatch.delenv("EXCHANGE_FEES", raising=False)
    monkeypatch.delenv("EXCHANGES", raising=False)


# AC1 — contract price to American odds after fees

def test_kalshi_fee_conversion():
    # 40c + 0.07*0.4*0.6 = 41.68c cost per $1 payout -> decimal 2.3992 -> +139.9 -> +139
    assert contract_to_american(40, KALSHI_FEE) == 139
    # 60c + 1.68c = 61.68c -> decimal 1.6213 -> -160.96 -> -161
    assert contract_to_american(60, KALSHI_FEE) == -161


def test_commission_and_no_fee_conversion():
    assert contract_to_american(50, NO_FEE) == 100
    assert contract_to_american(40, NO_FEE) == 150
    # 2% of winnings: 1 + 1*0.98 = 1.98 -> -102.04 -> -103
    assert contract_to_american(50, {"model": "commission", "rate": 0.02}) == -103


def test_contract_price_bounds():
    for cents in (0, 100, -5, 105):
        assert contract_to_american(cents, NO_FEE) is None
    # A fee that pushes cost to $1 or more leaves no payout worth quoting.
    assert contract_to_american(50, {"model": "kalshi", "rate": 4.0}) is None


def test_odds_floored_against_bettor():
    # 42c no fee -> +138.095 must become +138, never +139; 60c -> exactly -150, not -151 from float noise.
    assert contract_to_american(42, NO_FEE) == 138
    assert contract_to_american(60, NO_FEE) == -150


# AC2 — fee config

def test_fee_config_defaults_and_env_override(monkeypatch):
    assert fee_for("Kalshi") == {"model": "kalshi", "rate": 0.07}
    assert fee_for("Polymarket") == {"model": "none"}
    assert fee_for("Novig") == {"model": "none"}
    assert fee_for("ProphetX") == {"model": "commission", "rate": 0.0}
    assert fee_for("SomeNewExchange") == {"model": "none"}
    monkeypatch.setenv("EXCHANGE_FEES", '{"Kalshi": {"model": "kalshi", "rate": 0.035}}')
    assert fee_for("Kalshi") == {"model": "kalshi", "rate": 0.035}
    assert fee_for("Polymarket") == {"model": "none"}
    monkeypatch.setenv("EXCHANGE_FEES", "not json")
    assert fee_for("Kalshi") == {"model": "kalshi", "rate": 0.07}


# AC3 — Kalshi adapter

def test_kalshi_parse_fixture():
    quotes = kalshi.parse(load("kalshi_markets.json"), "NBA", KALSHI_FEE)
    by_teams = {frozenset(q["prices"]): q for q in quotes}
    lal = by_teams[frozenset({"Los Angeles L", "Boston"})]
    assert lal["book"] == "Kalshi" and lal["sport"] == "NBA"
    assert lal["start"] == "2026-11-17T06:00:00+00:00"
    # Lakers: NO on Boston (38c) beats YES on Lakers (40c). Boston: YES (62c) beats NO on Lakers (63c).
    assert lal["prices"]["Los Angeles L"] == contract_to_american(38, KALSHI_FEE)
    assert lal["prices"]["Boston"] == contract_to_american(62, KALSHI_FEE)
    # Legacy integer-cent fields.
    gsw = by_teams[frozenset({"Golden State", "Denver"})]
    assert gsw["prices"]["Golden State"] == contract_to_american(55, KALSHI_FEE)  # YES 55 vs NO-Denver 56
    assert gsw["prices"]["Denver"] == contract_to_american(46, KALSHI_FEE)  # YES 46 vs NO-GSW 47


def test_kalshi_skips_closed_and_incomplete():
    quotes = kalshi.parse(load("kalshi_markets.json"), "NBA", KALSHI_FEE)
    teams = {t for q in quotes for t in q["prices"]}
    assert len(quotes) == 2
    assert "Milwaukee" not in teams  # event with a single market
    assert "Philadelphia" not in teams and "New York" not in teams  # finalized


# AC4 — Polymarket adapter

def test_polymarket_parse_fixture():
    quotes = polymarket.parse(load("polymarket_events.json"), "NBA", NO_FEE)
    by_teams = {frozenset(q["prices"]): q for q in quotes}
    bos = by_teams[frozenset({"Celtics", "Lakers"})]
    assert bos["book"] == "Polymarket" and bos["sport"] == "NBA"
    assert bos["start"] == "2026-11-17T03:30:00+00:00"
    # First outcome at bestAsk 0.61; second at 1 - bestBid = 0.40.
    assert bos["prices"]["Celtics"] == contract_to_american(61, NO_FEE)
    assert bos["prices"]["Lakers"] == contract_to_american(40, NO_FEE)
    # No book depth: fall back to outcomePrices; start from the event.
    den = by_teams[frozenset({"Nuggets", "Warriors"})]
    assert den["start"] == "2026-11-17T04:00:00+00:00"
    assert den["prices"] == {"Nuggets": contract_to_american(45, NO_FEE), "Warriors": contract_to_american(55, NO_FEE)}


def test_polymarket_skips_closed_and_props():
    quotes = polymarket.parse(load("polymarket_events.json"), "NBA", NO_FEE)
    assert len(quotes) == 2  # spread and Yes/No prop skipped, closed game skipped
    assert all(set(q["prices"]).isdisjoint({"Yes", "No", "Knicks", "76ers"}) for q in quotes)


# AC5 — team-name matching

@pytest.mark.parametrize("a, b", [
    ("Los Angeles L", "Los Angeles Lakers"),
    ("Lakers", "Los Angeles Lakers"),
    ("LA Lakers", "Los Angeles Lakers"),
    ("Boston", "Boston Celtics"),
    ("Golden State", "Golden State Warriors"),
    ("49ers", "San Francisco 49ers"),
    ("St. Louis Blues", "St Louis Blues"),
    ("los angeles lakers", "Los Angeles Lakers"),
])
def test_team_name_matching(a, b):
    assert same_team(a, b) and same_team(b, a)


@pytest.mark.parametrize("a, b", [
    ("Los Angeles C", "Los Angeles Lakers"),
    ("New York Knicks", "New York Rangers"),
    ("Celtics", "Los Angeles Lakers"),
    ("", "Boston Celtics"),
])
def test_team_name_mismatch(a, b):
    assert not same_team(a, b) and not same_team(b, a)


# AC6 — merging quotes into events

def event(eid, sport, home, away, start, moneyline=True):
    markets = {"spreads": [{"name": home, "point": -3.5, "prices": {"FanDuel": -110}},
                           {"name": away, "point": 3.5, "prices": {"FanDuel": -110}}]}
    if moneyline:
        markets["moneyline"] = [{"name": home, "point": None, "prices": {"Pinnacle": -150}},
                                {"name": away, "point": None, "prices": {"Pinnacle": 130}}]
    return {"id": eid, "sport": sport, "home": home, "away": away, "start": start, "markets": markets}


def ml(e):
    return {o["name"]: o["prices"] for o in e["markets"]["moneyline"]}


def test_merge_quotes_into_event():
    events = [event("a", "NBA", "Los Angeles Lakers", "Boston Celtics", "2026-11-17T03:30:00Z"),
              event("b", "NBA", "Golden State Warriors", "Denver Nuggets", "2026-11-17T04:00:00Z", moneyline=False)]
    quotes = [
        {"book": "Kalshi", "sport": "NBA", "start": "2026-11-17T06:00:00+00:00",
         "prices": {"Boston": -161, "Los Angeles L": 150}},
        {"book": "Polymarket", "sport": "NBA", "start": "2026-11-17T04:00:00+00:00",
         "prices": {"Nuggets": 122, "Warriors": -122}},
        {"book": "Kalshi", "sport": "NFL", "start": "2026-11-17T03:30:00+00:00",
         "prices": {"Boston": 100, "Los Angeles L": -120}},  # wrong sport: ignored
    ]
    out = exchanges.merge_quotes(events, quotes)
    a, b = out
    assert ml(a)["Los Angeles Lakers"] == {"Pinnacle": -150, "Kalshi": 150}
    assert ml(a)["Boston Celtics"] == {"Pinnacle": 130, "Kalshi": -161}
    # Event without a moneyline market gets one, named as the book names the teams.
    assert ml(b) == {"Golden State Warriors": {"Polymarket": -122}, "Denver Nuggets": {"Polymarket": 122}}
    assert all(o["point"] is None for o in b["markets"]["moneyline"])
    assert "Kalshi" not in str(a["markets"]["spreads"])


def test_merge_picks_closest_start_and_ignores_far():
    events = [event("g1", "MLB", "New York Yankees", "Boston Red Sox", "2026-11-16T17:00:00Z"),
              event("g2", "MLB", "New York Yankees", "Boston Red Sox", "2026-11-16T23:00:00Z")]
    quotes = [{"book": "Kalshi", "sport": "MLB", "start": "2026-11-17T01:30:00+00:00",
               "prices": {"New York Y": 110, "Boston": -130}},
              {"book": "Polymarket", "sport": "MLB", "start": "2026-11-19T23:00:00+00:00",
               "prices": {"Yankees": 105, "Red Sox": -125}}]  # two days off: no match
    g1, g2 = exchanges.merge_quotes(events, quotes)
    assert "Kalshi" not in ml(g1)["New York Yankees"] and ml(g2)["New York Yankees"]["Kalshi"] == 110
    assert ml(g2)["Boston Red Sox"]["Kalshi"] == -130
    assert all("Polymarket" not in p for e in (g1, g2) for p in ml(e).values())


# AC7 — exchanges are books on the odds screen, +EV and arbs

def test_exchanges_are_books_on_odds_ev_arbs(monkeypatch):
    for b in ("Kalshi", "Polymarket", "ProphetX", "Novig"):
        assert us_name(b.lower()) == b
    snap = [{"id": "x", "sport": "NBA", "home": "Lakers", "away": "Celtics", "start": "2026-11-17T03:30:00Z",
             "markets": {"moneyline": [
                 {"name": "Lakers", "point": None, "prices": {"Pinnacle": -110, "Kalshi": 130}},
                 {"name": "Celtics", "point": None, "prices": {"Pinnacle": -110, "DraftKings": 105}}]}}]
    monkeypatch.setattr(main, "get_snapshot", lambda force=False: snap)
    c = TestClient(main.app)
    (e,) = c.get("/api/odds").json()
    assert e["markets"]["moneyline"][0]["prices"] == {"Kalshi": 130}
    assert any(r["book"] == "Kalshi" for r in c.get("/api/ev").json())
    (arb,) = c.get("/api/arbs").json()
    assert {leg["book"] for leg in arb["legs"]} == {"Kalshi", "DraftKings"}


# AC8 — live snapshot enrichment and fetching

def test_snapshot_enriched_and_platform_failure_skipped(monkeypatch):
    base = [event("a", "NBA", "Los Angeles Lakers", "Boston Celtics", "2026-11-17T03:30:00Z")]
    monkeypatch.setattr(theoddsapi, "snapshot", lambda: json.loads(json.dumps(base)))
    monkeypatch.setattr(kalshi, "fetch", lambda sport, client: load("kalshi_markets.json"))

    def down(sport, client):
        raise httpx.ConnectError("polymarket down")

    monkeypatch.setattr(polymarket, "fetch", down)
    assert ml(providers._fetch()[0])["Los Angeles Lakers"] == {"Pinnacle": -150}  # EXCHANGES unset: off
    monkeypatch.setenv("EXCHANGES", "Kalshi,Polymarket")
    (e,) = providers._fetch()
    assert ml(e)["Los Angeles Lakers"]["Kalshi"] == contract_to_american(38, fee_for("Kalshi"))
    assert ml(e)["Boston Celtics"]["Kalshi"] == contract_to_american(62, fee_for("Kalshi"))
    assert "Polymarket" not in str(e)


def test_fetch_endpoints_mock_transport():
    seen = []
    page1 = load("kalshi_markets.json")
    page1 = {"markets": page1["markets"][:2], "cursor": "next"}
    page2 = {"markets": load("kalshi_markets.json")["markets"][2:], "cursor": ""}

    def handler(request):
        seen.append(request.url)
        if request.url.host == "api.elections.kalshi.com":
            assert request.url.path == "/trade-api/v2/markets"
            return httpx.Response(200, json=page2 if request.url.params.get("cursor") == "next" else page1)
        assert request.url.host == "gamma-api.polymarket.com" and request.url.path == "/events"
        return httpx.Response(200, json=load("polymarket_events.json"))

    client = httpx.Client(transport=httpx.MockTransport(handler))
    payload = kalshi.fetch("NBA", client)
    assert len(payload["markets"]) == len(load("kalshi_markets.json")["markets"])
    assert seen[0].params["series_ticker"] == "KXNBAGAME" and seen[0].params["status"] == "open"
    assert len(polymarket.fetch("NBA", client)) == 3
    assert seen[-1].params["tag_slug"] == "nba" and seen[-1].params["closed"] == "false"


# AC9 — commission for exchanges quoted in American odds

def test_parse_event_applies_commission(monkeypatch):
    monkeypatch.setenv("EXCHANGE_FEES", '{"ProphetX": {"model": "commission", "rate": 0.02}}')
    raw = {"id": "e1", "home_team": "A", "away_team": "B", "commence_time": "2026-11-17T03:30:00Z", "bookmakers": [
        {"key": "prophetx", "title": "ProphetX", "markets": [{"key": "h2h", "outcomes": [
            {"name": "A", "price": 100}, {"name": "B", "price": -110}]}]},
        {"key": "draftkings", "title": "DraftKings", "markets": [{"key": "h2h", "outcomes": [
            {"name": "A", "price": 100}, {"name": "B", "price": -110}]}]}]}
    prices = {o["name"]: o["prices"] for o in theoddsapi.parse_event(raw, "NBA")["markets"]["moneyline"]}
    assert prices["A"] == {"ProphetX": -103, "DraftKings": 100}
    assert prices["B"]["ProphetX"] == apply_commission(-110, {"model": "commission", "rate": 0.02})
    assert prices["B"]["ProphetX"] < -110
