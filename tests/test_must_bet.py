"""'Must bet' badge for +EV rows that pass every check (odderjam-137)."""
import re
import shutil
import subprocess
from datetime import datetime, timezone
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend import alerts, main, providers, scan
from backend.engine import bettable

NOW = datetime(2026, 11, 15, 20, 0, tzinfo=timezone.utc).timestamp()
FRONTEND = Path(__file__).resolve().parent.parent / "frontend"
P = bettable.DEFAULT_PROFILE


def row(**over):
    base = {"flags": [], "odds": -110, "worst_ev_pct": 3.0, "book": "DraftKings",
            "sharps": [{"book": "Pinnacle"}, {"book": "Circa Sports"}], "sharp_hold_pct": 4.0,
            "arb_backed": False}
    return {**base, **over}


def test_defaults_in_profile():  # AC5
    assert P["must_bet_min_ev"] == 2.0
    assert (P["must_bet_odds_min"], P["must_bet_odds_max"]) == (-200.0, 200.0)
    assert P["must_bet_max_hold"] == 5.0


def test_clean_row_is_a_must_bet():  # AC1 / I1
    r = bettable.must_bet(row(), P)
    assert r["must_bet"] is True and r["reasons"] and r["missing"] is not None


@pytest.mark.parametrize("over,check", [
    ({"flags": ["longshot"]}, "flags"),
    ({"worst_ev_pct": 1.9}, "worst_ev"),
    ({"odds": -201}, "odds"),
    ({"odds": 201}, "odds"),
    ({"sharps": [{"book": "Pinnacle"}]}, "sharps"),
    ({"sharp_hold_pct": 5.1}, "hold"),
    ({"book": "Kalshi", "flags": ["sharp_counterparty"]}, "counterparty"),
])
def test_each_failed_check_names_itself(over, check):  # AC2 / I2
    r = bettable.must_bet(row(**over), P)
    assert r["must_bet"] is False
    assert any(x.startswith(f"{check}:") for x in r["reasons"]), r["reasons"]


def test_boundaries_pass():  # AC2
    assert bettable.must_bet(row(worst_ev_pct=2.0, odds=200, sharp_hold_pct=5.0), P)["must_bet"] is True
    assert bettable.must_bet(row(odds=-200), P)["must_bet"] is True


def test_thresholds_come_from_profile():  # AC5
    assert bettable.must_bet(row(worst_ev_pct=1.0), {**P, "must_bet_min_ev": 0.5})["must_bet"] is True
    assert bettable.must_bet(row(odds=-150), {**P, "must_bet_odds_min": -120})["must_bet"] is False


def test_missing_inputs_skip_and_are_listed():  # AC3
    r = row()
    del r["worst_ev_pct"]
    out = bettable.must_bet(r, P)
    assert out["must_bet"] is True and "worst_ev" in out["missing"]
    ex = bettable.must_bet(row(book="Kalshi"), P)
    assert ex["must_bet"] is True and "sharp_counterparty" in ex["missing"]
    assert "sharp_movement" in bettable.must_bet(row(), P)["missing"]


def test_bonus_reasons_are_listed_not_required():  # AC3
    base = bettable.must_bet(row(), P)["reasons"]
    out = bettable.must_bet(row(arb_backed=True, sharp_move="toward"), P)
    assert out["must_bet"] is True
    assert any(x.startswith("arb_backed:") for x in out["reasons"])
    assert any(x.startswith("steam:") for x in out["reasons"])
    assert len(out["reasons"]) == len(base) + 2


@pytest.mark.parametrize("params", [
    "must_bet_min_ev=-1", "must_bet_max_hold=-1", "must_bet_min_ev=nan", "must_bet_odds_max=inf",
    "must_bet_odds_min=300&must_bet_odds_max=100", "must_bet_odds_min=abc",
])
def test_nonsense_thresholds_are_422(params):  # AC5 / I5
    client = TestClient(main.app)
    assert client.get(f"/api/ev?{params}").status_code == 422


def ml(a, b):
    return {"moneyline": [{"name": "A", "point": None, "prices": a}, {"name": "B", "point": None, "prices": b}]}


def event(eid, books, markets):
    stamp = datetime.fromtimestamp(NOW - 5, timezone.utc).isoformat()
    return {"id": eid, "sport": "NBA", "home": "A", "away": "B",
            "start": datetime.fromtimestamp(NOW + 7200, timezone.utc).isoformat(), "markets": markets,
            "updated": {b: stamp for b in books}}


