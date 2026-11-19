"""Hide a +EV row, and hide rows already in the Tracker (odderjam-133)."""

import re
import shutil
import subprocess
from datetime import datetime
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend import alerts, main, providers, scan
from backend.providers import mock

FRONTEND = Path(__file__).resolve().parent.parent / "frontend"
KEY_FIELDS = ("event_id", "market", "player", "point", "pick", "book")


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(main, "get_snapshot", lambda: mock.snapshot(seed=1))
    monkeypatch.delenv("DISCORD_WEBHOOK_URL", raising=False)
    return TestClient(main.app)


def ev(client, **params):
    return client.get("/api/ev", params={"min_ev": -100, **params}).json()


def key_of(row):
    return {k: row[k] for k in KEY_FIELDS}


def ident(row):
    return tuple(row[k] for k in KEY_FIELDS)


def hide(client, row, start=None):
    return client.post("/api/hidden", json={**key_of(row), "start": start or row["start"]})


def track(client, row):
    r = client.post("/api/bets", json={
        "event": row["event"], "event_id": row["event_id"], "sport": row["sport"], "market": row["market"],
        "pick": row["pick"], "selection": row["selection"], "point": row["point"], "book": row["book"],
        "odds": row["odds"], "stake": 10, "strategy": "ev", "event_start": row["start"]})
    assert r.status_code == 200, r.text


def test_hide_removes_row_and_delete_restores_it(client):  # AC1 / I1
    rows = ev(client)
    target = rows[0]
    assert hide(client, target).status_code == 200
    assert ident(target) not in {ident(r) for r in ev(client)}
    r = client.delete("/api/hidden", params=key_of(target))
    assert r.status_code == 200
    assert ident(target) in {ident(r) for r in ev(client)}


def test_hide_is_idempotent_and_only_hides_that_row(client):
    rows = ev(client)
    hide(client, rows[0])
    assert hide(client, rows[0]).status_code == 200
    assert len(ev(client)) == len(rows) - 1


def test_hide_rejects_missing_key_fields(client):
    assert client.post("/api/hidden", json={"event_id": "x"}).status_code == 422


def test_show_hidden_returns_row_marked_hidden(client):
    target = ev(client)[0]
    hide(client, target)
    shown = {ident(r): r for r in ev(client, show_hidden="true")}
    assert shown[ident(target)]["hidden"] == "hidden"


def test_tracked_row_is_left_out_unless_show_hidden(client):  # AC2 / I2
    target = ev(client)[0]
    track(client, target)
    assert ident(target) not in {ident(r) for r in ev(client)}
    shown = {ident(r): r for r in ev(client, show_hidden="true")}
    assert shown[ident(target)]["hidden"] == "tracked"
    assert all(r.get("hidden") is None for k, r in shown.items() if k != ident(target))


def test_hidden_entries_expire_at_event_start(client, monkeypatch):  # AC3 / I3
    target = ev(client)[0]
    start = "2030-01-01T00:00:00Z"
    t0 = datetime.fromisoformat(start.replace("Z", "+00:00")).timestamp()
    hide(client, target, start=start)
    monkeypatch.setattr(main, "_now", lambda: t0 - 3600)
    assert ident(target) not in {ident(r) for r in ev(client)}
    monkeypatch.setattr(main, "_now", lambda: t0 + 1)
    assert ident(target) in {ident(r) for r in ev(client)}


def test_summary_and_show_hidden_js():  # AC4 / I4
    if shutil.which("node") is None:
        pytest.fail("node missing")
    r = subprocess.run(["node", "--test", "hiddenrows.test.js"], cwd=FRONTEND / "src", capture_output=True, text=True)
    assert r.returncode == 0, r.stdout + r.stderr


def test_main_wires_hide_unhide_and_show_hidden():
    src = (FRONTEND / "src" / "main.jsx").read_text()
    assert "/api/hidden" in src
    assert "Unhide" in src and "Hide" in src
    assert "show_hidden" in src
    assert re.search(r"Show hidden", src)


def _event():
    def o(name, **p):
        return {"name": name, "point": None, "prices": p}
    return {"id": "e1", "sport": "NBA", "home": "A", "away": "B", "start": "2030-01-01T00:00:00Z", "markets": {
        "moneyline": [o("A", Pinnacle=-110, DraftKings=150), o("B", Pinnacle=-110, FanDuel=-110)]}}


def _rule():
    with alerts.conn() as c:
        c.execute("INSERT INTO alert_rules (name,kind,min_value,book,market,sport,created_at,bettable) "
                  "VALUES ('r','ev',1,'','','','now',0)")


def test_alert_does_not_fire_for_hidden_row(client, monkeypatch):  # AC5 / I5
    monkeypatch.setattr(providers, "peek_snapshot", lambda: [])
    _rule()
    (row,) = [r for r in scan.ev_rows([_event()], {"Pinnacle": 1.0}, 10, min_ev=1)]
    assert hide(client, row).status_code == 200
    assert alerts.evaluate([_event()]) == []
    client.delete("/api/hidden", params=key_of(row))
    assert len(alerts.evaluate([_event()])) == 1
