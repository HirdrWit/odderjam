"""Price history and sharp line movement for any market (odderjam-135)."""
import socket
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend import history, main
from backend.providers import mock

NOW = datetime(2026, 11, 8, 12, 0, tzinfo=timezone.utc)
SRC = Path(__file__).resolve().parent.parent / "frontend" / "src"


def ago(minutes):
    return NOW - timedelta(minutes=minutes)


def total_snap(pin_over, pin_under, fd_over=-105):
    return [{"id": "e1", "sport": "NBA", "home": "H", "away": "A", "start": NOW.isoformat(),
             "markets": {"totals": [
                 {"name": "Over", "point": 220.5, "prices": {"Pinnacle": pin_over, "FanDuel": fd_over}},
                 {"name": "Under", "point": 220.5, "prices": {"Pinnacle": pin_under, "FanDuel": -115}},
                 {"name": "Over", "point": 221.5, "prices": {"Pinnacle": 100}},
                 {"name": "Under", "point": 221.5, "prices": {"Pinnacle": -120}}]}}]


def prop_snap(a_price, b_price):
    def side(player, price):
        return [{"name": "Over", "point": 24.5, "player": player, "prices": {"Pinnacle": price, "FanDuel": price}},
                {"name": "Under", "point": 24.5, "player": player, "prices": {"Pinnacle": -price, "FanDuel": -price}}]
    return [{"id": "e1", "sport": "NBA", "home": "H", "away": "A", "start": NOW.isoformat(),
             "markets": {"player_points": side("Ann", a_price) + side("Bob", b_price)}}]


def ev_row(selection="Over", odds_=-105, market="totals", point=220.5, player=None):
    return {"event_id": "e1", "market": market, "point": point, "player": player, "selection": selection,
            "book": "FanDuel", "odds": odds_, "sharps": [{"book": "Pinnacle", "weight": 1, "hold_pct": 4.0}]}


@pytest.fixture
def client():
    return TestClient(main.app)


def test_history_returns_a_totals_line(client):  # AC1 / I1
    history.record(total_snap(-110, -110), ago(30))
    rows = client.get("/api/history/e1", params={"market": "totals", "point": 220.5}).json()
    assert rows and {r["point"] for r in rows} == {220.5}
    assert {r["book"] for r in rows} == {"Pinnacle", "FanDuel"}


def test_history_returns_one_players_prop(client):  # AC1 / I1
    history.record(prop_snap(-110, 120), ago(30))
    rows = client.get("/api/history/e1", params={"market": "player_points", "point": 24.5, "player": "Ann"}).json()
    assert rows and {r["player"] for r in rows} == {"Ann"}
    assert len(rows) == 4  # Over/Under x Pinnacle/FanDuel
    assert history.history("e1", "player_points", point=24.5, player="Bob")[0]["player"] == "Bob"


def test_history_without_filters_still_returns_the_market(client):  # AC1
    history.record(total_snap(-110, -110), ago(30))
    assert len(client.get("/api/history/e1?market=totals").json()) == 6


def test_sharp_move_positive_when_sharp_fair_prob_rose():  # AC2 / I2
    history.record(total_snap(-110, -110), ago(90))
    history.record(total_snap(-140, 120), ago(5))
    [over] = history.annotate([ev_row("Over")], now=NOW)
    [under] = history.annotate([ev_row("Under", -115)], now=NOW)
    assert over["sharp_move"] > 5  # 50% -> about 56%
    assert under["sharp_move"] == pytest.approx(-over["sharp_move"], abs=0.5)


def test_sharp_move_ignores_other_players_and_lines():  # AC2
    history.record(prop_snap(-110, -110), ago(90))
    history.record(prop_snap(-150, -110), ago(5))
    [ann] = history.annotate([ev_row("Over", -150, "player_points", 24.5, "Ann")], now=NOW)
    [bob] = history.annotate([ev_row("Over", -110, "player_points", 24.5, "Bob")], now=NOW)
    assert ann["sharp_move"] > 5
    assert abs(bob["sharp_move"]) < 0.5


def test_sharp_move_is_none_without_history():  # AC2
    [row] = history.annotate([ev_row()], now=NOW)
    assert row["sharp_move"] is None and row["price_age_minutes"] is None


def test_price_age_minutes_counts_since_the_price_last_changed():  # AC3
    history.record(total_snap(-110, -110, fd_over=-115), ago(120))
    for m in (90, 45, 5):
        history.record(total_snap(-110, -110, fd_over=-105), ago(m))
    [row] = history.annotate([ev_row(odds_=-105)], now=NOW)
    assert row["price_age_minutes"] == pytest.approx(85, abs=0.5)


def test_ev_rows_carry_movement_fields(monkeypatch, client):  # AC3
    monkeypatch.setattr(main, "get_snapshot", lambda: mock.snapshot(seed=1))
    rows = client.get("/api/ev", params={"min_ev": -100}).json()
    assert rows and all({"sharp_move", "price_age_minutes"} <= r.keys() for r in rows)


def test_movement_reads_only_the_local_store(monkeypatch, client):  # AC5 / I4
    history.record(total_snap(-110, -110), ago(30))

    def no_network(*a, **k):
        raise AssertionError("network used")
    monkeypatch.setattr(socket.socket, "connect", no_network)
    assert client.get("/api/history/e1?market=totals&point=220.5").json()
    assert history.annotate([ev_row()], now=NOW)


def test_ev_table_has_a_history_action():  # AC4 / I3
    src = (SRC / "main.jsx").read_text()
    assert "linemove.js" in src and "History" in src
    assert "MoveChart" in (SRC / "OddsScreen.jsx").read_text()
