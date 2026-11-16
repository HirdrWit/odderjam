"""Calculator tab guidance (odderjam-62): node unit tests plus markup checks."""

import shutil
import subprocess
from pathlib import Path

import pytest

FRONTEND = Path(__file__).resolve().parent.parent / "frontend"
SRC = FRONTEND / "src"


@pytest.mark.skipif(shutil.which("node") is None, reason="node not installed")
def test_calcguide_js():
    result = subprocess.run(["node", "--test", "src/calcguide.test.js"], cwd=FRONTEND, capture_output=True, text=True)
    assert result.returncode == 0, result.stdout + result.stderr


def test_calculators_render_guidance():
    jsx = (SRC / "Calculators.jsx").read_text()
    assert "CALC_GUIDE" in jsx and "CALC_QUESTIONS" in jsx and "explainRow" in jsx
    assert "Example" in jsx
    assert "scrollIntoView" in jsx
    assert 'className="use-when"' in jsx


def test_calculator_guide_styles():
    css = (SRC / "style.css").read_text()
    assert ".use-when" in css and ".calc-index" in css
