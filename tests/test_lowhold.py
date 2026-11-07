import pytest
from fastapi.testclient import TestClient

from backend import main
from backend.engine.lowhold import best_pair, hold_pct
from backend.providers import mock


def outcome(name, point, **prices):
    return {"name": name, "point": point, "prices": prices}


def event(eid, markets, home="A", away="B"):
    return {"id": eid, "sport": "NBA", "home": home, "away": away, "start": "t", "markets": markets}


EVENTS = [
    # Best prices DraftKings +105 / FanDuel -105 -> hold ~0%. Pinnacle (non-US) must be ignored.
    event("1", {"moneyline": [outcome("A", None, DraftKings=105, BetMGM=-110, Pinnacle=200),
                              outcome("B", None, FanDuel=-105, BetMGM=-110, Pinnacle=200)]}),
    # -110 / -110 both at BetMGM -> hold ~4.5%.
    event("2", {"totals": [outcome("Over", 220.5, BetMGM=-110), outcome("Under", 220.5, BetMGM=-110)]}),
    # Three-way market: skipped.
    event("3", {"moneyline": [outcome("A", None, BetMGM=200), outcome("B", None, BetMGM=200),
                              outcome("Draw", None, BetMGM=200)]}),
]


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(main, "get_snapshot", lambda: EVENTS)
    return TestClient(main.app)


def test_best_pair_takes_best_price_per_side():
    p = best_pair({"X": -110, "Y": 105}, {"X": -110, "Z": -105}, stake=200)
    assert [(leg["book"], leg["odds"]) for leg in p["legs"]] == [("Y", 105), ("Z", -105)]
    assert p["hold_pct"] == pytest.approx(hold_pct(105, -105))
    assert sum(leg["stake"] for leg in p["legs"]) == pytest.approx(200)
    assert p["expected_loss"] == pytest.approx(200 * p["hold_pct"] / 100)


def test_best_pair_with_book_forces_one_leg_there():
    a, b = {"X": -120, "Y": 110}, {"X": 100, "Z": -105}
    p = best_pair(a, b, book="X")
    # X on side A (-120) + Z (-105) vs Y (+110) + X on side B (+100): the second is lower hold.
    assert [(leg["book"], leg["odds"]) for leg in p["legs"]] == [("Y", 110), ("X", 100)]
    assert best_pair(a, b, book="Nope") is None


def test_endpoint_sorted_ascending_and_filtered(client):
    rows = client.get("/api/lowhold", params={"max_hold": 10, "stake": 100}).json()
    assert [r["event"] for r in rows] == ["B @ A", "B @ A"]
    assert len(rows) == 2
    holds = [r["hold_pct"] for r in rows]
    assert holds == sorted(holds)
    first, second = rows
    assert [(leg["pick"], leg["book"], leg["odds"]) for leg in first["legs"]] == [("A", "DraftKings", 105), ("B", "FanDuel", -105)]
    assert second["market"] == "totals"
    assert [leg["pick"] for leg in second["legs"]] == ["Over 220.5", "Under 220.5"]
    assert second["expected_loss"] == pytest.approx(100 * second["hold_pct"] / 100)
    assert second["stake"] == 100

    assert len(client.get("/api/lowhold", params={"max_hold": 1}).json()) == 1  # default-ish cutoff drops the 4.5%
    assert client.get("/api/lowhold", params={"max_hold": 10, "market": "totals"}).json()[0]["market"] == "totals"


def test_endpoint_book_filter(client):
    rows = client.get("/api/lowhold", params={"max_hold": 10, "book": "BetMGM"}).json()
    assert rows and all("BetMGM" in {leg["book"] for leg in r["legs"]} for r in rows)
    assert [r["hold_pct"] for r in rows] == sorted(r["hold_pct"] for r in rows)
    assert client.get("/api/lowhold", params={"max_hold": 10, "book": "Caesars"}).json() == []
    assert client.get("/api/lowhold", params={"max_hold": 10, "book": ""}).json()  # empty = any book


def test_endpoint_on_mock_snapshot(monkeypatch):
    monkeypatch.setattr(main, "get_snapshot", lambda: mock.snapshot(seed=1))
    rows = TestClient(main.app).get("/api/lowhold", params={"max_hold": 100}).json()
    assert rows and [r["hold_pct"] for r in rows] == sorted(r["hold_pct"] for r in rows)
    assert all(len(r["legs"]) == 2 for r in rows)
