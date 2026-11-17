"""Row action cell (odderjam-89): Bet, Track and + Slip sit in one flex row of equal height."""

import re
from pathlib import Path

SRC = Path(__file__).resolve().parent.parent / "frontend" / "src"


def _css_rule(selector):
    css = (SRC / "style.css").read_text()
    m = re.search(re.escape(selector) + r"\s*\{([^}]*)\}", css)
    assert m, f"{selector} rule missing"
    return m.group(1)


def test_row_actions_is_a_nowrap_free_flex_row_with_gap():
    body = _css_rule("td.row-actions .row-actions-inner")
    assert "display: flex" in body
    assert "flex-wrap: wrap" in body
    assert "gap" in body
    assert "align-items: stretch" in body


def test_row_actions_children_share_height():
    body = _css_rule("td.row-actions .row-actions-inner > *")
    assert "box-sizing: border-box" in body
    assert "line-height" in body
    assert "padding" in body


def test_ev_and_middles_cells_use_shared_class():
    main = (SRC / "main.jsx").read_text()
    assert main.count('className="row-actions"') >= 2
    assert main.count("row-actions-inner") >= 2


def test_no_bare_space_separators_in_ev_action_cell():
    main = (SRC / "main.jsx").read_text()
    m = re.search(r'<td className="row-actions">.*?</td>', main, re.S)
    assert m
    assert "{' '}" not in m.group(0)
