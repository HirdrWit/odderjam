"""Run the frontend calculator formula tests under node."""

import shutil
import subprocess
from pathlib import Path

import pytest

FRONTEND = Path(__file__).resolve().parent.parent / "frontend"


@pytest.mark.skipif(shutil.which("node") is None, reason="node not installed")
def test_calculator_formulas_js():
    result = subprocess.run(
        ["node", "--test", "src/calc.test.js", "src/odds.test.js"], cwd=FRONTEND, capture_output=True, text=True
    )
    assert result.returncode == 0, result.stdout + result.stderr
