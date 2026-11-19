"""Arbs, alerts and edge cases under per-class sharp weights (odderjam-131 review follow-ups)."""
from backend import alerts, main, scan
from backend.engine import sharp

NOW = 0.0
SPEC = "main:Pinnacle:1;props:Pinnacle:0.5"


def arb_event():
    return {"id": "e1", "sport": "NBA", "home": "Nets", "away": "76ers", "start": "2099-01-01T00:00:00Z",
            "markets": {"moneyline": [
                {"name": "Nets", "point": None, "player": None,
                 "prices": {"Pinnacle": -105, "DraftKings": 115}},
                {"name": "76ers", "point": None, "player": None,
                 "prices": {"Pinnacle": -105, "FanDuel": 115}}]}}


def test_arb_legs_carry_ev_with_per_class_weights():
    rows = scan.arb_rows([arb_event()], weights=sharp.parse_weights(SPEC), max_hold=10.0, now=NOW)
    assert rows and all(leg["ev_pct"] is not None for leg in rows[0]["legs"])


def test_arb_rows_per_class_matches_flat():
    flat = scan.arb_rows([arb_event()], weights=sharp.parse_weights("Pinnacle:1"), max_hold=10.0, now=NOW)
    cls = scan.arb_rows([arb_event()], weights=sharp.parse_weights(SPEC), max_hold=10.0, now=NOW)
    assert [l["ev_pct"] for l in flat[0]["legs"]] == [l["ev_pct"] for l in cls[0]["legs"]]


def test_all_books_empty_outcomes_is_none():
    assert sharp.group_consensus([], {}, all_books=True) is None


def test_alerts_bad_env_spec_does_not_raise(monkeypatch):
    monkeypatch.setattr(alerts, "sharp_weights_spec", lambda: "main:Pinnacle:abc")
    rule = {"kind": "ev", "market": None, "sport": None, "book": None, "min_value": 0.0}
    assert alerts.matches(rule, [arb_event()]) == []
