"""Suspect markets (stale or mismatched prices) are flagged and kept out of every opportunity scanner."""
import pytest
from fastapi.testclient import TestClient

from backend import main, scan
from backend.engine import suspect


def o(name, point, **prices):
    return {"name": name, "point": point, "prices": prices}


def event(eid, markets, home="Nets", away="76ers"):
    return {"id": eid, "sport": "NBA", "home": home, "away": away, "start": "2099-01-01T00:00:00Z",
            "markets": markets}


# The issue's example: best spread prices +1350 / -10000 give a hold near -97%.
EXAMPLE = [o("Nets", -3.5, MGM=-10000, DraftKings=-110), o("76ers", 3.5, MGM=1350, DraftKings=-110)]
ORDINARY = [o("Nets", -3.5, DraftKings=-110, FanDuel=-108), o("76ers", 3.5, DraftKings=-110, FanDuel=-112)]



def test_issue_example_is_suspect():
    assert suspect.is_suspect_market("spreads", EXAMPLE)


def test_ordinary_market_passes():
    assert not suspect.is_suspect_market("spreads", ORDINARY)


def test_hold_below_floor_is_suspect():
    # +400 / +400 at best: implied 20% + 20% - 1 = -60% hold.
    assert suspect.is_suspect_market("moneyline", [o("A", None, X=400), o("B", None, Y=400)])


def test_hold_just_above_floor_passes():
    # +110 / +110 ... real arb of about -4.8% hold stays valid.
    assert not suspect.is_suspect_market("moneyline", [o("A", None, X=110), o("B", None, Y=110)])


def test_odds_beyond_cap_on_spread_or_total_is_suspect():
    over = [o("Over", 220.5, X=-110, Y=-5001), o("Under", 220.5, X=-110)]
    assert suspect.is_suspect_market("totals", over)
    at_cap = [o("Over", 220.5, X=-110, Y=-5000), o("Under", 220.5, X=-110)]
    assert not suspect.is_suspect_market("totals", at_cap)


def test_cap_does_not_apply_to_moneyline():
    ml = [o("A", None, X=-6000, Y=-5500), o("B", None, X=2500, Y=2600)]
    assert not suspect.is_suspect_market("moneyline", ml)


def test_incomplete_side_without_prices_is_not_suspect_by_hold():
    assert not suspect.is_suspect_market("spreads", [o("Nets", -3.5, X=-110), o("76ers", 3.5)])


def test_arb_scanner_skips_suspect_group():
    ev = event("1", {"spreads": EXAMPLE})
    assert scan.arb_rows([ev], now=0.0) == []
    ok = event("2", {"spreads": [o("Nets", -3.5, DraftKings=105, FanDuel=-110),
                                 o("76ers", 3.5, DraftKings=-110, FanDuel=105)]})
    assert len(scan.arb_rows([ok], now=0.0)) == 1


def test_ev_scanner_skips_suspect_group():
    markets = {"spreads": [o("Nets", -3.5, Pinnacle=-10000, DraftKings=-110),
                           o("76ers", 3.5, Pinnacle=1350, DraftKings=400)]}
    assert scan.ev_rows([event("1", markets)], {"Pinnacle": 1.0}, 100.0, now=0.0) == []


def test_lowhold_endpoint_skips_suspect_group(monkeypatch):
    monkeypatch.setattr(main, "get_snapshot", lambda: [event("1", {"spreads": EXAMPLE})])
    r = TestClient(main.app).get("/api/lowhold", params={"max_hold": 1000})
    assert r.status_code == 200 and r.json() == []


def test_middles_endpoint_skips_suspect_line(monkeypatch):
    # A clean middle: Over 220.5 / Under 222.5. Then the Under side is a stale -10000-ish price.
    def totals(under_price):
        return {"totals": [o("Over", 220.5, DraftKings=-110), o("Under", 220.5, FanDuel=-110),
                           o("Over", 222.5, DraftKings=-110), o("Under", 222.5, FanDuel=under_price)]}
    client = TestClient(main.app)
    monkeypatch.setattr(main, "get_snapshot", lambda: [event("1", totals(-110))])
    assert client.get("/api/middles").json() != []
    monkeypatch.setattr(main, "get_snapshot", lambda: [event("1", totals(-9000))])
    assert client.get("/api/middles").json() == []
