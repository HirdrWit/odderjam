"""Odds Screen (odderjam-76, grid since odderjam-99): slip feedback, books help, one banner.

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


def test_adding_a_price_gives_feedback():
    body = _odds()
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
