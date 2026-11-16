"""The parlay same-market error must not claim "both sides" for two lines on one side."""

import pytest
from fastapi.testclient import TestClient

from backend import main


def o(name, point, **prices):
    return {"name": name, "point": point, "prices": prices}


EVENTS = [
    {"id": "g1", "sport": "NBA", "home": "A", "away": "B", "start": "t", "markets": {
        "spreads": [o("A", -3.5, DraftKings=-110), o("B", 3.5, DraftKings=-110),
                    o("A", -5.5, DraftKings=120), o("B", 5.5, DraftKings=-140)],
        "totals": [o("Over", 220.5, DraftKings=-110), o("Under", 220.5, DraftKings=-110),
                   o("Over", 225.5, DraftKings=120)]}},
]


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(main, "get_snapshot", lambda: EVENTS)
    return TestClient(main.app)


def leg(market, name, point):
    return {"event_id": "g1", "market": market, "name": name, "point": point}


@pytest.mark.parametrize("legs, detail", [
    ([leg("spreads", "A", -3.5), leg("spreads", "B", 3.5)], "Both sides of B @ A Spread are in the slip; remove one"),
    ([leg("spreads", "A", -3.5), leg("spreads", "A", -5.5)], "Two legs from B @ A Spread are in the slip; remove one"),
    ([leg("spreads", "A", -3.5), leg("spreads", "B", 5.5)], "Two legs from B @ A Spread are in the slip; remove one"),
    ([leg("totals", "Over", 220.5), leg("totals", "Over", 225.5)],
     "Two legs from B @ A Total are in the slip; remove one"),
])
def test_same_market_error_wording(client, legs, detail):
    r = client.post("/api/parlay", json={"legs": legs})
    assert r.status_code == 400
    assert r.json()["detail"] == detail
