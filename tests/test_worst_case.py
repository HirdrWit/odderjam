"""Worst-case devig across every method and every sharp (odderjam-130)."""
from datetime import datetime, timezone
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend import main, providers, scan
from backend.engine import devig, ev, odds, sharp

NOW = datetime(2026, 11, 15, 20, 0, tzinfo=timezone.utc).timestamp()
SRC = Path(__file__).resolve().parent.parent / "frontend" / "src"


def probs(*prices):
    return [odds.american_to_prob(p) for p in prices]


# ---- I1 ----------------------------------------------------------------------------------

@pytest.mark.parametrize("line", [probs(-300, 250), probs(300, -380), probs(150, 230, 180)])
def test_worst_case_is_least_favourable_of_all_four_methods(line):
    all_four = [devig.multiplicative(line), devig.additive(line), devig.power(line), devig.shin(line)]
    assert devig.worst_case(line) == pytest.approx([min(c) for c in zip(*all_four)])


def test_worst_case_is_never_above_any_method_so_ev_never_beats_them():
    line = probs(150, 230, 180)
    worst = devig.worst_case(line)
    for f in (devig.multiplicative, devig.additive, devig.power, devig.shin):
        assert all(w <= x + 1e-12 for w, x in zip(worst, f(line)))
    assert any(w < m - 1e-6 for w, m in zip(worst, devig.multiplicative(line)))


# ---- I2 ----------------------------------------------------------------------------------

def outcomes(pin, circa, dk):
    return [{"name": "A", "point": None, "prices": {"Pinnacle": pin[0], "Circa Sports": circa[0], "DraftKings": dk[0]}},
            {"name": "B", "point": None, "prices": {"Pinnacle": pin[1], "Circa Sports": circa[1], "DraftKings": dk[1]}}]


WEIGHTS = {"Pinnacle": 1.0, "Circa Sports": 0.5}


def test_worst_consensus_takes_max_per_outcome_and_names_book():
    outs = outcomes((-110, -110), (-125, 105), (105, -140))
    r = sharp.worst_consensus(outs, WEIGHTS, None)
    pin = devig.worst_case(probs(-110, -110))
    circa = devig.worst_case(probs(-125, 105))
    assert r["probs"] == pytest.approx([min(pin[0], circa[0]), min(pin[1], circa[1])])
    assert r["books"] == ["Circa Sports" if circa[0] < pin[0] else "Pinnacle",
                          "Circa Sports" if circa[1] < pin[1] else "Pinnacle"]


def test_worst_consensus_none_without_usable_sharp():
    assert sharp.worst_consensus(outcomes((-110, -110), (-110, -110), (1, 1))[:], {"Nobody": 1.0}, None) is None


def test_worst_consensus_respects_max_hold():
    outs = outcomes((-110, -110), (-150, -150), (105, -140))  # Circa hold ~20%
    r = sharp.worst_consensus(outs, WEIGHTS, 5.0)
    assert r["books"] == ["Pinnacle", "Pinnacle"]


def test_worst_ev_is_lower_of_two_single_book_worst_evs():
    outs = outcomes((-110, -110), (-125, 105), (105, -140))
    ev_rows = scan.ev_rows([event("x", outs)], WEIGHTS, 10.0, now=NOW)
    row = next(r for r in ev_rows if r["book"] == "DraftKings" and r["name"] == "A")
    singles = [ev.ev_pct(devig.worst_case(probs(*pr))[0], 105) for pr in ((-110, -110), (-125, 105))]
    assert row["worst_ev_pct"] == pytest.approx(min(singles))
    assert row["worst_sharp"] == ("Pinnacle" if singles[0] < singles[1] else "Circa Sports")


# ---- I3 / I4 -----------------------------------------------------------------------------

def event(eid, outs):
    stamp = datetime.fromtimestamp(NOW - 5, timezone.utc).isoformat()
    return {"id": eid, "sport": "NBA", "home": "A", "away": "B",
            "start": datetime.fromtimestamp(NOW + 7200, timezone.utc).isoformat(),
            "markets": {"moneyline": outs},
            "updated": {"Pinnacle": stamp, "Circa Sports": stamp, "DraftKings": stamp}}


@pytest.fixture
def client(monkeypatch):
    # Pinnacle -110/-110; Circa shades A heavily so the consensus EV of DK +105 is ~3% but the worst is lower.
    outs = outcomes((-110, -110), (-135, 115), (105, -140))
    monkeypatch.setattr(main, "get_snapshot", lambda: [event("e1", outs)])
    monkeypatch.setattr(main, "_now", lambda: NOW)
    providers.reset_live()
    yield TestClient(main.app)
    providers.reset_live()


def dk_a(rows):
    return next(r for r in rows if r["book"] == "DraftKings" and r["name"] == "A")


def test_rows_carry_worst_fields(client):
    row = dk_a(client.get("/api/ev").json())
    assert isinstance(row["worst_ev_pct"], float) and row["worst_sharp"] in ("Pinnacle", "Circa Sports")


def test_worst_case_method_filters_min_ev_on_worst_ev(client):
    base = dk_a(client.get("/api/ev").json())
    assert base["ev_pct"] > base["worst_ev_pct"]
    mid = (base["ev_pct"] + base["worst_ev_pct"]) / 2
    kept = client.get("/api/ev", params={"min_ev": mid}).json()
    assert any(r["book"] == "DraftKings" and r["name"] == "A" for r in kept)
    dropped = client.get("/api/ev", params={"method": "worst_case", "min_ev": mid}).json()
    assert not any(r["book"] == "DraftKings" and r["name"] == "A" for r in dropped)


def test_worst_case_method_ranks_by_worst_ev(client):
    rows = client.get("/api/ev", params={"method": "worst_case", "min_ev": -100}).json()
    vals = [r["worst_ev_pct"] for r in rows]
    assert vals == sorted(vals, reverse=True)


def test_fragile_uses_worst_consensus_value(client):
    row = dk_a(client.get("/api/ev", params={"min_ev": -100}).json())
    assert ("fragile" in row["flags"]) == (row["worst_ev_pct"] < 0)


# ---- I5 ----------------------------------------------------------------------------------

def test_ev_tab_has_worst_ev_column_and_option():
    jsx = (SRC / "main.jsx").read_text()
    assert "['worst', 'Worst EV'" in (SRC / "evcolumns.js").read_text() and "r.worst_ev_pct" in jsx and "r.worst_sharp" in jsx
    cols = (SRC / "columns.js").read_text()
    assert "Worst EV" in cols
    assert "worst-ev" in (SRC / "glossary.js").read_text()
    assert "worst_case: 'Worst case'" in (SRC / "evbar.js").read_text()
