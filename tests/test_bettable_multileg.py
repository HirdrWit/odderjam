"""Bettable flags on Arbitrage, Middles and Low Hold rows (odderjam-117)."""
import re
import shutil
import subprocess
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend import main, scan
from backend.bettable import multi_leg_flags

ROOT = Path(__file__).resolve().parent.parent
NOW = datetime(2026, 1, 1, 12, 0, 0, tzinfo=timezone.utc)
FUTURE = (NOW + timedelta(hours=5)).isoformat()


def iso(seconds_ago):
    return (NOW - timedelta(seconds=seconds_ago)).isoformat()


def outcome(name, point, **prices):
    return {"name": name, "point": point, "prices": prices}


def arb_event(odds_a, odds_b, upd_a=5, upd_b=5, start=FUTURE):
    return {"id": "e", "sport": "NBA", "home": "A", "away": "B", "start": start,
            "updated": {"DraftKings": iso(upd_a), "FanDuel": iso(upd_b)},
            "markets": {"moneyline": [outcome("A", None, DraftKings=odds_a), outcome("B", None, FanDuel=odds_b)]}}


def rows(event, **kw):
    return scan.arb_rows([event], now=NOW.timestamp(), **kw)


def test_leg_skew_flag_when_legs_45s_apart():  # I1
    r = rows(arb_event(110, 110, upd_a=50, upd_b=5))
    assert "leg_skew" in r[0]["flags"]


def test_fresh_small_pregame_arb_has_no_flags():  # I2
    r = rows(arb_event(103, 103))
    assert 1 < r[0]["profit_pct"] < 5
    assert r[0]["flags"] == []


def test_ten_percent_arb_is_too_good():  # I2
    # +120/+120 is a 10% arb at -9.1% hold: above TOO_GOOD_ARB_PCT, inside suspect's HOLD_FLOOR_PCT.
    r = rows(arb_event(120, 120))
    assert r[0]["profit_pct"] > 5
    assert "too_good" in r[0]["flags"]


def test_longshot_leg_and_in_play():
    r = rows(arb_event(1200, -900))
    assert "longshot_leg" in r[0]["flags"]
    live = rows(arb_event(103, 103, start=iso(600)))
    assert live and "in_play" in live[0]["flags"]


def test_multi_leg_flags_unit():
    ev = {"sport": "NBA", "start": FUTURE, "updated": {"X": iso(1), "Y": iso(30)}}
    t = NOW.timestamp()
    assert multi_leg_flags(ev, ["X", "Y"], [-110, -110], t) == ["leg_skew"]
    assert multi_leg_flags(ev, ["X", "X"], [-110, 1001], t) == ["longshot_leg"]
    assert multi_leg_flags(ev, ["X", "X"], [-110, 1000], t) == []
    assert multi_leg_flags(ev, ["X", "X"], [-110, -110], t, ev_pct=99) == ["too_good"]


@pytest.fixture
def client(monkeypatch):
    flagged = arb_event(120, 120)  # too good, still above the hold floor
    flagged["id"] = "bad"
    clean = arb_event(103, 103)
    monkeypatch.setattr(main, "get_snapshot", lambda: [flagged, clean])
    monkeypatch.setattr(main, "_now", lambda: NOW.timestamp())
    return TestClient(main.app)


def test_arbs_bettable_param_drops_flagged(client):  # I3
    assert len(client.get("/api/arbs").json()) == 2
    got = client.get("/api/arbs?bettable=true").json()
    assert len(got) == 1 and got[0]["flags"] == []


def test_lowhold_and_middles_carry_flags(monkeypatch):  # I3
    skewed = arb_event(105, -105, upd_a=50, upd_b=1)
    skewed["id"] = "s"
    clean = arb_event(105, -105)
    clean["id"] = "c"
    mid_bad = {"id": "m1", "sport": "NBA", "home": "A", "away": "B", "start": FUTURE,
               "updated": {"DraftKings": iso(60), "FanDuel": iso(1)},
               "markets": {"totals": [outcome("Over", 220.5, DraftKings=-110), outcome("Under", 220.5, DraftKings=-110),
                                      outcome("Over", 224.5, FanDuel=-110), outcome("Under", 224.5, FanDuel=-110)]}}
    monkeypatch.setattr(main, "get_snapshot", lambda: [skewed, clean, mid_bad])
    monkeypatch.setattr(main, "_now", lambda: NOW.timestamp())
    c = TestClient(main.app)
    lh = c.get("/api/lowhold?max_hold=100").json()
    assert all("flags" in r for r in lh)
    assert any(r["flags"] for r in lh) and any(not r["flags"] for r in lh)
    kept = c.get("/api/lowhold?max_hold=100&bettable=true").json()
    assert kept and all(not r["flags"] for r in kept)
    mids = c.get("/api/middles?max_cost=100").json()
    assert mids and all("flags" in r for r in mids)
    assert any("leg_skew" in r["flags"] for r in mids)
    assert all(not r["flags"] for r in c.get("/api/middles?max_cost=100&bettable=true").json())


def test_filterset_has_bettable():
    from backend.routes.filters import FilterSet
    assert FilterSet().bettable is False
    assert FilterSet(bettable=True).bettable is True


def test_frontend_tabs_use_the_toggle():  # I4
    src = (ROOT / "frontend/src/main.jsx").read_text()
    for name in ("Arbs", "LowHold", "Middles"):
        body = src[src.index(f"function {name}("):]
        body = body[:re.search(r"\n}\n", body).end()]
        assert "useBettableRows(" in body, name
        assert "<BettableNote" in body, name
        # badges render directly or through a row component that renders <RiskBadges>
        assert re.search(r"badgesFor\(|<RiskBadges|<ArbRow", body), name
    assert "<RiskBadges" in src[src.index("function ArbRow("):]


@pytest.mark.skipif(shutil.which("node") is None, reason="node missing")
def test_multileg_flag_copy_js():
    r = subprocess.run(["node", "--test", "src/multileg.test.js"], cwd=ROOT / "frontend", capture_output=True, text=True)
    assert r.returncode == 0, r.stdout + r.stderr
