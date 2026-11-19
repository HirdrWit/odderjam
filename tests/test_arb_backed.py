"""Arb-backed +EV rows and per-leg EV on arbs (odderjam-134)."""
import shutil
import subprocess
from datetime import datetime, timezone
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend import main, providers, scan
from backend.engine import arb as arbm

NOW = datetime(2026, 11, 15, 20, 0, tzinfo=timezone.utc).timestamp()
SRC = Path(__file__).resolve().parent.parent / "frontend" / "src"
WEIGHTS = {"Pinnacle": 1.0}


def event():
    stamp = datetime.fromtimestamp(NOW - 5, timezone.utc).isoformat()
    over = {"name": "Over", "point": 220.5,
            "prices": {"Pinnacle": -110, "FanDuel": 102, "ESPN BET": -120, "DraftKings": 101}}
    under = {"name": "Under", "point": 220.5,
             "prices": {"Pinnacle": -110, "FanDuel": -125, "ESPN BET": 100, "DraftKings": -130}}
    return {"id": "e1", "sport": "NBA", "home": "A", "away": "B",
            "start": datetime.fromtimestamp(NOW + 7200, timezone.utc).isoformat(),
            "markets": {"totals": [over, under]},
            "updated": {b: stamp for b in ("Pinnacle", "FanDuel", "ESPN BET", "DraftKings")}}


def rows():
    return scan.ev_rows([event()], WEIGHTS, 10.0, min_ev=-100.0, now=NOW)


def pick(rs, book, name):
    return next(r for r in rs if r["book"] == book and r["name"] == name)


def test_leg_of_arb_is_marked_with_arb_profit():  # AC1
    r = pick(rows(), "FanDuel", "Over")
    assert r["arb_backed"] is True
    assert r["arb_profit_pct"] == pytest.approx(arbm.arb([102, 100])["profit_pct"])
    assert pick(rows(), "ESPN BET", "Under")["arb_backed"] is True


def test_non_arb_price_on_same_line_is_not_marked():  # AC2
    r = pick(rows(), "DraftKings", "Over")
    assert r["arb_backed"] is False
    assert r["arb_profit_pct"] is None


def test_no_arb_means_no_marks():  # AC2
    ev = event()
    ev["markets"]["totals"][1]["prices"]["ESPN BET"] = -105
    rs = scan.ev_rows([ev], WEIGHTS, 10.0, min_ev=-100.0, now=NOW)
    assert rs and not any(r["arb_backed"] for r in rs)


def test_arb_legs_carry_ev_and_mark_the_positive_leg():  # AC3
    out = scan.arb_rows([event()], weights=WEIGHTS, max_hold=10.0, now=NOW)
    legs = {l["book"]: l for l in out[0]["legs"]}
    assert legs["FanDuel"]["ev_pct"] == pytest.approx(1.0, abs=0.01)
    assert legs["ESPN BET"]["ev_pct"] == pytest.approx(0.0, abs=0.01)
    assert legs["FanDuel"]["ev_leg"] is True
    assert legs["ESPN BET"]["ev_leg"] is False


def test_arb_legs_without_a_sharp_have_no_ev():  # AC3
    out = scan.arb_rows([event()], weights={"Nobody": 1.0}, max_hold=10.0, now=NOW)
    assert all(l["ev_pct"] is None and l["ev_leg"] is False for l in out[0]["legs"])


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(main, "get_snapshot", lambda: [event()])
    monkeypatch.setattr(main, "_now", lambda: NOW)
    monkeypatch.setattr(main, "sharp_weights_spec", lambda: "Pinnacle:1")
    providers.reset_live()
    return TestClient(main.app)


def test_api_arb_backed_filter(client):  # AC4
    allrows = client.get("/api/ev?min_ev=-100&show_hidden=true").json()
    assert {r["arb_backed"] for r in allrows} == {True, False}
    only = client.get("/api/ev?min_ev=-100&arb_backed=true").json()
    assert only and all(r["arb_backed"] for r in only)
    assert len(only) < len(allrows)


def test_api_arbs_have_leg_ev(client):  # AC3
    legs = client.get("/api/arbs").json()[0]["legs"]
    assert any(l["ev_leg"] for l in legs) and all("ev_pct" in l for l in legs)


@pytest.mark.skipif(shutil.which("node") is None, reason="node not installed")
def test_badge_helper_js():  # AC3 AC4
    r = subprocess.run(["node", "--test", "arbbadge.test.js"], cwd=SRC, capture_output=True, text=True)
    assert r.returncode == 0, r.stdout + r.stderr


def test_jsx_wiring():  # AC3 AC4
    jsx = (SRC / "main.jsx").read_text()
    assert "arbbadge.js" in jsx and "Arb-backed only" in jsx
    assert "ARB_BACKED_TIP" in jsx and "leg.ev_leg" in jsx
