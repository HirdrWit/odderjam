"""Sharp weights UI helpers (odderjam-131): node unit tests plus Model settings source checks."""
import shutil
import subprocess
from pathlib import Path

import pytest

FRONTEND = Path(__file__).resolve().parent.parent / "frontend"


@pytest.mark.skipif(shutil.which("node") is None, reason="node not installed")
def test_sharpweights_js():
    r = subprocess.run(["node", "--test", "src/sharpweights.test.js"], cwd=FRONTEND, capture_output=True, text=True)
    assert r.returncode == 0, r.stdout + r.stderr


def test_model_settings_shows_recommended_weights_reset_and_fair_source():
    src = (FRONTEND / "src" / "main.jsx").read_text()
    assert "Recommended weights" in src
    assert "FAIR_SOURCES" in src and "fair_source=" in src
    assert "sharpweights.js" in src
