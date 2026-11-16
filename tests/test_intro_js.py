"""Intro banner helpers (odderjam-56): run under node, and check each core tab renders TabIntro."""

import re
import shutil
import subprocess
from pathlib import Path

import pytest

FRONTEND = Path(__file__).resolve().parent.parent / "frontend"
SRC = FRONTEND / "src"


@pytest.mark.skipif(shutil.which("node") is None, reason="node not installed")
def test_intro_js():
    result = subprocess.run(["node", "--test", "src/intro.test.js"], cwd=FRONTEND, capture_output=True, text=True)
    assert result.returncode == 0, result.stdout + result.stderr


@pytest.mark.parametrize("path, tab", [
    ("OddsScreen.jsx", "Odds Screen"),
    ("main.jsx", "+EV"),
    ("main.jsx", "Arbitrage"),
])
def test_core_tab_renders_intro(path, tab):
    assert re.search(r"<TabIntro tab=\"" + re.escape(tab) + r"\"", (SRC / path).read_text())


def test_banner_styles_are_responsive():
    css = (SRC / "style.css").read_text()
    assert ".intro" in css and "@media" in css
