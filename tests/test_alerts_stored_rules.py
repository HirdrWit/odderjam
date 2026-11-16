"""Rules saved before min_value was validated are dropped (odderjam-46 review)."""

import pytest
from fastapi.testclient import TestClient

from backend import alerts, db, main, providers


def insert_rule(min_value, name="r"):
    c = db.conn()
    alerts.conn().close()  # create the tables
    with c:
        c.execute("INSERT INTO alert_rules (name,kind,min_value,book,market,sport,created_at) "
                  "VALUES (?,?,?,?,?,?,?)", (name, "ev", min_value, "", "", "", "now"))
    c.close()


@pytest.fixture
def client(monkeypatch):
    monkeypatch.delenv("DISCORD_WEBHOOK_URL", raising=False)
    monkeypatch.setattr(providers, "peek_snapshot", lambda: [])
    return TestClient(main.app, raise_server_exceptions=False)


def test_stored_invalid_rules_are_dropped_and_list_loads(client):
    for value, name in [(float("inf"), "inf"), (float("-inf"), "-inf"), (-5.0, "neg"), (0.0, "zero"), (2.5, "ok")]:
        insert_rule(value, name)
    r = client.get("/api/alerts/rules")
    assert r.status_code == 200
    assert [(x["name"], x["min_value"]) for x in r.json()] == [("zero", 0.0), ("ok", 2.5)]


def test_stored_negative_rule_does_not_alert(client):
    insert_rule(-50.0)
    # -300 vs a fair even-money line is about -33% EV: only a negative threshold matches it.
    events = [{"id": "e1", "sport": "NBA", "home": "A", "away": "B", "start": "t", "markets": {"moneyline": [
        {"name": "A", "point": None, "prices": {"Pinnacle": -110, "DraftKings": -300}},
        {"name": "B", "point": None, "prices": {"Pinnacle": -110, "FanDuel": -300}}]}}]
    assert alerts.evaluate(events) == []
