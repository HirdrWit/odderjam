"""Pick'em Bettable mode (#119): legs on in-play or stale props are flagged and kept out of slips."""
import time
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient

from backend import main
from backend.providers import live_config

NOW = 1_800_000_000.0


def iso(ts):
    return datetime.fromtimestamp(ts, timezone.utc).isoformat()


def prop(name, point, player, **prices):
    return {"name": name, "point": point, "player": player, "prices": prices}


def event(eid, player, start, updated_age):
    return {"id": eid, "sport": "NBA", "home": "H" + eid, "away": "A" + eid, "start": iso(start),
            "updated": {"Pinnacle": iso(NOW - updated_age), "DraftKings": iso(NOW - updated_age)},
            "markets": {"player_points": [prop("Over", 20.5, player, Pinnacle=-200, DraftKings=-190),
                                          prop("Under", 20.5, player, Pinnacle=170, DraftKings=160)]}}


@pytest.fixture
def client(monkeypatch):
    max_age = live_config()["max_price_age"]
    events = [
        event("g1", "Fresh One", NOW + 3600, 5),
        event("g2", "Fresh Two", NOW + 7200, 5),
        event("g3", "Live Guy", NOW - 600, 5),            # in play
        event("g4", "Stale Guy", NOW - 600, max_age + 500),   # in play, old prices
        # pre-game, old prices: not stale. Stale is a live-only rule, as in scan.freshness().
        event("g5", "Old Pregame", NOW + 3600, max_age + 500),
    ]
    monkeypatch.setattr(main, "get_snapshot", lambda: events)
    monkeypatch.setattr(main, "_now", lambda: NOW)
    monkeypatch.setenv("SHARP_WEIGHTS", "Pinnacle:1")
    monkeypatch.setenv("MAX_SHARP_HOLD", "6")
    return TestClient(main.app)


LINES = [{"player": n, "market": "points", "point": 20.5, "side": "Over"}
         for n in ("Fresh One", "Fresh Two", "Live Guy", "Stale Guy", "Old Pregame")]


def slip_players(body):
    return {leg["player"] for slips in body["slips"].values() for s in slips for leg in s["legs"]}


def test_legs_carry_flags(client):
    legs = {x["player"]: x for x in client.post("/api/pickem", json={"lines": LINES}).json()["legs"]}
    assert legs["Fresh One"]["flags"] == []
    assert legs["Live Guy"]["flags"] == ["in_play"]
    assert legs["Stale Guy"]["flags"] == ["in_play", "stale"]
    assert legs["Old Pregame"]["flags"] == []
    assert legs["Live Guy"]["matched"]


def test_bettable_only_leaves_flagged_legs_out_of_slips(client):
    body = client.post("/api/pickem", json={"lines": LINES, "bettable_only": True, "top": 20}).json()
    assert slip_players(body) <= {"Fresh One", "Fresh Two", "Old Pregame"}
    # flagged legs are still listed, marked
    assert {x["player"] for x in body["legs"]} == {l["player"] for l in LINES}
    assert next(x for x in body["legs"] if x["player"] == "Live Guy")["flags"] == ["in_play"]


def test_mode_off_slips_may_use_flagged_legs(client):
    body = client.post("/api/pickem", json={"lines": LINES, "top": 20}).json()
    assert {"Live Guy", "Stale Guy"} & slip_players(body)


def test_default_matches_explicit_off(client):
    a = client.post("/api/pickem", json={"lines": LINES}).json()
    b = client.post("/api/pickem", json={"lines": LINES, "bettable_only": False}).json()
    assert a == b


def test_unmatched_leg_has_empty_flags(client):
    (x,) = client.post("/api/pickem", json={"lines": [{"player": "Nobody", "market": "points", "point": 1.5}]}).json()["legs"]
    assert x["flags"] == [] and not x["matched"]
