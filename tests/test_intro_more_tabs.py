"""Intro banners for Parlay, Low Hold, Middles, Sharp Money, Promos, Pick'em (odderjam-60)."""

import re
import shutil
import subprocess
from pathlib import Path

import pytest

FRONTEND = Path(__file__).resolve().parent.parent / "frontend"
SRC = FRONTEND / "src"
TABS = ["Parlay", "Low Hold", "Middles", "Sharp Money", "Promos", "Pick'em"]


@pytest.mark.skipif(shutil.which("node") is None, reason="node not installed")
def test_intro_tabs_js():
    result = subprocess.run(["node", "--test", "src/introtabs.test.js"], cwd=FRONTEND, capture_output=True, text=True)
    assert result.returncode == 0, result.stdout + result.stderr


def _component(name):
    match = re.search(rf"\nfunction {name}\(\) \{{(.*?)\n\}}\n", (SRC / "main.jsx").read_text(), re.S)
    assert match, name
    return match.group(1)


@pytest.mark.parametrize("fn,tab", [("Parlay", "Parlay"), ("LowHold", "Low Hold"), ("Middles", "Middles"),
                                    ("SharpMoney", "Sharp Money"), ("Promos", "Promos")])
def test_main_tabs_render_intro(fn, tab):
    assert f'<TabIntro tab="{tab}"' in _component(fn)


def test_pickem_renders_intro():
    src = (SRC / "Pickem.jsx").read_text()
    assert "<TabIntro tab=\"Pick'em\"" in src or "<TabIntro tab={\"Pick'em\"}" in src
    assert "import {TabIntro}" in src


def test_promo_note_not_duplicated():
    body = _component("Promos")
    assert "PROMOS[kind][1]" not in body
