"""Regression tests from review of the exchange books change (odderjam-19)."""
import httpx

from backend.engine.exchange import contract_to_american, fee_for

from backend.providers import exchanges, kalshi, polymarket
from backend.providers.teams import same_team

NO_FEE = {"model": "none"}


def mlb_event(eid, start):
    return {"id": eid, "sport": "MLB", "home": "New York Yankees", "away": "Boston Red Sox", "start": start,
            "markets": {"moneyline": [{"name": "New York Yankees", "point": None, "prices": {"Pinnacle": -120}},
                                      {"name": "Boston Red Sox", "point": None, "prices": {"Pinnacle": 110}}]}}


def kalshi_game(ticker, expires, nyy_yes, bos_yes):
    def market(team, yes, no):
        return {"event_ticker": ticker, "status": "active", "yes_sub_title": team,
                "yes_ask_dollars": f"{yes:.2f}", "no_ask_dollars": f"{no:.2f}", "expected_expiration_time": expires}
    # NO on a team pays when the other team wins; priced a little above the complement of YES.
    return [market("New York Y", nyy_yes, 1 - nyy_yes + 0.02), market("Boston", bos_yes, 1 - bos_yes + 0.02)]


def kalshi_prices(e):
    return {o["name"]: o["prices"].get("Kalshi") for o in e["markets"]["moneyline"]}


def test_kalshi_doubleheader_lands_on_right_game():
    # Settlement is expected about 3h after first pitch; G1's expiry (20:05) is nearer G2's start (20:35).
    payload = {"markets": kalshi_game("G1", "2026-07-04T20:05:00Z", 0.40, 0.62)
               + kalshi_game("G2", "2026-07-04T23:35:00Z", 0.55, 0.47)}
    quotes = kalshi.parse(payload, "MLB", NO_FEE)
    g1, g2 = exchanges.merge_quotes([mlb_event("g1", "2026-07-04T17:05:00Z"), mlb_event("g2", "2026-07-04T20:35:00Z")],
                                    quotes)
    assert kalshi_prices(g1)["New York Yankees"] == 150  # 40c
    assert kalshi_prices(g2)["New York Yankees"] < 0  # 55c


def test_kalshi_single_quote_does_not_jump_to_later_game():
    quotes = kalshi.parse({"markets": kalshi_game("G1", "2026-07-04T20:05:00Z", 0.40, 0.62)}, "MLB", NO_FEE)
    g1, g2 = exchanges.merge_quotes([mlb_event("g1", "2026-07-04T17:05:00Z"), mlb_event("g2", "2026-07-04T20:35:00Z")],
                                    quotes)
    assert kalshi_prices(g1)["New York Yankees"] == 150
    assert kalshi_prices(g2)["New York Yankees"] is None


def test_same_book_two_quotes_one_event_keeps_closest():
    near = {"book": "Polymarket", "sport": "MLB", "start": "2026-07-04T17:05:00+00:00",
            "prices": {"Yankees": 120, "Red Sox": -140}}
    far = {**near, "start": "2026-07-04T22:00:00+00:00", "prices": {"Yankees": 300, "Red Sox": -400}}
    (e,) = exchanges.merge_quotes([mlb_event("g1", "2026-07-04T17:05:00Z")], [near, far])
    assert {o["name"]: o["prices"]["Polymarket"] for o in e["markets"]["moneyline"]} == {
        "New York Yankees": 120, "Boston Red Sox": -140}


def test_naive_timestamps_are_skipped_not_raised():
    payload = [{"title": "Yankees vs. Red Sox", "closed": False, "startTime": "2026-07-04T17:05:00", "markets": [
        {"sportsMarketType": "moneyline", "outcomes": '["Yankees", "Red Sox"]', "outcomePrices": '["0.45", "0.55"]'}]}]
    assert polymarket.parse(payload, "MLB", NO_FEE) == []
    bad = {"book": "Polymarket", "sport": "MLB", "start": "2026-07-04T17:05:00", "prices": {"Yankees": 1, "Red Sox": 1}}
    good = {**bad, "start": "2026-07-04T17:05:00+00:00", "prices": {"Yankees": 120, "Red Sox": -140}}
    (e,) = exchanges.merge_quotes([mlb_event("g1", "2026-07-04T17:05:00Z")], [bad, good])
    assert e["markets"]["moneyline"][0]["prices"]["Polymarket"] == 120


def test_unexpected_payload_shape_skips_platform(monkeypatch):
    monkeypatch.setattr(polymarket, "fetch", lambda sport, client: {"error": "rate limited"})
    monkeypatch.setattr(kalshi, "fetch", lambda sport, client: {"markets": kalshi_game(
        "G1", "2026-07-04T20:05:00Z", 0.40, 0.62)})
    events = [mlb_event("g1", "2026-07-04T17:05:00Z")]
    (e,) = exchanges.enrich(events, ["Polymarket", "Kalshi"], client=httpx.Client())
    assert kalshi_prices(e)["New York Yankees"] == contract_to_american(40, fee_for("Kalshi"))


def test_accented_names_match():
    assert same_team("Montreal", "Montréal Canadiens")
    assert same_team("Montréal", "Montreal Canadiens")
