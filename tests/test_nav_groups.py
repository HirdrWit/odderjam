"""Grouped nav with subtitles (odderjam-59): node tests plus markup checks on main.jsx and style.css."""

import re
import shutil
import subprocess
from pathlib import Path

import pytest

FRONTEND = Path(__file__).resolve().parent.parent / "frontend"
SRC = FRONTEND / "src"


@pytest.mark.skipif(shutil.which("node") is None, reason="node not installed")
def test_navgroups_js():
    result = subprocess.run(["node", "--test", "src/navgroups.test.js"], cwd=FRONTEND, capture_output=True, text=True)
    assert result.returncode == 0, result.stdout + result.stderr


def test_nav_renders_groups_and_subtitles():
    jsx = (SRC / "main.jsx").read_text()
    assert "NAV_GROUPS" in jsx and "NAV_SUBTITLES" in jsx
    assert 'className="sub"' in jsx
    assert "title={NAV_SUBTITLES" in jsx, "subtitle should also be a tooltip"


def test_tab_persistence_kept():
    jsx = (SRC / "main.jsx").read_text()
    assert "localStorage.setItem('tab', next)" in jsx
    assert "localStorage.getItem('tab')" in jsx


def test_nav_styles_and_phone_layout():
    css = (SRC / "style.css").read_text()
    assert ".nav-group" in css and "nav button .sub" in css
    phone = css[css.index("@media (max-width: 640px)"):]
    assert ".nav-group" in phone
