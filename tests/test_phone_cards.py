"""Rows as cards below 640px (odderjam-103): CSS and markup checks plus the node helper tests."""

import re
import shutil
import subprocess
from pathlib import Path

import pytest

FRONTEND = Path(__file__).resolve().parent.parent / "frontend"
SRC = FRONTEND / "src"
MAIN = (SRC / "main.jsx").read_text()
TRACKER = (SRC / "Tracker.jsx").read_text()
CSS = (SRC / "style.css").read_text()


def _phone_css():
    blocks = []
    for m in re.finditer(r"@media \(max-width: 640px\) \{", CSS):
        depth, i = 1, m.end()
        while depth:
            depth += {"{": 1, "}": -1}.get(CSS[i], 0)
            i += 1
        blocks.append(CSS[m.end():i - 1])
    return "\n".join(blocks)


@pytest.mark.skipif(shutil.which("node") is None, reason="node not installed")
def test_cards_js():
    r = subprocess.run(["node", "--test", "src/cards.test.js"], cwd=FRONTEND, capture_output=True, text=True)
    assert r.returncode == 0, r.stdout + r.stderr


def test_four_tables_opt_in_to_cards():
    assert MAIN.count('<table className="cards"') >= 3  # +EV, Low Hold, Middles
    assert '<table className="cards"' in TRACKER


@pytest.mark.parametrize("cls", ["c-ev", "c-pick", "c-book", "c-odds", "c-fair", "c-event", "c-actions"])
def test_ev_cells_have_role_classes(cls):
    assert cls in MAIN


@pytest.mark.parametrize("cls", ["c-status", "c-pl", "c-pick"])
def test_tracker_cells_have_role_classes(cls):
    assert cls in TRACKER


def test_card_rules_live_inside_the_phone_media_query():
    phone = _phone_css()
    assert re.search(r"table\.cards\s+thead\s*\{[^}]*display:\s*none", phone)
    assert re.search(r"table\.cards\s+tr\s*\{[^}]*display:\s*grid", phone)
    assert re.search(r"table\.cards\s+td\s*\{[^}]*min-width:\s*0", phone)
    assert re.search(r"table\.cards\s+td\.c-ev\s*\{[^}]*font-size", phone)


def test_card_rules_do_not_leak_to_desktop():
    desktop = CSS.replace(_phone_css(), "")
    assert "table.cards tr" not in desktop and "table.cards thead" not in desktop


def test_cards_and_bars_wrap_on_phone():
    phone = _phone_css()
    assert re.search(r"\.bar\s*\{[^}]*flex-wrap:\s*wrap", phone)
    assert re.search(r"\.card\s*\{[^}]*overflow-wrap:\s*anywhere", CSS)


def test_filter_toggle_wired_in_ev_and_tracker():
    for text in (MAIN, TRACKER):
        assert "filtersLabel(" in text and "filterCount(" in text
        assert "filters-toggle" in text
        assert "aria-expanded={filtersOpen}" in text


def test_filter_toggle_hidden_on_desktop_and_bar_collapses_on_phone():
    assert re.search(r"\.filters-toggle\s*\{[^}]*display:\s*none", CSS.replace(_phone_css(), ""))
    phone = _phone_css()
    assert re.search(r"\.collapsible:not\(\.open\)\s*\{[^}]*display:\s*none", phone)
    assert re.search(r"\.filters-toggle\s*\{[^}]*display:\s*(inline-)?block", phone)
