"""One primary button per opportunity row (odderjam-98): Bet is filled; Track and Slip are quiet."""

import re
import shutil
import subprocess
from pathlib import Path

import pytest

SRC = Path(__file__).resolve().parent.parent / "frontend" / "src"
MAIN = (SRC / "main.jsx").read_text()
CSS = (SRC / "style.css").read_text()


def _rule(selector):
    m = re.search(re.escape(selector) + r"\s*\{([^}]*)\}", CSS)
    assert m, f"{selector} rule missing"
    return m.group(1)


@pytest.mark.skipif(shutil.which("node") is None, reason="node missing")
def test_row_button_js():
    r = subprocess.run(["node", "--test", "rowbuttons.test.js"], cwd=SRC, capture_output=True, text=True)
    assert r.returncode == 0, r.stdout + r.stderr


def test_secondary_style_is_not_filled():
    body = _rule("button.secondary")
    assert "accent-fill" not in body
    assert "background: transparent" in body or "background: none" in body
    assert "border" in body


def test_secondary_on_state_is_distinct_without_color_only():
    assert "button.secondary.on" in CSS


def test_ev_row_track_and_slip_are_secondary():
    m = re.search(r'<td className="row-actions">.*?</td>', MAIN, re.S)
    cell = m.group(0)
    assert "className={tracked.has(trackKey(r)) ? 'track on'" not in cell
    assert "'track on' : 'track'" not in cell
    assert cell.count("secondary") >= 2
    assert cell.count("aria-label") >= 2
    assert "slipButtonLabel" in cell


def test_bet_is_before_track_before_slip_in_ev_row():
    cell = re.search(r'<td className="row-actions">.*?</td>', MAIN, re.S).group(0)
    assert cell.index("BetLink") < cell.index("trackButtonLabel") < cell.index("slipButtonLabel")


def test_middles_and_arb_track_buttons_are_secondary():
    assert 'className="track' not in MAIN.replace('className="track on"', "")
    assert MAIN.count("secondary") >= 5


def test_bet_link_has_aria_label():
    m = re.search(r"function BetLink.*?\n}\n", MAIN, re.S)
    assert "aria-label" in m.group(0)


def test_only_bet_uses_filled_row_style():
    assert "a.bet {" in CSS and "accent-fill" in _rule("a.bet")
