"""Welcome box and tab intro never stack (odderjam-96)."""

import re
import shutil
import subprocess
from pathlib import Path

import pytest

FRONTEND = Path(__file__).resolve().parent.parent / "frontend"
SRC = FRONTEND / "src"


@pytest.mark.skipif(shutil.which("node") is None, reason="node not installed")
def test_onboarding_js():
    result = subprocess.run(["node", "--test", "src/onboarding.test.js"], cwd=FRONTEND, capture_output=True, text=True)
    assert result.returncode == 0, result.stdout + result.stderr


def test_welcome_is_tied_to_one_tab_and_closed_on_navigation():
    jsx = (SRC / "main.jsx").read_text()
    assert "initialWelcome(" in jsx and "afterNavigate(" in jsx


def test_tab_intro_is_suppressed_while_welcome_shows():
    jsx = (SRC / "TabIntro.jsx").read_text()
    assert "introShown(" in jsx and "introToggle(" in jsx


def test_welcome_matches_content_width():
    css = (SRC / "style.css").read_text()
    rule = re.search(r"\n\.welcome \{([^}]*)\}", css).group(1)
    assert "margin: var(--sp-4) var(--sp-4) 0" not in rule
    assert "margin: 0 0 var(--sp-3)" in rule
