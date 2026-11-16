"""Intro banners and field help for Tracker and Alerts (odderjam-63): node tests plus source checks (no DOM runner)."""

import re
import shutil
import subprocess
from pathlib import Path

import pytest

FRONTEND = Path(__file__).resolve().parent.parent / "frontend"
SRC = FRONTEND / "src"


def _read(name):
    return (SRC / name).read_text()


def _alerts_body():
    match = re.search(r"\nfunction Alerts\(\) \{(.*?)\n\}\n", _read("main.jsx"), re.S)
    assert match, "Alerts component not found"
    return match.group(1)


@pytest.mark.skipif(shutil.which("node") is None, reason="node not installed")
def test_tracker_help_js():
    result = subprocess.run(["node", "--test", "src/trackerhelp.test.js"], cwd=FRONTEND, capture_output=True, text=True)
    assert result.returncode == 0, result.stdout + result.stderr


def test_tracker_renders_intro():
    assert re.search(r"<TabIntro tab=\"Tracker\"", _read("Tracker.jsx"))


def test_alerts_renders_intro():
    assert re.search(r"<TabIntro tab=\"Alerts\"", _alerts_body())


@pytest.mark.parametrize("term", ["closing-odds", "bonus-bet", "clv", "sharp-clv", "strategy"])
def test_tracker_wraps_terms(term):
    assert f'<Term id="{term}"' in _read("Tracker.jsx")


@pytest.mark.parametrize("term", ["min-percent", "discord-webhook"])
def test_alerts_wraps_terms(term):
    assert f'<Term id="{term}"' in _alerts_body()


def test_tracker_uses_empty_state_helper():
    assert re.search(r"trackerEmptyText\(all\)", _read("Tracker.jsx"))
