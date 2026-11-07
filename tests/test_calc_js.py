"""Runs the frontend calculator formula tests (frontend/src/calc.test.js) under node."""

import shutil
import subprocess
from pathlib import Path

import pytest

FRONTEND = Path(__file__).resolve().parent.parent / "frontend"


@pytest.mark.skipif(shutil.which("node") is None, reason="node not installed")
def test_calculator_formulas_js():
    r = subprocess.run(["node", "--test", "src/calc.test.js"], cwd=FRONTEND, capture_output=True, text=True)
    assert r.returncode == 0, r.stdout + r.stderr
