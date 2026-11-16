"""Column tooltips, empty states and row examples on the tool tabs (odderjam-61).

No DOM runner: the text is tested as pure JS under node, and main.jsx is read
to check each tab uses the helpers.
"""

import re
import shutil
import subprocess
from pathlib import Path

import pytest

FRONTEND = Path(__file__).resolve().parent.parent / "frontend"
SRC = FRONTEND / "src"


def _component(name):
    jsx = (SRC / "main.jsx").read_text()
    match = re.search(r"\nfunction " + name + r"\(\) \{(.*?)\n\}\n", jsx, re.S)
    assert match, f"{name} component not found in main.jsx"
    return match.group(1)


@pytest.mark.skipif(shutil.which("node") is None, reason="node not installed")
def test_column_help_js():
    result = subprocess.run(["node", "--test", "src/columns.test.js"], cwd=FRONTEND, capture_output=True, text=True)
    assert result.returncode == 0, result.stdout + result.stderr


@pytest.mark.parametrize("component, tab", [
    ("PositiveEv", "+EV"),
    ("LowHold", "Low Hold"),
    ("Middles", "Middles"),
    ("SharpMoney", "Sharp Money"),
])
def test_table_header_cells_use_th_help(component, tab):
    body = _component(component)
    head = re.search(r"<thead>(.*?)</thead>", body, re.S).group(1)
    assert not re.search(r"<th>", head), f"{component} still has a bare <th>"
    assert f'tab="{tab}"' in head, f"{component} headers do not use the {tab} column help"


@pytest.mark.parametrize("component, tab", [
    ("PositiveEv", "+EV"),
    ("Arbs", "Arbitrage"),
    ("LowHold", "Low Hold"),
    ("Middles", "Middles"),
    ("SharpMoney", "Sharp Money"),
])
def test_tab_renders_row_example(component, tab):
    body = _component(component)
    assert re.search(r"<RowExample\b[^>]*tab=\"" + re.escape(tab) + '"', body), f"{component} has no RowExample"


@pytest.mark.parametrize("component, helper", [
    ("PositiveEv", "evEmptyText"),
    ("Middles", "middlesEmptyText"),
])
def test_tab_renders_empty_state(component, helper):
    assert re.search(helper + r"\(data,", _component(component))
