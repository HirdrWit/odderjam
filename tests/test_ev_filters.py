"""+EV filter bar layout and shared staking settings (odderjam-97). Helpers run under node; JSX is read for wiring."""

import re
import shutil
import subprocess
from pathlib import Path

import pytest

FRONTEND = Path(__file__).resolve().parent.parent / "frontend"
SRC = FRONTEND / "src"
JSX = (SRC / "main.jsx").read_text()
CALC = (SRC / "Calculators.jsx").read_text()
CSS = (SRC / "style.css").read_text()


def _fn(name):
    match = re.search(r"\nfunction " + name + r"\(.*?\n\}\n", JSX, re.S)
    assert match, f"{name} not found"
    return match.group(0)


@pytest.mark.skipif(shutil.which("node") is None, reason="node not installed")
def test_filter_and_staking_js():
    result = subprocess.run(["node", "--test", "src/evfilters.test.js", "src/staking.test.js"], cwd=FRONTEND,
                            capture_output=True, text=True)
    assert result.returncode == 0, result.stdout + result.stderr


def test_main_bar_has_only_everyday_filters():
    body = _fn("PositiveEv")
    bar = body.split('<div className="bar')[1].split("</div>")[0]
    for kept in ("EV_BOOK_NAMES", "setMinEv", "SPORTS", "PropsFilter", "resetFilters"):
        assert kept in bar, kept
    for moved in ("setMethod", "setKelly", "<Bankroll", "<SizingBar"):
        assert moved not in bar, f"{moved} belongs in a settings panel"


def test_panels_and_chips_are_wired():
    body = _fn("PositiveEv")
    assert "Model settings" in body and "Bankroll &amp; staking" in body or "Bankroll & staking" in body
    assert "activeChips(" in body and "clearFilter(" in body
    assert "<SharpWeights" in body and "setMethod" in body


def test_parlay_and_calculator_read_shared_staking():
    parlay = _fn("Parlay")
    assert 'type="number" step="0.05"' not in parlay, "Parlay must not repeat the Kelly input"
    assert "stakingSummary(" in parlay
    kelly_calc = CALC.split("function Kelly()")[1].split("\nfunction ")[0]
    assert "useStored('evKelly'" in kelly_calc
    assert "Kelly multiplier" not in kelly_calc.split('<div className="bar">')[1].split("</div>")[0]


def test_filter_bar_stays_on_one_line():
    assert re.search(r"\.filter-bar\s*\{[^}]*flex-wrap:\s*nowrap", CSS)
