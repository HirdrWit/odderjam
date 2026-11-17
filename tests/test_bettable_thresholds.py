"""odderjam-116: bettable thresholds in Model settings (backend switch and UI wiring)."""
import re
import shutil
import subprocess
from pathlib import Path

import pytest

from tests.test_bettable import client, ctx  # noqa: F401  (client is a fixture)
from backend.engine import bettable

FRONTEND = Path(__file__).resolve().parent.parent / "frontend"
JSX = (FRONTEND / "src" / "main.jsx").read_text()


def test_fragile_flag_follows_require_conservative():
    c = ctx(worst_ev_pct=-1.0)
    assert "fragile" in bettable.flags(c, bettable.DEFAULT_PROFILE)
    assert bettable.DEFAULT_PROFILE["require_conservative"] is True
    assert "fragile" not in bettable.flags(c, {**bettable.DEFAULT_PROFILE, "require_conservative": False})


def test_endpoint_require_conservative_param(client):
    assert client.get("/api/ev?require_conservative=false").status_code == 200
    assert client.get("/api/ev?require_conservative=maybe").status_code == 422


def test_changed_threshold_changes_which_rows_are_hidden(client):
    hidden = {r["event_id"] for r in client.get("/api/ev?bettable=true").json()}
    assert "long" not in hidden
    wide = {r["event_id"] for r in client.get(
        "/api/ev?bettable=true&bettable_odds_max=1000&ev_ceiling=50&prop_ev_ceiling=50").json()}
    assert "long" in wide


def test_inverted_range_is_rejected_by_the_server_too(client):
    assert client.get("/api/ev?bettable_odds_min=300&bettable_odds_max=100").status_code == 422


@pytest.mark.skipif(shutil.which("node") is None, reason="node not installed")
def test_thresholds_js():
    r = subprocess.run(["node", "--test", "src/thresholds.test.js"], cwd=FRONTEND, capture_output=True, text=True)
    assert r.returncode == 0, r.stdout + r.stderr


def test_model_panel_renders_the_section_and_sends_the_query():
    assert "Bettable mode" in JSX
    assert "bettableQuery(" in JSX and "validateBettable(" in JSX and "bettableReset(" in JSX
    assert "Reset to defaults" in JSX
    ev = re.search(r"const query = `book=.*?;", JSX, re.S).group(0)
    assert "bettableQuery" in ev
