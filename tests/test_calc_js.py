"""Run the frontend calculator and tracker helper tests under node."""

import shutil
import subprocess
from pathlib import Path

import pytest

FRONTEND = Path(__file__).resolve().parent.parent / "frontend"


@pytest.mark.skipif(shutil.which("node") is None, reason="node not installed")
def test_frontend_js():
    result = subprocess.run(
        ["node", "--test", "src/calc.test.js", "src/tracker.test.js"], cwd=FRONTEND, capture_output=True, text=True
    )
    assert result.returncode == 0, result.stdout + result.stderr
