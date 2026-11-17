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


def test_low_hold_uses_default_and_nearest_miss():
    body = _component("LowHold")
    assert "LOW_HOLD_DEFAULT_MAX" in body
    assert re.search(r"lowHoldEmptyText\(data, maxHold, ", body), "LowHold must pass the lowest hold"


def test_arbs_warns_on_negative_min_and_labels_total():
    body = _component("Arbs")
    assert "arbMinWarning(" in body
    assert "ARB_TOTAL_NOTE" in body


# odderjam-78: Sharp Money setup state and filter wording


def test_sharp_money_tab_has_no_env_var_and_defines_contracts():
    body = _component("SharpMoney")
    assert "EXCHANGES" not in body
    assert "Min contracts" not in body
    assert re.search(r"contract is", body, re.I)
    assert "sharp-money/status" in body
    assert re.search(r"sharpEmptyText\(data, k, windowMin, status", body)
    assert "HELP_TAB" in body


@pytest.mark.skipif(shutil.which("node") is None, reason="node not installed")
def test_exchange_setup_js():
    result = subprocess.run(["node", "--test", "src/exchange_setup.test.js"], cwd=FRONTEND, capture_output=True, text=True)
    assert result.returncode == 0, result.stdout + result.stderr
