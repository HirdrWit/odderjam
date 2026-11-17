"""odderjam-105: Arbitrage and Sharp Money filter bars follow the +EV layout."""

import re
import shutil
import subprocess
from pathlib import Path

import pytest

FRONTEND = Path(__file__).resolve().parent.parent / "frontend"
JSX = (FRONTEND / "src" / "main.jsx").read_text()
CSS = (FRONTEND / "src" / "style.css").read_text()


def _fn(name):
    match = re.search(r"\nfunction " + name + r"\(.*?\n\}\n", JSX, re.S)
    assert match, f"{name} not found"
    return match.group(0)


@pytest.mark.skipif(shutil.which("node") is None, reason="node not installed")
def test_barfilters_js():
    r = subprocess.run(["node", "--test", "src/barfilters.test.js"], cwd=FRONTEND, capture_output=True, text=True)
    assert r.returncode == 0, r.stdout + r.stderr


def test_arb_uses_the_ev_filter_bar_pieces():
    body = _fn("Arbs")
    assert 'className="bar filter-bar"' in body
    assert "arbChips(" in body and 'className="chips"' in body
    assert 'className="link"' in body and "Reset" in body


def test_arb_label_has_no_stray_spaces():
    body = _fn("Arbs")
    assert "Min profit % (" not in body
    assert "( arb" not in body and "arb )" not in body


def test_arb_has_no_staking_inputs_of_its_own():
    body = _fn("Arbs")
    assert "<SizingBar" not in body
    assert "Round to" not in body and "Max per side $" not in body
    assert "arbStakingNote(" in body
    assert "useSizing()" in body and "sizingQuery(sizing, true)" in body


def test_arb_total_is_a_labelled_override_with_bankroll_placeholder():
    body = _fn("Arbs")
    assert "sizing.setTotal" in body
    assert "arbTotalPlaceholder(" in body
    assert re.search(r"[Tt]otal[^<]*override|override[^<]*total", body)


def test_arb_sorting_comes_from_table_headers_only():
    body = _fn("Arbs")
    assert "SortBar" not in JSX
    assert "<SortTh" in body and "ARB_COLUMNS" in body
    assert "<TableShell" in body
    assert "ARB_SORT_OPTIONS" not in JSX


def test_sharp_money_uses_labelled_fields_and_one_line_hint():
    body = _fn("SharpMoney")
    assert 'className="bar filter-bar"' in body
    assert "SHARP_FIELDS" in body
    assert "sharpHint(" in body and "sharp-hint" in body
    assert "sharpChips(" in body and 'className="chips"' in body
    assert "Show spikes in the last" not in body
    assert "where volume is at least" not in body


def test_sharp_hint_is_a_single_truncating_line():
    assert re.search(r"\.sharp-hint\s*\{[^}]*white-space:\s*nowrap", CSS)
    assert re.search(r"\.sharp-hint\s*\{[^}]*text-overflow:\s*ellipsis", CSS)


@pytest.mark.parametrize("name", ["Arbs", "SharpMoney"])
def test_no_bare_inputs(name):
    body = _fn(name)
    # every input is wrapped in a <label> so it always has visible text
    inputs = len(re.findall(r"<(?:input|select|PropsFilter)\b", body))
    labels = len(re.findall(r"<label\b", body))
    assert inputs > 0 and labels >= inputs
