"""Glossary tooltips (odderjam-58): node unit tests plus source checks for Term usage."""

import re
import shutil
import subprocess
from pathlib import Path

import pytest

FRONTEND = Path(__file__).resolve().parent.parent / "frontend"
SRC = FRONTEND / "src"


@pytest.mark.skipif(shutil.which("node") is None, reason="node not installed")
def test_glossary_js():
    result = subprocess.run(["node", "--test", "src/glossary.test.js"], cwd=FRONTEND, capture_output=True, text=True)
    assert result.returncode == 0, result.stdout + result.stderr


def _glossary_ids():
    return set(re.findall(r"\bid:\s*'([a-z0-9-]+)'", (SRC / "glossary.js").read_text()))


def _term_ids():
    used = {}
    for path in SRC.glob("*.jsx"):
        for match in re.finditer(r"<Term id=\"([^\"]+)\"", path.read_text()):
            used.setdefault(match.group(1), []).append(path.name)
    return used


def test_every_used_term_has_a_glossary_entry():
    ids = _glossary_ids()
    missing = {t: f for t, f in _term_ids().items() if t not in ids}
    assert not missing, f"<Term> ids without a glossary entry: {missing}"


@pytest.mark.parametrize("term", ["ev", "devig", "hold", "kelly", "clv", "sharp-book", "arb", "american-odds"])
def test_key_terms_are_wrapped_somewhere(term):
    assert term in _term_ids()


def test_term_is_used_in_banners_headers_and_sharp_weights():
    files = {f for fs in _term_ids().values() for f in fs}
    assert {"TabIntro.jsx", "main.jsx", "OddsScreen.jsx"} <= files
    main = (SRC / "main.jsx").read_text()
    sharp = re.search(r"function SharpWeights.*?\n}\n", main, re.S).group(0)
    assert "<Term" in sharp


def test_glossary_page_and_nav():
    main = (SRC / "main.jsx").read_text()
    assert re.search(r"'Glossary':\s*Glossary", main)
    page = (SRC / "Glossary.jsx").read_text()
    assert "sortedEntries" in page


def test_tooltip_is_keyboard_and_touch_accessible():
    term = (SRC / "Term.jsx").read_text()
    assert "tabIndex" in term and 'role="tooltip"' in term
    assert "onFocus" in term and "onBlur" in term
    assert "onMouseEnter" in term and "onClick" in term
    assert "Escape" in term
    assert "tooltipLeft" in term
    css = (SRC / "style.css").read_text()
    assert ".term" in css and "dotted" in css
