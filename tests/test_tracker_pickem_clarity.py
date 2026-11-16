"""Tracker and Pick'em clarity helpers (odderjam-81), tested as pure JS plus source wiring."""

import shutil
import subprocess
from pathlib import Path

import pytest

FRONTEND = Path(__file__).resolve().parent.parent / "frontend"
SRC = FRONTEND / "src"


@pytest.mark.skipif(shutil.which("node") is None, reason="node not installed")
def test_clarity_js():
    r = subprocess.run(["node", "--test", "src/clarity.test.js"], cwd=FRONTEND, capture_output=True, text=True)
    assert r.returncode == 0, r.stdout + r.stderr


def test_tracker_uses_helpers():
    jsx = (SRC / "Tracker.jsx").read_text()
    for name in ("statusClass", "clvTileText", "chartReady", "latestMonth"):
        assert name in jsx, f"Tracker.jsx does not use {name}"


def test_pickem_uses_helpers():
    jsx = (SRC / "Pickem.jsx").read_text()
    for name in ("EXAMPLE_LINE", "noMatchReason", "noSlipsReason"):
        assert name in jsx, f"Pickem.jsx does not use {name}"
