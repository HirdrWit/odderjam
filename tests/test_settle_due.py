from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from backend import db
from backend.engine import gamehours
from backend.main import app
from backend.routes import bets

NOW = datetime(2026, 11, 10, 12, 0, tzinfo=timezone.utc)
client = TestClient(app)


def iso(dt):
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def game(gid="g1", sport="NBA", done=True):
    return {"id": gid, "sport": sport, "completed": done, "commence_time": "2026-11-10T00:00:00Z",
            "home_team": "Lakers", "away_team": "Celtics",
            "scores": [{"name": "Lakers", "score": "110"}, {"name": "Celtics", "score": "100"}] if done else None}


@pytest.fixture
def asked(monkeypatch):
    calls = []
    monkeypatch.setattr(bets, "now_dt", lambda: NOW, raising=False)
    monkeypatch.setattr(bets.providers, "get_scores", lambda sports: calls.append(sports) or [game()])
    return calls


def add(start, sport="NBA", **kw):
    body = {"pick": "Lakers", "odds": 100, "stake": 10, "sport": sport, "event": "Celtics @ Lakers",
            "event_id": "g1", "market": "moneyline"}
    if start is not None:
        body["event_start"] = iso(start)
    body.update(kw)
    r = client.post("/api/bets", json=body)
    assert r.status_code == 200, r.text
    return r.json()


def status(bid):
    return {b["id"]: b for b in client.get("/api/bets").json()}[bid]


def due_start(hours=2.5 + 0.5 + 0.1):
    return NOW - timedelta(hours=hours)


def test_shared_game_hours():
    assert gamehours.GAME_HOURS == {"NBA": 2.5, "NFL": 3.25, "MLB": 3.0, "NHL": 2.5}
    assert gamehours.game_hours("NBA") == 2.5 and gamehours.game_hours("Curling") == 3.0
    from backend.providers import kalshi
    assert kalshi.GAME_HOURS is gamehours.GAME_HOURS


def test_no_due_bets_no_request(asked):  # I1
    add(NOW - timedelta(hours=1))
    add(due_start(2.9))  # NBA: 3h needed
    r = client.post("/api/bets/settle?due=1")
    assert r.status_code == 200 and r.json() == {"checked": 0, "settled": []}
    assert asked == []


def test_due_bet_settles_only_its_sport(asked):  # I2
    b = add(due_start())
    add(due_start(), sport="NHL", pick="Bruins", event="A @ B", event_id="x")
    add(NOW - timedelta(hours=1), sport="MLB", pick="Cubs", event="C @ D", event_id="y")
    r = client.post("/api/bets/settle?due=1").json()
    assert asked == [["NBA", "NHL"]] or asked == [["NBA"]]
    assert "MLB" not in asked[0]
    assert status(b["id"])["status"] == "won"
    assert [s["id"] for s in r["settled"]] == [b["id"]]


def test_sport_default_is_three_hours(asked):
    add(NOW - timedelta(hours=3.4), sport="Curling")
    client.post("/api/bets/settle?due=1")
    assert asked == []
    add(NOW - timedelta(hours=3.6), sport="Curling")
    client.post("/api/bets/settle?due=1")
    assert asked == [["Curling"]]


def test_recently_checked_old_and_no_start_are_skipped(asked):  # I3
    recent = add(due_start())
    with db.conn() as c:
        c.execute("UPDATE bets SET last_settle_check=? WHERE id=?",
                  ((NOW - timedelta(minutes=10)).isoformat(), recent["id"]))
    add(NOW - timedelta(days=3, hours=1))
    add(None)
    client.post("/api/bets/settle?due=1")
    assert asked == []
    with db.conn() as c:
        c.execute("UPDATE bets SET last_settle_check=? WHERE id=?",
                  ((NOW - timedelta(minutes=31)).isoformat(), recent["id"]))
    client.post("/api/bets/settle?due=1")
    assert asked == [["NBA"]]


def test_not_final_stays_pending_and_records_check(asked, monkeypatch):  # I4
    monkeypatch.setattr(bets.providers, "get_scores", lambda s: asked.append(s) or [game(done=False)])
    b = add(due_start())
    r = client.post("/api/bets/settle?due=1").json()
    assert r["settled"] == [] and status(b["id"])["status"] == "pending"
    with db.conn() as c:
        assert c.execute("SELECT last_settle_check FROM bets WHERE id=?", (b["id"],)).fetchone()[0]
    client.post("/api/bets/settle?due=1")
    assert len(asked) == 1  # checked just now, not fetched again


def test_provider_error_is_quiet(monkeypatch):  # I7
    monkeypatch.setattr(bets, "now_dt", lambda: NOW, raising=False)

    def boom(sports):
        raise bets.providers.ProviderError(500)
    monkeypatch.setattr(bets.providers, "get_scores", boom)
    b = add(due_start())
    r = client.post("/api/bets/settle?due=1")
    assert r.status_code == 200 and r.json()["settled"] == []
    assert status(b["id"])["status"] == "pending"


def test_missing_key_is_quiet(monkeypatch):
    monkeypatch.setattr(bets, "now_dt", lambda: NOW, raising=False)
    monkeypatch.delenv("ODDS_API_KEY", raising=False)
    add(due_start())
    assert client.post("/api/bets/settle?due=1").status_code == 200


def test_manual_settle_unchanged(asked):  # I6
    b = add(NOW - timedelta(hours=1))
    nostart = add(None, pick="Lakers", event_id="g1")
    r = client.post("/api/bets/settle").json()
    assert r["checked"] == 2 and asked == [["NBA"]]
    assert status(b["id"])["status"] == "won" and status(nostart["id"])["status"] == "won"
