"""Empty-state messages for the Arbitrage, Low Hold and Sharp Money tabs (odderjam-48).

The repo has no DOM test runner. The message text is tested as pure JS under
node; these tests also read main.jsx to check each tab renders its helper.
"""

import re
import shutil
import subprocess
from pathlib import Path

import pytest

FRONTEND = Path(__file__).resolve().parent.parent / "frontend"
SRC = FRONTEND / "src"


@pytest.mark.skipif(shutil.which("node") is None, reason="node not installed")
def test_empty_state_js():
    result = subprocess.run(["node", "--test", "src/empty.test.js"], cwd=FRONTEND, capture_output=True, text=True)
    assert result.returncode == 0, result.stdout + result.stderr


def _component(name):
    jsx = (SRC / "main.jsx").read_text()
    match = re.search(r"\nfunction " + name + r"\(\) \{(.*?)\n\}\n", jsx, re.S)
    assert match, f"{name} component not found in main.jsx"
    return match.group(1)


@pytest.mark.parametrize("component, helper", [
    ("Arbs", "arbsEmptyText"),
    ("LowHold", "lowHoldEmptyText"),
    ("SharpMoney", "sharpEmptyText"),
])
def test_tab_renders_empty_state(component, helper):
    body = _component(component)
    assert re.search(helper + r"\(data,", body), f"{component} does not call {helper}(data, ...)"
