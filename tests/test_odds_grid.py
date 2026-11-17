"""Odds Screen games x books grid (odderjam-99). Pure helpers run under node; wiring is read from source."""

import re
import shutil
import subprocess
from pathlib import Path

import pytest

FRONTEND = Path(__file__).resolve().parent.parent / "frontend"
SRC = FRONTEND / "src"


def _odds():
    return (SRC / "OddsScreen.jsx").read_text()


def _css():
    return (SRC / "style.css").read_text()


@pytest.mark.skipif(shutil.which("node") is None, reason="node not installed")
def test_oddsgrid_js():
    result = subprocess.run(["node", "--test", "src/oddsgrid.test.js"], cwd=FRONTEND, capture_output=True, text=True)
    assert result.returncode == 0, result.stdout + result.stderr


def test_card_list_is_removed():
    src = _odds()
    assert "EventCard" not in src
    assert "LineTable" not in src
    assert 'className="card' not in src
    assert "chevron" not in src


def test_screen_uses_a_grid_table_with_book_columns():
    src = _odds()
    assert "gridRows(" in src
    assert re.search(r'className="odds grid', src)
    assert "books.map" in src or "shown.map" in src


def test_grid_has_game_best_and_fair_headers():
    src = _odds()
    assert "<th" in src and "Game" in src and "Best" in src and "Fair" in src


def test_live_and_upcoming_stay_sections():
    src = _odds()
    assert "'Live'" in src and "'Upcoming'" in src


def test_market_toggle_is_global_not_per_event():
    src = _odds()
    assert "eventMarket" not in src
    assert "onPickMarket" not in src


def test_clicking_a_price_still_toggles_the_slip():
    src = _odds()
    assert "slipLeg(" in src and "slip.toggle(" in src and "slipToast(" in src


def test_best_is_a_background_plus_weight_not_color_alone():
    css = _css()
    rule = re.search(r"[^{}]*\.bestcell[^{}]*\{([^}]*)\}", css)
    assert rule, ".bestcell rule missing"
    assert "background" in rule.group(1)
    assert "font-weight" in rule.group(1)
    assert "bestcell" in _odds()


def test_header_and_game_column_are_sticky():
    css = _css()
    assert re.search(r"table\.grid[^{]*thead th[^{]*\{[^}]*position:\s*sticky", css)
    assert re.search(r"table\.grid[^{]*\.gamecol[^{]*\{[^}]*position:\s*sticky[^}]*left:\s*0", css)


def test_grid_scrolls_sideways_on_narrow_screens():
    css = _css()
    assert re.search(r"\.gridwrap[^{]*\{[^}]*overflow-x:\s*auto", css)
