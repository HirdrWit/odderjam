"""index.html must declare an icon so browsers do not request /favicon.ico (odderjam-50)."""

import re
from pathlib import Path

INDEX = Path(__file__).resolve().parent.parent / "frontend" / "index.html"


def test_index_declares_icon_link():
    html = INDEX.read_text()
    assert re.search(r'<link\s+rel="icon"\s+[^>]*href="[^"]+"', html)


def test_icon_is_self_contained_data_uri():
    html = INDEX.read_text()
    match = re.search(r'<link\s+rel="icon"\s+[^>]*href="([^"]+)"', html)
    assert match, "no icon link"
    assert match.group(1).startswith("data:image/svg+xml"), "icon must not need a separate request"
