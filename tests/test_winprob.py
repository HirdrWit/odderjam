"""Win % / Implied % columns (odderjam-129): node tests for the helpers and source wiring."""

import shutil
import subprocess
from pathlib import Path

import pytest

FRONTEND = Path(__file__).resolve().parent.parent / "frontend"


@pytest.mark.skipif(shutil.which("node") is None, reason="node not installed")
def test_winprob_js():
    result = subprocess.run(["node", "--test", "src/winprob.test.js"], cwd=FRONTEND, capture_output=True, text=True)
    assert result.returncode == 0, result.stdout + result.stderr
