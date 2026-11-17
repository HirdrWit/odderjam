"""'Bettable only' on alert rules (odderjam-118): flagged rows must not notify when it is on."""

import re
import shutil
import sqlite3
import subprocess
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend import alerts, db, main, providers, scan

FRONTEND = Path(__file__).resolve().parent.parent / "frontend"


def outcome(name, **prices):
    return {"name": name, "point": None, "prices": prices}


def event():
    return {"id": "e1", "sport": "NBA", "home": "A", "away": "B", "start": "t", "markets": {"moneyline": [
        outcome("A", Pinnacle=-110, DraftKings=150), outcome("B", Pinnacle=-110, FanDuel=-110)]}}


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    monkeypatch.delenv("DISCORD_WEBHOOK_URL", raising=False)
    monkeypatch.setattr(providers, "peek_snapshot", lambda: [])


@pytest.fixture
def flagged(monkeypatch):
    """Every +EV row carries the in_play flag, as the scan does for a live game."""
    real = scan.ev_rows
    monkeypatch.setattr(scan, "ev_rows", lambda *a, **k: [{**r, "flags": ["in_play"]} for r in real(*a, **k)])


def add_rule(on):
    with alerts.conn() as c:
        c.execute("INSERT INTO alert_rules (name,kind,min_value,book,market,sport,created_at,bettable) "
                  "VALUES ('r','ev',1,'','','','now',?)", (on,))


def test_bettable_rule_skips_flagged_rows(flagged):
    add_rule(1)
    assert alerts.evaluate([event()]) == []


def test_bettable_rule_still_fires_for_unflagged_rows():
    add_rule(1)
    assert len(alerts.evaluate([event()])) == 1


def test_rule_with_option_off_fires_and_records_flags(flagged):
    add_rule(0)
    (o,) = alerts.evaluate([event()])
    assert o["data"]["flags"] == ["in_play"]


def test_new_rules_default_to_on_and_false_is_kept():
    client = TestClient(main.app)
    assert client.post("/api/alerts/rules", json={"kind": "ev", "min_value": 1}).json()["bettable"] in (1, True)
    off = client.post("/api/alerts/rules", json={"kind": "ev", "min_value": 2, "bettable": False}).json()
    assert not off["bettable"]
    assert [bool(r["bettable"]) for r in client.get("/api/alerts/rules").json()] == [True, False]


def test_old_database_is_migrated_without_data_loss():
    c = sqlite3.connect(db.DB)
    c.execute("""CREATE TABLE alert_rules (
        id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, kind TEXT NOT NULL,
        min_value REAL NOT NULL DEFAULT 0, book TEXT, market TEXT, sport TEXT, created_at TEXT NOT NULL)""")
    c.execute("INSERT INTO alert_rules (name,kind,min_value,book,market,sport,created_at) "
              "VALUES ('old','arb',2.5,'FanDuel','spreads','NFL','then')")
    c.commit()
    c.close()
    rules = TestClient(main.app).get("/api/alerts/rules").json()
    assert [(r["name"], r["kind"], r["min_value"], r["book"], r["market"], r["sport"], r["created_at"])
            for r in rules] == [("old", "arb", 2.5, "FanDuel", "spreads", "NFL", "then")]
    assert not rules[0]["bettable"]
    alerts.conn().close()  # a second open must not fail on the existing column


def _alerts_body():
    src = (FRONTEND / "src" / "main.jsx").read_text()
    match = re.search(r"\nfunction Alerts\(\) \{(.*?)\n\}\n", src, re.S)
    assert match
    return match.group(1)


def test_form_has_checkbox_with_help():
    body = _alerts_body()
    assert 'type="checkbox"' in body and "form.bettable" in body
    assert "BETTABLE_HELP" in body and "alertFlagBadges" in body


@pytest.mark.skipif(shutil.which("node") is None, reason="node not installed")
def test_alert_flags_js():
    r = subprocess.run(["node", "--test", "src/alertflags.test.js"], cwd=FRONTEND, capture_output=True, text=True)
    assert r.returncode == 0, r.stdout + r.stderr
