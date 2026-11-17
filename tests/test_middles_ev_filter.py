"""odderjam-77: Middles min_ev filter, window label, Hit % beside EV, EV default in the UI."""
import re
import shutil
import subprocess
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend import main
from tests.test_middles import make_outcome

FRONTEND = Path(__file__).resolve().parent.parent / "frontend"


@pytest.fixture
def client(monkeypatch):
    ev = {"id": "e1", "sport": "NBA", "home": "A", "away": "B", "start": "2099-01-01T00:00:00Z",
          "markets": {"totals": [make_outcome("Over", 226.5, DraftKings=-110), make_outcome("Under", 227.5, FanDuel=-110)]}}
    monkeypatch.setattr(main, "get_snapshot", lambda: [ev])
    return TestClient(main.app)


def test_row_is_negative_ev_by_default(client):
    rows = client.get("/api/middles", params={"min_window": 0}).json()
    assert rows and rows[0]["ev_pct"] < 0


def test_min_ev_zero_drops_negative_ev(client):
    assert client.get("/api/middles", params={"min_window": 0, "min_ev": 0}).json() == []


def test_min_ev_below_row_keeps_it(client):
    assert client.get("/api/middles", params={"min_window": 0, "min_ev": -50}).json()


@pytest.mark.parametrize("v", ["nan", "inf"])
def test_min_ev_rejects_non_finite(client, v):
    assert client.get("/api/middles", params={"min_ev": v}).status_code == 422


@pytest.mark.skipif(shutil.which("node") is None, reason="node not installed")
def test_middles_js():
    r = subprocess.run(["node", "--test", "src/middles.test.js"], cwd=FRONTEND, capture_output=True, text=True)
    assert r.returncode == 0, r.stdout + r.stderr


def test_middles_component_wires_ev_filter_and_window_text():
    jsx = (FRONTEND / "src" / "main.jsx").read_text()
    body = re.search(r"\nfunction Middles\(\) \{(.*?)\n\}\n", jsx, re.S).group(1)
    assert "min_ev" in body and "windowText(" in body
    assert re.search(r"middlesEmptyText\(data, minWindow, maxCost, minEv\)", body)
    # Hit % header directly after EV%
    jsx_cols = re.search(r"MIDDLES_COLUMNS = \[\s*\['ev', 'EV%', 'desc'\], \['hit', 'Hit %'", jsx)
    assert jsx_cols
