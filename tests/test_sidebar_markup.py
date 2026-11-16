"""Sidebar markup checks for the Browser alerts toggle (odderjam-40).

The repo has no DOM test runner, so these tests read the JSX and CSS source.
The global ``input`` rule gives every input a 90px width. A checkbox label
that does not opt out of it wraps its text in the narrow sidebar.
"""

import re
from pathlib import Path

SRC = Path(__file__).resolve().parent.parent / "frontend" / "src"


def _browser_alerts_label():
    """Return the class list of the label holding the alerts checkbox."""
    jsx = (SRC / "main.jsx").read_text()
    match = re.search(
        r'<label className="([^"]*)">\s*'
        r'<input type="checkbox" checked=\{on && notificationsAllowed\(\)\}[^>]*/>',
        jsx,
    )
    assert match, "Browser alerts label not found in main.jsx"
    return match.group(1).split()


def _css_declarations(selector):
    css = (SRC / "style.css").read_text()
    match = re.search(r"(?:^|[}\s])" + re.escape(selector) + r"\s*\{([^}]*)\}", css)
    assert match, f"no rule for {selector!r} in style.css"
    return match.group(1)


def test_browser_alerts_label_uses_chk_layout():
    classes = _browser_alerts_label()
    assert "chk" in classes, f"label classes {classes} miss 'chk'; checkbox gets the 90px input width"
    assert "mut" in classes, f"label classes {classes} lost the muted colour"
    assert re.search(r"width\s*:\s*auto", _css_declarations(".chk input"))

