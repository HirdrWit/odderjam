"""Tracker auto-settle on open (odderjam-120): helpers, wiring and the Settings switch."""
import shutil
import subprocess
from pathlib import Path

import pytest

FRONTEND = Path(__file__).resolve().parent.parent / "frontend"
SRC = FRONTEND / "src"


@pytest.mark.skipif(shutil.which("node") is None, reason="node not installed")
def test_autosettle_js():
    r = subprocess.run(["node", "--test", "src/autosettle.test.js"], cwd=FRONTEND, capture_output=True, text=True)
    assert r.returncode == 0, r.stdout + r.stderr


def test_tracker_calls_due_settle_on_load_without_confirm_or_error_toast():
    jsx = (SRC / "Tracker.jsx").read_text()
    assert "DUE_SETTLE_URL" in jsx and "AUTO_SETTLE_KEY" in jsx and "shouldAutoSettle" in jsx
    block = jsx[jsx.index("DUE_SETTLE_URL", jsx.index("export function Tracker")):]
    block = block[:block.index("DUE_SETTLE_URL") + 900] if "DUE_SETTLE_URL" in block else block
    assert "confirm(" not in block.split("const settle")[0]
    assert "'err'" not in block.split("const settle")[0]


def test_settings_dialog_has_switch():
    main = (SRC / "main.jsx").read_text()
    dialog = main[main.index("function SettingsDialog"):main.index("function SettingsDialog") + 3500]
    assert "Auto-settle when I open the Tracker" in dialog and "AUTO_SETTLE_KEY" in dialog


def test_manual_button_still_confirms():
    jsx = (SRC / "Tracker.jsx").read_text()
    assert "confirm(SETTLE_PROMPT)" in jsx and "fetch('/api/bets/settle', {method: 'POST'})" in jsx
