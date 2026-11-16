"""Odds Screen game row (odderjam-76): whole row opens, chevron, slip feedback.

There is no DOM runner, so the pure helpers run under node and the wiring is
checked by reading the source.
"""

import re
import shutil
import subprocess
from pathlib import Path

import pytest

FRONTEND = Path(__file__).resolve().parent.parent / "frontend"
SRC = FRONTEND / "src"


@pytest.mark.skipif(shutil.which("node") is None, reason="node not installed")
def test_oddsrow_js():
    result = subprocess.run(["node", "--test", "src/oddsrow.test.js"], cwd=FRONTEND, capture_output=True, text=True)
    assert result.returncode == 0, result.stdout + result.stderr


def _odds():
    return (SRC / "OddsScreen.jsx").read_text()


def _card():
    match = re.search(r"\nfunction EventCard\(.*?\n\}\n", _odds(), re.S)
    assert match, "EventCard not found"
    return match.group(0)


def test_row_is_a_keyboard_reachable_button_that_toggles():
    head = re.search(r'<div className="card[^>]*>', _card()).group(0)
    assert "onClick={onToggle}" in head
    assert 'role="button"' in head
    assert "tabIndex={0}" in head
    assert "aria-expanded={isOpen}" in head
    assert "onKeyDown" in head


def test_row_shows_chevron():
    assert re.search(r"chevron\(isOpen\)", _card())
    assert re.search(r"\.chevron\b", (SRC / "style.css").read_text())


def test_row_has_hover_style():
    assert re.search(r"\.card:hover", (SRC / "style.css").read_text())


def test_adding_a_price_gives_feedback():
    body = re.search(r"function LineTable\(.*?\n\}\n", _odds(), re.S).group(0)
    assert "slipToast(" in body
    assert "toast(" in body


def test_toast_supports_an_action_link():
    hooks = (SRC / "hooks.jsx").read_text()
    assert "action" in hooks
    assert "GOTO_EVENT" in hooks


def test_books_button_is_explained():
    assert "booksHelp(" in _odds()


def test_one_banner_at_a_time():
    main = (SRC / "main.jsx").read_text()
    assert re.search(r"<Page\s+welcome=\{welcome\}", main)
    odds = _odds()
    assert "introVisible(" in odds
    assert re.search(r"export function OddsScreen\(\{welcome", odds)
