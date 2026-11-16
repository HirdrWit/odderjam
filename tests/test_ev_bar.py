"""+EV filter bar readability (odderjam-75). Helpers run under node; main.jsx is read for wiring."""

import re
import shutil
import subprocess
from pathlib import Path

import pytest

FRONTEND = Path(__file__).resolve().parent.parent / "frontend"
JSX = (FRONTEND / "src" / "main.jsx").read_text()
CSS = (FRONTEND / "src" / "style.css").read_text()


def _fn(name):
    match = re.search(r"\nfunction " + name + r"\(.*?\n\}\n", JSX, re.S)
    assert match, f"{name} not found"
    return match.group(0)


@pytest.mark.skipif(shutil.which("node") is None, reason="node not installed")
def test_ev_bar_js():
    result = subprocess.run(["node", "--test", "src/evbar.test.js"], cwd=FRONTEND, capture_output=True, text=True)
    assert result.returncode == 0, result.stdout + result.stderr


def test_devig_options_use_readable_labels():
    body = _fn("PositiveEv")
    assert "methodLabel(" in body
    assert "<option key={m}>{m}</option>" not in body


def test_bankroll_is_labelled_and_applies_while_typing():
    body = _fn("Bankroll")
    assert "Start" in body and "Current" in body
    assert "onBlur" not in body, "start amount must not wait for blur"
    assert "onChange" in body and "pendingStartText" in body
    assert 'className="mini"' not in body, "start box needs a wider class"
    assert re.search(r"input\.bankroll-start\s*\{[^}]*width:\s*\d{2,3}px", CSS)


def test_filter_labels_carry_info_icon_and_help():
    for name in ("PositiveEv", "SharpWeights"):
        assert "FILTER_HELP" in _fn(name) or "<FilterHelp" in _fn(name), name
    assert "FILTER_HELP.devig" in JSX or 'help="devig"' in JSX
    assert "ⓘ" in JSX or "FilterHelp" in JSX


def test_row_buttons_have_tooltips():
    body = _fn("PositiveEv")
    assert "ROW_ACTION_TIPS.track" in body and "ROW_ACTION_TIPS.slip" in body
    assert "ROW_ACTION_TIPS.bet" in JSX
