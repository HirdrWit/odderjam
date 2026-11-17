"""Sortable tables with sticky headers (odderjam-93): node tests plus markup checks."""

import re
import shutil
import subprocess
from pathlib import Path

import pytest

FRONTEND = Path(__file__).resolve().parent.parent / "frontend"
SRC = FRONTEND / "src"


@pytest.mark.skipif(shutil.which("node") is None, reason="node not installed")
def test_sorttable_js():
    result = subprocess.run(["node", "--test", "src/sorttable.test.js"], cwd=FRONTEND, capture_output=True, text=True)
    assert result.returncode == 0, result.stdout + result.stderr


def test_all_five_tables_use_the_shared_helper():
    main = (SRC / "main.jsx").read_text()
    tracker = (SRC / "Tracker.jsx").read_text()
    for tab in ["+EV", "Arbitrage", "Middles", "Low Hold"]:
        assert f'useSort("{tab}"' in main or f"useSort('{tab}'" in main, tab
    assert re.search(r"useSort\(['\"]Tracker['\"]", tracker)
    assert "SortTh" in main and "SortTh" in tracker


def test_default_sorts_match_the_issue():
    text = (SRC / "main.jsx").read_text() + (SRC / "Tracker.jsx").read_text()
    for tab, key, direction in [("+EV", "ev", "desc"), ("Arbitrage", "profit", "desc"), ("Middles", "ev", "desc"),
                                ("Low Hold", "hold", "asc"), ("Tracker", "date", "desc")]:
        pattern = rf"useSort\(['\"]{re.escape(tab)}['\"],\s*\{{key: '{key}', dir: '{direction}'\}}"
        assert re.search(pattern, text), tab


def test_header_rows_are_sticky_with_solid_background_and_border():
    css = (SRC / "style.css").read_text()
    match = re.search(r"thead th\s*\{([^}]*)\}", css)
    assert match, "no thead th rule"
    body = match.group(1)
    assert "position: sticky" in body
    assert re.search(r"background:\s*#[0-9a-fA-F]{3,8}", body)
    assert "border-bottom" in body