EVENTS = [
    event("two", ("Pinnacle", "Circa Sports", "DraftKings"),
          ml({"Pinnacle": -110, "Circa Sports": -110, "DraftKings": 105},
             {"Pinnacle": -110, "Circa Sports": -110, "DraftKings": -140})),
    event("one", ("Pinnacle", "DraftKings"),
          ml({"Pinnacle": -110, "DraftKings": 105}, {"Pinnacle": -110, "DraftKings": -140})),
]


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(main, "get_snapshot", lambda: EVENTS)
    monkeypatch.setattr(main, "_now", lambda: NOW)
    monkeypatch.setattr(main, "sharp_weights_spec", lambda: "Pinnacle:1,Circa Sports:1")
    providers.reset_live()
    yield TestClient(main.app)
    providers.reset_live()


def test_api_rows_carry_must_bet(client):  # AC4 / I3
    rows = {r["event_id"]: r for r in client.get("/api/ev").json()}
    assert rows["two"]["must_bet"] is True and rows["two"]["must_bet_reasons"]
    assert rows["one"]["must_bet"] is False
    assert rows["one"]["must_bet_reasons"][0].startswith("sharps:")


def test_api_must_bet_filter(client):  # AC4 / I3
    rows = client.get("/api/ev?must_bet=true").json()
    assert rows and {r["event_id"] for r in rows} == {"two"} and all(r["must_bet"] for r in rows)
    assert {r["event_id"] for r in client.get("/api/ev").json()} == {"two", "one"}


def test_api_threshold_changes_result(client):  # AC5
    rows = client.get("/api/ev?must_bet=true&must_bet_min_ev=2.6").json()
    assert rows == []


# ---- alert rules -------------------------------------------------------------------------

def test_alert_rule_must_bets_only(monkeypatch):  # AC7 / I4
    monkeypatch.delenv("DISCORD_WEBHOOK_URL", raising=False)
    monkeypatch.setattr(providers, "peek_snapshot", lambda: [])
    real = scan.ev_rows
    monkeypatch.setattr(scan, "ev_rows", lambda *a, **k: [{**r, "must_bet": r["event_id"] == "two"} for r in real(*a, **k)])
    monkeypatch.setattr(alerts, "sharp_weights_spec", lambda: "Pinnacle:1,Circa Sports:1")
    with alerts.conn() as c:
        c.execute("INSERT INTO alert_rules (name,kind,min_value,book,market,sport,created_at,bettable,must_bet) "
                  "VALUES ('r','ev',1,'','','','now',0,1)")
    out = alerts.evaluate(EVENTS)
    assert out and all(o["data"]["event_id"] == "two" for o in out)


def test_alert_rule_without_option_fires_for_all(monkeypatch):  # AC7
    monkeypatch.delenv("DISCORD_WEBHOOK_URL", raising=False)
    monkeypatch.setattr(providers, "peek_snapshot", lambda: [])
    monkeypatch.setattr(alerts, "sharp_weights_spec", lambda: "Pinnacle:1,Circa Sports:1")
    with alerts.conn() as c:
        c.execute("INSERT INTO alert_rules (name,kind,min_value,book,market,sport,created_at,bettable,must_bet) "
                  "VALUES ('r','ev',1,'','','','now',0,0)")
    assert {o["data"]["event_id"] for o in alerts.evaluate(EVENTS)} == {"two", "one"}


def test_rules_api_stores_must_bet():  # AC7
    client = TestClient(main.app)
    assert client.post("/api/alerts/rules", json={"kind": "ev", "min_value": 1, "must_bet": True}).json()["must_bet"]
    assert not client.post("/api/alerts/rules", json={"kind": "ev", "min_value": 2}).json()["must_bet"]


def test_existing_alert_table_gets_the_column():  # AC7
    with alerts.conn() as c:
        assert "must_bet" in {r[1] for r in c.execute("PRAGMA table_info(alert_rules)")}


# ---- frontend ----------------------------------------------------------------------------

@pytest.mark.skipif(shutil.which("node") is None, reason="node not installed")
def test_mustbet_js():  # AC6
    r = subprocess.run(["node", "--test", "src/mustbet.test.js"], cwd=FRONTEND, capture_output=True, text=True)
    assert r.returncode == 0, r.stdout + r.stderr


def test_jsx_wiring():  # AC6 / AC7
    jsx = (FRONTEND / "src" / "main.jsx").read_text()
    assert "mustbet.js" in jsx and "Must bets only" in jsx
    assert "mustBetBadge(" in jsx and "mustBetQuery(" in jsx and "MustBetSettings" in jsx
    ev = re.search(r"const query = `book=.*?;", jsx, re.S).group(0)
    assert "mustBetQuery" in ev and "mustBetParam" in ev
    body = re.search(r"\nfunction Alerts\(\) \{(.*?)\n\}\n", jsx, re.S).group(1)
    assert "form.must_bet" in body
