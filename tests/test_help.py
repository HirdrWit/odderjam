"""Help page (odderjam-64): node tests plus wiring checks (nav, welcome banner, tab banners)."""

import re
import shutil
import subprocess
from pathlib import Path

import pytest

FRONTEND = Path(__file__).resolve().parent.parent / "frontend"
SRC = FRONTEND / "src"


@pytest.mark.skipif(shutil.which("node") is None, reason="node not installed")
def test_help_js():
    result = subprocess.run(["node", "--test", "src/help.test.js"], cwd=FRONTEND, capture_output=True, text=True)
    assert result.returncode == 0, result.stdout + result.stderr


def test_help_in_nav():
    nav = (SRC / "navgroups.js").read_text()
    assert "'Help'" in nav
    jsx = (SRC / "main.jsx").read_text()
    assert re.search(r"'Help':\s*Help\b", jsx)
    assert (SRC / "Help.jsx").exists()


def test_welcome_links_to_help():
    jsx = (SRC / "main.jsx").read_text()
    body = re.search(r"\nfunction Welcome\(.*?\) \{(.*?)\n\}\n", jsx, re.S).group(1)
    assert re.search(r"onJump\('Help'\)", body)


def test_tab_intro_links_to_help():
    src = (SRC / "TabIntro.jsx").read_text()
    assert "GOTO_EVENT" in src and "HELP_TAB" in src
    jsx = (SRC / "main.jsx").read_text()
    assert "GOTO_EVENT" in jsx and "addEventListener" in jsx


def test_help_page_renders_sections_and_converter():
    src = (SRC / "Help.jsx").read_text()
    assert "HELP_SECTIONS" in src and "convertOdds" in src
