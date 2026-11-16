"""+EV Track button (odderjam-82): stake matches the row, confirms, shows tracked state."""

import re
import shutil
import subprocess
from pathlib import Path

import pytest

FRONTEND = Path(__file__).resolve().parent.parent / "frontend"
SRC = FRONTEND / "src"


@pytest.mark.skipif(shutil.which("node") is None, reason="node not installed")
def test_track_js():
    r = subprocess.run(["node", "--test", "src/track.test.js"], cwd=FRONTEND, capture_output=True, text=True)
    assert r.returncode == 0, r.stdout + r.stderr


def _ev_track():
    main = (SRC / "main.jsx").read_text()
    m = re.search(r"const track = async \(row\) => \{.*?\n  \};\n", main, re.S)
    assert m, "EV track handler not found"
    return m.group(0)


def test_ev_track_no_silent_one_dollar_default():
    assert "|| 1" not in _ev_track()


def test_ev_track_uses_helpers_and_confirms():
    body = _ev_track()
    for name in ("trackStake", "parseStakeInput", "trackToast"):
        assert name in body, name


def test_ev_row_shows_tracked_state():
    main = (SRC / "main.jsx").read_text()
    assert "trackButtonLabel(" in main
