"""Promos is a sortable table (odderjam-109): node tests plus markup checks."""

import re
import shutil
import subprocess
from pathlib import Path

import pytest

FRONTEND = Path(__file__).resolve().parent.parent / "frontend"
MAIN = (FRONTEND / "src" / "main.jsx").read_text()


def _promos_body():
    return re.search(r"\nfunction Promos\(\) \{(.*?)\n\}\n", MAIN, re.S).group(1)


@pytest.mark.skipif(shutil.which("node") is None, reason="node not installed")
def test_promos_js():
    r = subprocess.run(["node", "--test", "src/promos.test.js"], cwd=FRONTEND, capture_output=True, text=True)
    assert r.returncode == 0, r.stdout + r.stderr


def test_promos_uses_the_shared_sortable_table():
    body = _promos_body()
    assert re.search(r"useSort\(['\"]Promos['\"],\s*PROMO_DEFAULT_SORT", body)
    assert "SortTh" in body and "PROMO_COLUMNS" in body
    assert '<table className="cards"' in body
    assert "<thead>" in body and "<tbody>" in body


def test_promo_card_list_is_gone():
    assert "PromoCard" not in MAIN


def test_promos_has_track_action_and_phone_roles():
    body = _promos_body()
    assert 'aria-label="Track"' in body or 'aria-label="Actions"' in body
    for cls in ["c-ev", "c-event", "c-actions", "num"]:
        assert cls in body
