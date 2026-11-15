import itertools

import pytest
from fastapi.testclient import TestClient

from backend import main
from backend.engine import sizing
from backend.engine.odds import american_to_decimal
from backend.routes import bets


def test_round_stake_nearest_and_capped():
    assert sizing.round_stake(13.47, 5) == 15
    assert sizing.round_stake(12.49, 5) == 10
    assert sizing.round_stake(13.47, 1) == 13
    assert sizing.round_stake(13.47, None) == 13.47
    assert sizing.round_stake(812, 5, 300) == 300
    assert sizing.round_stake(812, 10, 305) == 300  # cap is rounded down to the increment
    assert sizing.round_stake(0, 5) == 0


def test_cap_smaller_than_increment_is_rejected():
    with pytest.raises(ValueError):
        sizing.round_stake(10, 10, 5)


@pytest.mark.parametrize("inc", [1, 5, 10])
def test_size_arb_stakes_are_multiples_and_profits_match(inc):
    odds = [110, -105]
    r = sizing.size_arb(odds, 100, inc)
    assert all(s % inc == 0 for s in r["stakes"])
    assert r["total_stake"] == pytest.approx(sum(r["stakes"]))
    for s, a, p in zip(r["stakes"], odds, r["profits"]):
        assert p == pytest.approx(s * american_to_decimal(a) - r["total_stake"])
    assert r["min_profit"] == min(r["profits"]) and r["max_profit"] == max(r["profits"])


def test_size_arb_unrounded_matches_plain_arb():
    r = sizing.size_arb([110, 110], 100, None)
    assert r["stakes"] == [50, 50]
    assert r["min_profit"] == pytest.approx(5) == r["max_profit"]
    assert not r["rounding_loss"] and r["warning"] is None


def test_size_arb_max_per_side_scales_down():
    r = sizing.size_arb([110, -105], 1000, 5, 300)
    assert max(r["stakes"]) <= 300 and r["capped"]
    assert r["total_stake"] < 1000
    assert r["min_profit"] > 0


def test_size_arb_picks_best_rebalance():
    """The chosen rounding is never worse (worst-case %) than any other floor/ceil combination."""
    odds, total, inc = [250, -200, 400], 137, 5
    r = sizing.size_arb(odds, total, inc)
    dec = [american_to_decimal(a) for a in odds]
    options = [(s // inc * inc, s // inc * inc + inc) for s in r["ideal_stakes"]]
    best = max(min(s * d for s, d in zip(c, dec)) / sum(c) - 1 for c in itertools.product(*options) if all(c))
    assert r["min_profit_pct"] == pytest.approx(best * 100)


def test_size_arb_warns_when_rounding_creates_a_loss():
    # A thin 0.4% arb on a $20 total: $10 rounding can't keep both outcomes profitable.
    odds = [105, -103]
    assert sizing.size_arb(odds, 20, None)["min_profit"] > 0
    r = sizing.size_arb(odds, 20, 10)
    assert r["min_profit"] < 0
    assert r["rounding_loss"] and "lose" in r["warning"]


def test_size_arb_never_silently_loses():
    """Fuzz: whenever a profitable arb's rounded stakes lose on any outcome, it is flagged."""
    for a, b, total, inc in itertools.product([100, 105, 120, 150, 300], [-140, -120, -105, 100, 110],
                                              [10, 50, 100, 333], [1, 5, 10]):
        r = sizing.size_arb([a, b], total, inc)
        if r["ideal_profit_pct"] >= 0:
            assert r["rounding_loss"] == (r["min_profit"] < -1e-9)
            assert (r["warning"] is not None) == r["rounding_loss"]


def test_low_hold_has_no_rounding_warning():
    r = sizing.size_arb([-110, -110], 200, 5)
    assert r["stakes"] == [100, 100] and r["min_profit"] < 0
    assert not r["rounding_loss"] and r["warning"] is None


def test_size_bonus_hedge():
    r = sizing.size_bonus_hedge(100, 250, -300, 5)
    assert r["ideal_hedge"] == pytest.approx(187.5)
    assert r["hedge_stake"] in (185, 190)
    assert r["profit_if_bonus_wins"] == pytest.approx(250 - r["hedge_stake"])
    assert r["profit_if_hedge_wins"] == pytest.approx(r["hedge_stake"] / 3)
    capped = sizing.size_bonus_hedge(100, 250, -300, 5, 100)
    assert capped["hedge_stake"] == 100 and capped["capped"]


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(bets, "DB", tmp_path / "t.db")
    return TestClient(main.app)


def test_api_arbs_use_sizing(client):
    rows = client.get("/api/arbs", params={"min_profit": -100, "total": 500, "round_to": 5, "max_side": 200}).json()
    assert rows
    for r in rows:
        assert all(leg["stake"] % 5 == 0 and leg["stake"] <= 200 for leg in r["legs"])
        assert r["total_stake"] == pytest.approx(sum(leg["stake"] for leg in r["legs"]))
        assert r["min_profit"] == pytest.approx(min(leg["profit_if_wins"] for leg in r["legs"]))


def test_api_arbs_default_total_is_bankroll(client):
    client.put("/api/bankroll", json={"starting": 1000})
    rows = client.get("/api/arbs", params={"min_profit": -100, "round_to": 0}).json()
    assert all(r["total_stake"] == pytest.approx(1000, abs=0.05) for r in rows)


def test_api_ev_rounds_kelly(client):
    client.put("/api/bankroll", json={"starting": 1000})
    rows = client.get("/api/ev", params={"min_ev": 0, "round_to": 5, "max_side": 20}).json()
    assert rows
    for r in rows:
        assert r["stake"] % 5 == 0 and r["stake"] <= 20
        assert r["stake"] == sizing.round_stake(r["kelly_stake"], 5, 20)


def test_api_rejects_cap_below_increment(client):
    assert client.get("/api/arbs", params={"round_to": 10, "max_side": 5}).status_code == 400
