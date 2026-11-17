"""Freshness strip (odderjam-95): node tests plus markup checks."""

import re
import shutil
import subprocess
from pathlib import Path

import pytest

FRONTEND = Path(__file__).resolve().parent.parent / "frontend"
SRC = FRONTEND / "src"


@pytest.mark.skipif(shutil.which("node") is None, reason="node not installed")
def test_freshness_js():
    result = subprocess.run(["node", "--test", "src/freshness.test.js"], cwd=FRONTEND, capture_output=True, text=True)
    assert result.returncode == 0, result.stdout + result.stderr


def test_strip_sits_above_the_page_in_the_content_area():
    main = (SRC / "main.jsx").read_text()
    match = re.search(r"<div className=\"content\">(.*?)</div>\s*<Toaster", main, re.S)
    assert match
    body = match.group(1)
    assert "<FreshnessStrip" in body
    assert body.index("<FreshnessStrip") < body.index("<Page")


def test_sidebar_footer_no_longer_holds_credits_or_alerts():
    main = (SRC / "main.jsx").read_text()
    nav = main[main.index("<nav>"):main.index("</nav>")]
    assert "<RefreshBox" not in nav and "<AlertWatcher" not in nav


def test_stale_rows_have_class_and_accessible_label():
    main = (SRC / "main.jsx").read_text()
    live_tag = main[main.index("function LiveTag"):main.index("/** Freshness strip above")]
    assert "rowFreshness" in live_tag and "aria-label" in live_tag
    css = (SRC / "style.css").read_text()
    assert re.search(r"\.stale\b", css) and re.search(r"\.fresh-strip\.stale", css)
