import sqlite3
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from backend import db, history
from backend.engine import devig, odds
from backend.main import app

START = datetime(2026, 11, 8, 18, 0, tzinfo=timezone.utc)


def snap(fd_home, pin_home, pin_away, fd_away=-120):
    return [{"id": "evt1", "sport": "NFL", "home": "Chiefs", "away": "Bills", "start": START.isoformat(),
             "markets": {"moneyline": {"FanDuel": {"home": fd_home, "away": fd_away},
                                       "Pinnacle": {"home": pin_home, "away": pin_away}}}}]


@pytest.fixture
def client():
    return TestClient(app)


def track(client, **kw):
    bet = {"event": "Bills @ Chiefs", "sport": "NFL", "pick": "Chiefs", "book": "FanDuel", "odds": 120,
           "stake": 10, "event_id": "evt1", "market": "moneyline", "outcome": "home",
           "event_start": START.isoformat().replace("+00:00", "Z"), **kw}
    return client.post("/api/bets", json=bet).json()


def test_closing_odds_captured_from_last_pre_start_snapshot(client):
    history.record(snap(120, 105, -115), START - timedelta(hours=5))
    history.record(snap(110, 100, -110), START - timedelta(minutes=10))  # the close
    history.record(snap(-150, -200, 170), START + timedelta(minutes=30))  # live, must be ignored
    bet = track(client)

    assert history.capture_closing(now=START - timedelta(minutes=1)) == 0  # not started yet
    with db.conn() as c:
        assert c.execute("SELECT closing_odds FROM bets").fetchone()[0] is None

    assert history.capture_closing(now=START + timedelta(minutes=1)) == 1
    got = next(b for b in client.get("/api/bets").json() if b["id"] == bet["id"])
    assert got["closing_odds"] == 110
    assert got["clv_pct"] == pytest.approx((2.2 / 2.1 - 1) * 100)
    fair = devig.multiplicative([odds.american_to_prob(100), odds.american_to_prob(-110)])[0]
    assert got["closing_sharp_odds"] == pytest.approx(odds.prob_to_american(fair))
    assert got["clv_sharp_pct"] == pytest.approx((2.2 * fair - 1) * 100)
    assert client.get("/api/bets/stats").json()["avg_clv_sharp_pct"] == pytest.approx(got["clv_sharp_pct"])


def test_capture_runs_on_list_and_keeps_manual_close(client):
    past = datetime.now(timezone.utc) - timedelta(hours=1)
    ev = snap(130, 110, -120)
    history.record(ev, past - timedelta(hours=2))
    auto = track(client, event_start=past.isoformat())
    manual = track(client, event_start=past.isoformat(), closing_odds=125)
    rows = {b["id"]: b for b in client.get("/api/bets").json()}
    assert rows[auto["id"]]["closing_odds"] == 130
    assert rows[manual["id"]]["closing_odds"] == 125  # never overwritten
    assert rows[manual["id"]]["closing_sharp_odds"] is not None


def test_bet_without_event_link_is_left_alone(client):
    history.record(snap(130, 110, -120), START - timedelta(hours=1))
    client.post("/api/bets", json={"pick": "Chiefs", "book": "FanDuel", "odds": 120, "stake": 10})
    assert history.capture_closing(now=START + timedelta(days=1)) == 0


def test_history_endpoint_and_pruning(client, monkeypatch):
    monkeypatch.setenv("ODDS_HISTORY_DAYS", "1")
    history.record(snap(120, 105, -115), START - timedelta(days=3))
    history.record(snap(110, 100, -110), START - timedelta(hours=2))
    rows = client.get("/api/history/evt1?market=moneyline").json()
    assert len(rows) == 4  # the 3-day-old snapshot was pruned
    assert {(r["book"], r["outcome"]) for r in rows} == {("FanDuel", "home"), ("FanDuel", "away"),
                                                          ("Pinnacle", "home"), ("Pinnacle", "away")}
    assert next(r for r in rows if r["book"] == "FanDuel" and r["outcome"] == "home")["price"] == 110
    assert client.get("/api/history/evt1?market=spreads").json() == []


def test_fetches_are_recorded_and_ev_rows_carry_links(client):
    events = client.get("/api/odds").json()
    assert client.get(f"/api/history/{events[0]['id']}").json()  # mock snapshot was stored
    r = client.get("/api/ev?book=&min_ev=-100").json()[0]
    assert {"event_id", "market", "outcome", "start"} <= r.keys()


def test_old_database_gets_new_columns(tmp_path, monkeypatch):
    path = tmp_path / "old.db"
    old = sqlite3.connect(path)
    old.execute("CREATE TABLE bets (id INTEGER PRIMARY KEY AUTOINCREMENT, placed_at TEXT NOT NULL, event TEXT, "
                "sport TEXT, market TEXT DEFAULT 'moneyline', pick TEXT NOT NULL, book TEXT, odds REAL NOT NULL, "
                "stake REAL NOT NULL, status TEXT NOT NULL DEFAULT 'pending', closing_odds REAL, ev_pct REAL, "
                "notes TEXT)")
    old.commit()
    old.close()
    monkeypatch.setattr(db, "DB", path)
    with db.conn() as c:
        cols = {r["name"] for r in c.execute("PRAGMA table_info(bets)")}
    assert {"event_id", "outcome", "point", "event_start", "closing_sharp_odds"} <= cols
