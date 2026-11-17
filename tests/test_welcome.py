"""First-visit welcome banner (odderjam-57).

The repo has no DOM test runner. The show/dismiss logic is tested as pure JS
under node; these tests also read main.jsx and style.css for the wiring.
"""

import re
import shutil
import subprocess
from pathlib import Path

import pytest

FRONTEND = Path(__file__).resolve().parent.parent / "frontend"
SRC = FRONTEND / "src"


@pytest.mark.skipif(shutil.which("node") is None, reason="node not installed")
def test_welcome_js():
    result = subprocess.run(["node", "--test", "src/welcome.test.js"], cwd=FRONTEND, capture_output=True, text=True)
    assert result.returncode == 0, result.stdout + result.stderr


def _jsx():
    return (SRC / "main.jsx").read_text()


def _welcome_component():
    match = re.search(r"\nfunction Welcome\(.*?\) \{(.*?)\n\}\n", _jsx(), re.S)
    assert match, "Welcome component not found in main.jsx"
    return match.group(1)


def test_banner_text_and_buttons():
    body = _welcome_component()
    assert re.search(r"compares? sportsbook prices", body, re.I)
    assert re.search(r"not betting advice", body, re.I)
    assert re.search(r"not guaranteed", body, re.I)
    for tab in ("Odds Screen", "+EV", "Arbitrage", "Tracker"):
        assert tab in body, f"{tab} missing from the welcome steps"
    assert re.search(r"onJump\('Odds Screen'\)", body)
    assert re.search(r"onJump\('\+EV'\)", body)


def test_jump_uses_normal_tab_handler():
    app = re.search(r"\nfunction App\(\) \{(.*?)\n\}\n", _jsx(), re.S).group(1)
    assert re.search(r"<Welcome[^>]*onJump=\{go\}", app) or re.search(r"<Welcome[^>]*onJump=\{\(\w+\) => \{\s*go\(", app)


def test_show_welcome_link_in_nav():
    app = re.search(r"\nfunction App\(\) \{(.*?)\n\}\n", _jsx(), re.S).group(1)
    nav = re.search(r"<nav>(.*?)</nav>", app, re.S).group(1)
    assert "Show welcome" in nav
    assert "initialWelcome" in app and "dismissWelcome" in app


def test_phone_layout_stacks_without_horizontal_scroll():
    css = (SRC / "style.css").read_text()
    media = re.search(r"@media\s*\(max-width:\s*\d+px\)\s*\{(.*)", css, re.S)
    assert media, "no phone-width media query"
    assert ".welcome" in css
    assert re.search(r"flex-wrap:\s*wrap|overflow-wrap|word-break", css)
