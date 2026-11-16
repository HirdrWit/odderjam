"""Regression tests for review findings on the pick'em optimizer (odderjam-18)."""
import time

from fastapi.testclient import TestClient

from backend import main
from backend.engine import pickem


def leg(player, event_id, prob):
    return {"player": player, "event_id": event_id, "prob": prob}


def test_pool_not_filled_by_one_event():
    # Twelve strong legs from one game must not crowd out the only leg from another game.
    legs = [leg(f"P{i}", "g1", 0.70) for i in range(12)] + [leg("Q", "g2", 0.60)]
    slips = pickem.best_slips(legs, 2, {2: 3.0}, top=1)
    assert slips and "Q" in {x["player"] for x in slips[0]["legs"]}


def test_pool_not_filled_by_one_player():
    # Many props on one player count once, so lower-ranked players still make the pool.
    legs = [leg("A", f"e{i}", 0.70 - i * 0.001) for i in range(12)] + [leg("B", "x", 0.55), leg("C", "y", 0.54)]
    slips = pickem.best_slips(legs, 3, {3: 5.0}, top=1)
    assert slips and {x["player"] for x in slips[0]["legs"]} == {"A", "B", "C"}
    assert max(x["prob"] for x in slips[0]["legs"]) == 0.70  # A's best leg is kept


def _snapshot(n_events=150, players=20):
    def o(name, point, player):
        return {"name": name, "point": point, "player": player, "prices": {"DraftKings": -110, "FanDuel": -110}}
    return [{"id": f"e{i}", "sport": "NBA", "home": "H", "away": "A", "start": "t", "markets": {
        f"player_m{m}": [o(side, pt, f"p{i}-{j}") for j in range(players) for pt in (1.5, 2.5, 3.5)
                         for side in ("Over", "Under")] for m in range(8)}} for i in range(n_events)]


def test_many_lines_on_a_big_snapshot_stay_fast(monkeypatch):
    events = _snapshot()
    monkeypatch.setattr(main, "get_snapshot", lambda: events)
    lines = [{"player": f"nobody{i}", "market": "m0", "point": 1.5} for i in range(200)]
    start = time.perf_counter()
    r = TestClient(main.app).post("/api/pickem", json={"lines": lines, "sizes": [2]})
    assert r.status_code == 200
    assert time.perf_counter() - start < 3  # was ~18 s when every line rescanned the whole snapshot


def test_weaker_leg_kept_when_payouts_fall_with_hits():
    # A table paying more for 1 hit than 2: A's weaker leg makes the best slip, so it must not be dropped.
    legs = [leg("A", "g1", 0.9), leg("A", "g1", 0.5), leg("B", "g2", 0.9)]
    best = pickem.best_slips(legs, 2, {2: 0.0, 1: 5.0}, top=1)[0]
    assert sorted(x["prob"] for x in best["legs"]) == [0.5, 0.9]
