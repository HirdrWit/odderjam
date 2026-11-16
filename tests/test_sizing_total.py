"""odderjam-37: rounded arb stakes must not add up to more than the entered total."""
import itertools

import pytest
from fastapi.testclient import TestClient

from backend import main
from backend.engine import sizing
from backend.engine.odds import american_to_decimal
from backend.providers import mock

GRID = list(itertools.product([100, 105, 120, 150, 300], [-140, -120, -105, 100, 110],
                              [10, 50, 100, 333], [1, 5, 10]))


def _combos(ideal_stakes, inc):
    """Every floor/ceil combination of positive multiples of `inc` around the ideal stakes."""
    options = []
    for s in ideal_stakes:
        lo = (s + 1e-6) // inc * inc
        options.append({x for x in (lo, lo + inc) if x > 0})
    return list(itertools.product(*options))


def _fits(ideal_stakes, inc, total):
    return any(sum(c) <= total + 1e-9 for c in _combos(ideal_stakes, inc))


def test_size_arb_never_exceeds_total():
    for a, b, total, inc in GRID:
        r = sizing.size_arb([a, b], total, inc)
        if _fits(r["ideal_stakes"], inc, total):
            assert r["total_stake"] <= total + 1e-9, (a, b, total, inc, r["stakes"])
            assert r["over_total"] is False


def test_size_arb_issue_example():
    # The ideal split is $81.20 / $18.80; rounding both up gave $82 + $19 = $101 on a $100 total.
    r = sizing.size_arb([-400, 440], 100, 1)
    assert r["total_stake"] <= 100
    assert r["over_total"] is False


def test_size_arb_best_within_total():
    """Within the total, the chosen rounding is still the best worst-case % of all floor/ceil combinations."""
    odds, total, inc = [250, -200, 400], 137, 5
    r = sizing.size_arb(odds, total, inc)
    dec = [american_to_decimal(a) for a in odds]
    best = max(min(s * d for s, d in zip(c, dec)) / sum(c) - 1
               for c in _combos(r["ideal_stakes"], inc) if sum(c) <= total)
    assert r["total_stake"] <= total
    assert r["min_profit_pct"] == pytest.approx(best * 100)


def test_size_arb_flags_unavoidable_overspend():
    # Each ideal stake is about $5; with $10 rounding the smallest arb is $10 + $10 = $20 on a $10 total.
    r = sizing.size_arb([100, 110], 10, 10)
    assert r["stakes"] == [10, 10] and r["total_stake"] == 20
    assert r["over_total"] is True
    assert r["warning"] is not None and "$10.00 over" in r["warning"]


def test_size_arb_overspend_and_loss_both_warned():
    # Forced to $10 + $10 on a $10 total: over budget, and the -105 side now loses.
    r = sizing.size_arb([300, -105], 10, 10)
    assert r["over_total"] is True and r["rounding_loss"] is True
    assert "over" in r["warning"] and "lose" in r["warning"]


@pytest.fixture
def client(monkeypatch):  # conftest gives each test its own DB
    monkeypatch.setattr(main, "get_snapshot", lambda: mock.snapshot(seed=1))
    return TestClient(main.app)


@pytest.mark.parametrize("total", [100, 200])
def test_arbs_endpoint_respects_total(client, total):
    rows = client.get("/api/arbs", params={"total": total, "round_to": 1, "min_profit": -100}).json()
    assert rows
    assert all("over_total" in r for r in rows)
    over = [r for r in rows if r["total_stake"] > total + 1e-9]
    assert all(r["over_total"] and r["warning"] for r in over)
    assert not over
