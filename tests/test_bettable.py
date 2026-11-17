"""Bettable mode backend (odderjam-114): flags on +EV rows and the bettable filter."""
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient

from backend import main, providers
from backend.engine import bettable

NOW = datetime(2026, 11, 15, 20, 0, tzinfo=timezone.utc).timestamp()


def iso(ts):
    return datetime.fromtimestamp(ts, timezone.utc).isoformat()


def ctx(**over):
    base = {"market": "moneyline", "odds": -110, "ev_pct": 3.0, "worst_ev_pct": 2.0, "is_live": False,
            "live_enabled": False, "max_price_age": 60.0, "price_age": 5.0,
            "update_times": {"DraftKings": NOW, "Pinnacle": NOW}, "sharp_probs": [0.5]}
    return {**base, **over}


def flags(**over):
    return bettable.flags(ctx(**over), bettable.DEFAULT_PROFILE)


# ---- I1: unit tests per flag -------------------------------------------------------------

def test_clean_pregame_line_has_no_flags():
    assert flags() == []


def test_longshot():
    assert "longshot" in flags(odds=300)
    assert "longshot" not in flags(odds=250)


def test_heavy_fav():
    assert "heavy_fav" in flags(odds=-300)
    assert "heavy_fav" not in flags(odds=-250)


def test_too_good_game_line_and_prop_ceilings():
    assert "too_good" in flags(ev_pct=9.0)
    assert "too_good" not in flags(ev_pct=8.0)
    assert "too_good" not in flags(ev_pct=10.0, market="player_points")
    assert "too_good" in flags(ev_pct=13.0, market="player_points")


def test_fragile_when_worst_case_devig_is_below_min_ev():
    assert "fragile" in flags(worst_ev_pct=-0.5)
    assert "fragile" not in flags(worst_ev_pct=0.5)


def test_sharps_disagree_needs_two_sharps_over_spread():
    assert "sharps_disagree" in flags(sharp_probs=[0.50, 0.54])
    assert "sharps_disagree" not in flags(sharp_probs=[0.50, 0.52])
    assert "sharps_disagree" not in flags(sharp_probs=[0.50])


def test_every_flag_has_a_plain_english_label():
    for f in ("in_play", "longshot", "heavy_fav", "too_good", "fragile", "sharps_disagree"):
        assert bettable.LABELS[f].strip()


# ---- I2: in-play exemption ---------------------------------------------------------------

def live(**over):
    return flags(is_live=True, live_enabled=True, **over)


def test_live_with_live_mode_off_is_in_play():
    assert "in_play" in flags(is_live=True, live_enabled=False)


def test_live_mode_on_fresh_and_in_sync_is_not_in_play():
    assert "in_play" not in live()
    assert "in_play" not in live(update_times={"DraftKings": NOW, "Pinnacle": NOW - 20})


def test_live_mode_on_but_skewed_is_in_play():
    assert "in_play" in live(update_times={"DraftKings": NOW, "Pinnacle": NOW - 21})


def test_live_mode_on_but_stale_or_untimed_is_in_play():
    assert "in_play" in live(price_age=61.0)
    assert "in_play" in live(price_age=None)
    assert "in_play" in live(update_times={"DraftKings": NOW, "Pinnacle": None})


# ---- I3 ----------------------------------------------------------------------------------

def test_plus_550_at_20_pct_is_longshot_and_too_good():
    got = flags(odds=550, ev_pct=20.0)
    assert "longshot" in got and "too_good" in got


# ---- endpoint ----------------------------------------------------------------------------

def ml(a, b):
    return {"moneyline": [{"name": "A", "point": None, "prices": a}, {"name": "B", "point": None, "prices": b}]}


def event(eid, start_ts, markets):
    stamp = iso(NOW - 5)
    return {"id": eid, "sport": "NBA", "home": "A", "away": "B", "start": iso(start_ts), "markets": markets,
            "updated": {"DraftKings": stamp, "Pinnacle": stamp}}


EVENTS = [
    # clean: fair 50%, DK +105 -> 2.5% EV
    event("clean", NOW + 7200, ml({"Pinnacle": -110, "DraftKings": 105}, {"Pinnacle": -110, "DraftKings": -140})),
    # same prices but already started
    event("inplay", NOW - 3600, ml({"Pinnacle": -110, "DraftKings": 105}, {"Pinnacle": -110, "DraftKings": -140})),
    # longshot: fair ~18.4%, DK +550 -> ~19% EV
    event("long", NOW + 7200, ml({"Pinnacle": 430, "DraftKings": 550}, {"Pinnacle": -520, "DraftKings": -1000})),
]


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(main, "get_snapshot", lambda: EVENTS)
    monkeypatch.setattr(main, "_now", lambda: NOW)
    providers.reset_live()
    yield TestClient(main.app)
    providers.reset_live()


def by_event(rows):
    return {r["event_id"]: r for r in rows}


def test_ev_rows_always_carry_flags(client):
    rows = by_event(client.get("/api/ev").json())
    assert rows["clean"]["flags"] == []
    assert "in_play" in rows["inplay"]["flags"]
    assert {"longshot", "too_good"} <= set(rows["long"]["flags"])


def test_bettable_true_returns_only_unflagged_rows(client):
    rows = client.get("/api/ev", params={"bettable": "true"}).json()
    assert rows and all(r["flags"] == [] for r in rows)
    assert {r["event_id"] for r in rows} == {"clean"}


def test_threshold_override_changes_flags(client):
    rows = by_event(client.get("/api/ev", params={"bettable_odds_max": 600, "ev_ceiling": 25,
                                                  "prop_ev_ceiling": 25}).json())
    assert "longshot" not in rows["long"]["flags"] and "too_good" not in rows["long"]["flags"]


# ---- I5 ----------------------------------------------------------------------------------

def test_preset_with_bettable_round_trips_and_applies(client):
    p = client.post("/api/filters", json={"name": "b", "filters": {"bettable": True}}).json()
    assert p["filters"]["bettable"] is True
    assert client.get(f"/api/filters/{p['id']}").json()["filters"]["bettable"] is True
    rows = client.get("/api/ev", params={"preset": p["id"]}).json()
    assert rows and all(r["flags"] == [] for r in rows)


def test_bettable_defaults_off_in_presets(client):
    p = client.post("/api/filters", json={"name": "n", "filters": {}}).json()
    assert p["filters"]["bettable"] is False


# ---- I6 ----------------------------------------------------------------------------------

@pytest.mark.parametrize("params", [
    {"bettable_odds_min": 300, "bettable_odds_max": -300},
    {"ev_ceiling": -1},
    {"prop_ev_ceiling": -1},
    {"ev_ceiling": "nan"},
    {"max_skew_seconds": -5},
    {"max_skew_seconds": "inf"},
    {"max_sharp_spread": "nan"},
    {"max_sharp_spread": -0.01},
    {"bettable_odds_min": "nan"},
])
def test_bad_threshold_params_are_422(client, params):
    r = client.get("/api/ev", params={"bettable": "true", **params})
    assert r.status_code == 422, r.text
