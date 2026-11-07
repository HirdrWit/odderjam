from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from backend import main
from backend.providers import mock
from backend.routes import bets
from backend.routes.filters import FilterSet
from tests.test_markets import make_outcome


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(bets, "DB", tmp_path / "t.db")
    monkeypatch.setattr(main, "get_snapshot", lambda: mock.snapshot(seed=1))
    return TestClient(main.app)


ALL_EV = {"min_ev": -100}
ALL_ARBS = {"min_profit": -100}


def test_multi_select_sports_books_markets(client):
    rows = client.get("/api/ev", params={**ALL_EV, "sports": ["NBA", "NHL"], "books": "FanDuel,BetMGM",
                                         "markets": ["totals"]}).json()
    assert rows
    assert {r["sport"] for r in rows} == {"NBA", "NHL"}
    assert {r["book"] for r in rows} == {"FanDuel", "BetMGM"}
    assert {r["market"] for r in rows} == {"totals"}
    arbs = client.get("/api/arbs", params={**ALL_ARBS, "sports": "NFL", "books": ["DraftKings", "Caesars"]}).json()
    assert arbs and {r["sport"] for r in arbs} == {"NFL"}
    assert all(leg["book"] in {"DraftKings", "Caesars"} for r in arbs for leg in r["legs"])


def test_legacy_single_params_still_work(client):
    rows = client.get("/api/ev", params={**ALL_EV, "book": "FanDuel", "market": "spreads"}).json()
    assert rows and {(r["book"], r["market"]) for r in rows} == {("FanDuel", "spreads")}


def test_odds_range(client):
    rows = client.get("/api/ev", params={**ALL_EV, "odds_min": -150, "odds_max": 120}).json()
    assert rows and all(-150 <= r["odds"] <= 120 for r in rows)
    arbs = client.get("/api/arbs", params={**ALL_ARBS, "odds_min": -130, "odds_max": 130}).json()
    assert arbs and all(-130 <= leg["odds"] <= 130 for r in arbs for leg in r["legs"])


def test_min_ev_and_min_profit(client):
    assert all(r["ev_pct"] >= 2 for r in client.get("/api/ev", params={"min_ev": 2}).json())
    assert all(r["profit_pct"] >= -3 for r in client.get("/api/arbs", params={"min_profit": -3}).json())


def test_start_within_hours(client):
    limit = datetime.now(timezone.utc) + timedelta(hours=12)
    every = client.get("/api/ev", params=ALL_EV).json()
    soon = client.get("/api/ev", params={**ALL_EV, "start_within_hours": 12}).json()
    assert 0 < len(soon) < len(every)
    assert all(datetime.fromisoformat(r["start"]) <= limit for r in soon)
    soon_arbs = client.get("/api/arbs", params={**ALL_ARBS, "start_within_hours": 12}).json()
    assert all(datetime.fromisoformat(r["start"]) <= limit for r in soon_arbs)


def test_max_sharp_hold(monkeypatch):
    # Line 1: Pinnacle -105/-105 (~2.4% hold). Line 2: Pinnacle -130/-130 (~13% hold). Line 3: no sharp price.
    ev = {"id": "x", "sport": "NBA", "home": "A", "away": "B", "start": "2026-01-01T00:00:00+00:00",
          "markets": {"totals": [
              make_outcome("Over", 220.5, Pinnacle=-105, DraftKings=110),
              make_outcome("Under", 220.5, Pinnacle=-105, FanDuel=105),
              make_outcome("Over", 221.5, Pinnacle=-130, DraftKings=110),
              make_outcome("Under", 221.5, Pinnacle=-130, FanDuel=105),
              make_outcome("Over", 222.5, DraftKings=110), make_outcome("Under", 222.5, FanDuel=105)]}}
    monkeypatch.setattr(main, "get_snapshot", lambda: [ev])
    c = TestClient(main.app)
    rows = c.get("/api/ev", params={**ALL_EV, "max_sharp_hold": 5}).json()
    assert {r["point"] for r in rows} == {220.5}
    arbs = c.get("/api/arbs", params={**ALL_ARBS, "max_sharp_hold": 5}).json()
    assert {r["point"] for r in arbs} == {220.5}
    assert {r["point"] for r in c.get("/api/arbs", params=ALL_ARBS).json()} == {220.5, 221.5, 222.5}


def test_filterset_start_handles_bad_and_naive_times():
    f = FilterSet(start_within_hours=1)
    now = datetime(2026, 1, 1, tzinfo=timezone.utc)
    assert not f.start_ok("not a date", now)
    assert f.start_ok("2026-01-01T00:30:00", now)  # naive is treated as UTC
    assert not f.start_ok("2026-01-01T02:00:00Z", now)
    assert FilterSet().start_ok("anything")


def test_presets_crud(client):
    body = {"name": "NBA totals", "filters": {"sports": ["NBA"], "markets": ["totals"], "min_ev": 1.5}}
    p = client.post("/api/filters", json=body).json()
    assert p["name"] == "NBA totals" and p["filters"]["sports"] == ["NBA"] and p["filters"]["min_ev"] == 1.5
    assert client.post("/api/filters", json=body).status_code == 409
    assert [x["id"] for x in client.get("/api/filters").json()] == [p["id"]]
    assert client.get(f"/api/filters/{p['id']}").json() == p

    body["filters"]["books"] = ["FanDuel"]
    up = client.put(f"/api/filters/{p['id']}", json={**body, "name": "NBA totals FD"}).json()
    assert up["name"] == "NBA totals FD" and up["filters"]["books"] == ["FanDuel"]
    assert client.put("/api/filters/999", json=body).status_code == 404

    assert client.delete(f"/api/filters/{p['id']}").json() == {"ok": True}
    assert client.delete(f"/api/filters/{p['id']}").status_code == 404
    assert client.get(f"/api/filters/{p['id']}").status_code == 404
    assert client.get("/api/filters").json() == []


def test_preset_applies_to_ev_and_arbs_and_params_override(client):
    p = client.post("/api/filters", json={"name": "p", "filters": {
        "sports": ["NBA"], "markets": ["totals"], "min_ev": -100, "min_profit": -100}}).json()
    rows = client.get("/api/ev", params={"preset": p["id"]}).json()
    assert rows and {(r["sport"], r["market"]) for r in rows} == {("NBA", "totals")}
    arbs = client.get("/api/arbs", params={"preset": p["id"]}).json()
    assert arbs and {(r["sport"], r["market"]) for r in arbs} == {("NBA", "totals")}
    over = client.get("/api/ev", params={"preset": p["id"], "sports": "NFL"}).json()
    assert over and {(r["sport"], r["market"]) for r in over} == {("NFL", "totals")}
    assert client.get("/api/ev", params={"preset": 999}).status_code == 404
