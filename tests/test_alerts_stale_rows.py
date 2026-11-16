"""Stale alert rows are cleaned up and the Alerts tab explains itself (odderjam-79)."""

import re
import shutil
import subprocess
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend import alerts, db, main, providers

FRONTEND = Path(__file__).resolve().parent.parent / "frontend"


def add_rule(c, min_value, name="r"):
    return c.execute("INSERT INTO alert_rules (name,kind,min_value,book,market,sport,created_at) "
                     "VALUES (?,?,?,?,?,?,?)", (name, "arb", min_value, "", "", "", "now")).lastrowid


def add_opp(c, key, rule_id, value=1.0, title="Arb"):
    c.execute("INSERT INTO opportunities (key,created_at,rule_id,rule_name,kind,title,value,data) "
              "VALUES (?,?,?,?,?,?,?,?)", (key, "now", rule_id, "r", "arb", title, value, "{}"))


@pytest.fixture
def client(monkeypatch):
    monkeypatch.delenv("DISCORD_WEBHOOK_URL", raising=False)
    monkeypatch.setattr(providers, "peek_snapshot", lambda: [])
    return TestClient(main.app, raise_server_exceptions=False)


def seed():
    alerts.conn().close()
    c = db.conn()
    with c:
        bad = add_rule(c, -500.0, "Arb >= -500%")
        good = add_rule(c, 1.0, "good")
        add_opp(c, "k1", bad, 5.0, "Nuggets Player 2 from the dropped rule")
        add_opp(c, "k2", None, 5.0, "orphan with no rule")
        add_opp(c, "k3", 9999, 5.0, "orphan with a deleted rule")
        add_opp(c, "k4", good, -1.83, "negative arb")
        add_opp(c, "k5", good, 2.0, "real arb")
    c.close()


def test_stale_rows_dropped_real_rows_kept(client):
    seed()
    items = client.get("/api/alerts").json()["items"]
    assert [i["title"] for i in items] == ["real arb"]


def test_deleting_a_rule_keeps_nothing_orphaned(client):
    seed()
    client.get("/api/alerts")
    c = db.conn()
    c.execute("DELETE FROM alert_rules")
    c.commit()
    c.close()
    assert client.get("/api/alerts").json()["items"] == []


@pytest.mark.skipif(shutil.which("node") is None, reason="node not installed")
def test_alerts_empty_js():
    r = subprocess.run(["node", "--test", "src/alertsempty.test.js"], cwd=FRONTEND, capture_output=True, text=True)
    assert r.returncode == 0, r.stdout + r.stderr


def _alerts_body():
    m = re.search(r"\nfunction Alerts\(\) \{(.*?)\n\}\n", (FRONTEND / "src/main.jsx").read_text(), re.S)
    return m.group(1)


def test_alerts_renders_empty_state_and_optional_note():
    body = _alerts_body()
    assert "alertsEmptyText(" in body
    assert "optional" in body
