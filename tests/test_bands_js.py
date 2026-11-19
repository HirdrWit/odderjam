"""Tracker band tables (odderjam-136): node unit tests plus a check that the Tracker renders them."""
import shutil
import subprocess
from pathlib import Path

import pytest

FRONTEND = Path(__file__).resolve().parent.parent / "frontend"


@pytest.mark.skipif(shutil.which("node") is None, reason="node not installed")
def test_bands_node_tests_pass():
    r = subprocess.run(["node", "--test", "src/bands.test.js"], cwd=FRONTEND, capture_output=True, text=True)
    assert r.returncode == 0, r.stdout + r.stderr


def test_tracker_renders_both_breakdowns():
    src = (FRONTEND / "src" / "Tracker.jsx").read_text()
    assert "by_odds_band" in src and "by_ev_band" in src and "BandTable" in src
