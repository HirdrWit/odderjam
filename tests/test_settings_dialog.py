"""Settings dialog (odderjam-108): reachable from every tab, not squeezed into the freshness bar."""

import re
import shutil
import subprocess
from pathlib import Path

import pytest

FRONTEND = Path(__file__).resolve().parent.parent / "frontend"
SRC = FRONTEND / "src"
MAIN = (SRC / "main.jsx").read_text()


@pytest.mark.skipif(shutil.which("node") is None, reason="node not installed")
def test_settings_js():
    r = subprocess.run(["node", "--test", "src/settings.test.js"], cwd=FRONTEND, capture_output=True, text=True)
    assert r.returncode == 0, r.stdout + r.stderr



def test_freshness_strip_keeps_only_freshness_refresh_live():
    strip = MAIN[MAIN.index("function FreshnessStrip"):MAIN.index("/**\n * \"Bet\" button")]
    assert "<details" not in strip and "<AlertWatcher" not in strip and "settings-body" not in strip
    assert "Refresh" in strip and "<LiveToggle" in strip


def test_nav_has_settings_button_outside_tab_conditions():
    nav = MAIN[MAIN.index("<nav>"):MAIN.index("</nav>")]
    assert re.search(r"SETTINGS_LABEL|>Settings<", nav), "sidebar has no Settings item"
    assert "setSettingsOpen(true)" in nav
    assert "showsStrip" not in nav
    # Settings button sits after the nav groups (bottom of the nav).
    assert nav.index("setSettingsOpen(true)") > nav.index("NAV_GROUPS.map")


def test_mobile_more_menu_has_settings():
    more = MAIN[MAIN.index('className="more-menu"'):MAIN.index("<Toaster")]
    assert "setSettingsOpen(true)" in more


def test_dialog_is_accessible_and_has_the_controls():
    dlg = MAIN[MAIN.index("function SettingsDialog"):]
    dlg = dlg[:dlg.index("\nfunction ", 10)] if "\nfunction " in dlg[10:] else dlg
    for needle in ('role="dialog"', 'aria-modal="true"', "aria-labelledby", "API credits left",
                   "Each refresh spends API credits", "<AlertWatcher", "<LiveSettings", "FORMATS",
                   "SETTINGS_LINKS", "Escape"):
        assert needle in dlg, needle
    assert "<SettingsDialog" in MAIN[MAIN.index("function App"):]


def test_ev_tab_opens_requested_panel():
    ev = MAIN[MAIN.index("function PositiveEv"):] if "function PositiveEv" in MAIN else MAIN
    assert "takePanel" in MAIN and "setPanel" in ev
