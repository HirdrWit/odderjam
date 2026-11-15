import pytest
from fastapi.testclient import TestClient

from backend import main
from backend.engine import middles
from backend.providers import mock


def make_outcome(name, point, **prices):
    return {"name": name, "point": point, "prices": prices}


def test_middle_equal_stakes_at_minus_110():
    # Over 44.5 -110 / Under 46.5 -110, $100 each: misses lose the vig, hitting 45 or 46 wins both.
    m = middles.middle(44.5, -110, 46.5, -110, stakes=(100, 100))
    assert m["window"] == 2
    assert m["win_both"] == pytest.approx(181.82, abs=0.01)
    assert m["miss_low"] == m["miss_high"] == m["worst_case"] == pytest.approx(-9.09, abs=0.01)


def test_middle_default_split_equalises_misses():
    m = middles.middle(220.5, 120, 222.5, -150, stake=100)
    assert m["stake_a"] + m["stake_b"] == pytest.approx(100)
    assert m["miss_low"] == pytest.approx(m["miss_high"])
    # Over pays 2.2x, Under 1.667x: stake_a * 2.2 == stake_b * 1.667
    assert m["stake_a"] == pytest.approx(100 * (5 / 3) / (2.2 + 5 / 3))
    assert m["worst_case"] == pytest.approx(m["stake_a"] * 2.2 - 100)


def test_middle_misses_are_asymmetric_with_uneven_odds_and_equal_stakes():
    m = middles.middle(3.5, 150, 4.5, -200, stakes=(100, 100))
    assert m["miss_high"] == pytest.approx(150 - 100)  # only over wins
    assert m["miss_low"] == pytest.approx(50 - 100)  # only under wins
    assert m["worst_case"] == pytest.approx(-50)


def test_settle_handles_window_misses_and_pushes():
    args = (3, -110, 100, 7, -110, 100)  # over 3 / under 7 on whole numbers
    win = 100 / 1.1
    assert middles.settle(5, *args[:3], *args[3:]) == pytest.approx(2 * win)  # both
    assert middles.settle(3, *args[:3], *args[3:]) == pytest.approx(win)  # over pushes, under wins
    assert middles.settle(7, *args[:3], *args[3:]) == pytest.approx(win)  # under pushes, over wins
    assert middles.settle(1, *args[:3], *args[3:]) == pytest.approx(win - 100)
    assert middles.settle(9, *args[:3], *args[3:]) == pytest.approx(win - 100)


def test_pmf_sums_to_one_and_respects_key_numbers():
    flat = middles.outcome_pmf(0, 13.5)
    nfl = middles.outcome_pmf(0, 13.5, middles.NFL_KEY_MULT)
    assert sum(flat.values()) == pytest.approx(1) and sum(nfl.values()) == pytest.approx(1)
    assert nfl[3] > nfl[4] > nfl[2] and nfl[3] > 2 * flat[3]
    assert min(middles.outcome_pmf(1, 3, lo=0)) == 0


def test_middle_ev_matches_hand_computation():
    pmf = {44: 0.5, 45: 0.2, 47: 0.3}
    m = middles.middle(44.5, -110, 46.5, -110, stakes=(100, 100))
    r = middles.middle_ev(m, 44.5, -110, 46.5, -110, pmf)
    assert r["hit_prob"] == pytest.approx(0.2)
    assert r["ev"] == pytest.approx(0.2 * m["win_both"] + 0.8 * m["worst_case"])
    assert r["ev_pct"] == pytest.approx(r["ev"] / 2)


def test_key_number_window_is_worth_more_in_nfl():
    on3 = middles.model_pmf("NFL", "spreads", 0)

    def hit(la, lb):
        return sum(p for k, p in on3.items() if la < k < lb)

    assert hit(2.5, 3.5) > 2 * hit(3.5, 4.5)


@pytest.fixture
def discrepancy(monkeypatch):
    ev = {"id": "x", "sport": "NFL", "home": "A", "away": "B", "start": "t", "markets": {
        "totals": [make_outcome("Over", 44.5, DraftKings=-105, Pinnacle=-110), make_outcome("Under", 44.5, Pinnacle=-110),
                   make_outcome("Over", 46.5, FanDuel=-110), make_outcome("Under", 46.5, FanDuel=-102)],
        "spreads": [make_outcome("A", -2.5, BetMGM=-110), make_outcome("B", 2.5, BetMGM=-110),
                    make_outcome("A", -3.5, Caesars=-110), make_outcome("B", 3.5, Caesars=-108)]}}
    monkeypatch.setattr(main, "get_snapshot", lambda: [ev])
    return TestClient(main.app)


def test_endpoint_finds_total_and_spread_middles(discrepancy):
    rows = discrepancy.get("/api/middles").json()
    by_market = {r["market"]: r for r in rows}
    assert set(by_market) == {"totals", "spreads"}

    t = by_market["totals"]
    assert (t["low"], t["high"], t["window"]) == (44.5, 46.5, 2)
    over, under = t["legs"]
    assert (over["pick"], over["book"], over["odds"]) == ("Over 44.5", "DraftKings", -105)
    assert (under["pick"], under["book"], under["odds"]) == ("Under 46.5", "FanDuel", -102)
    assert over["stake"] + under["stake"] == pytest.approx(100)
    assert 0 < t["hit_prob"] < 1 and t["win_both"] > 0 > t["worst_case"]
    assert t["cost_pct"] == pytest.approx(-t["worst_case"])

    # Home -2.5 at BetMGM wins on margin >= 3; away +3.5 at Caesars wins on margin <= 3: middle on exactly 3.
    s = by_market["spreads"]
    assert [leg["pick"] for leg in s["legs"]] == ["A -2.5", "B +3.5"]
    assert (s["low"], s["high"], s["window"]) == (2.5, 3.5, 1)
    assert s["hit_prob"] > 0.06  # ~7%: 3 is the NFL key number (a smooth normal gives ~3%)


def test_endpoint_filters(discrepancy):
    assert {r["market"] for r in discrepancy.get("/api/middles", params={"min_window": 1.5}).json()} == {"totals"}
    assert {r["market"] for r in discrepancy.get("/api/middles", params={"market": "spreads"}).json()} == {"spreads"}
    # Totals cost ~1.7% of stake (-105/-102), spreads ~4.1% (-110/-108).
    assert {r["market"] for r in discrepancy.get("/api/middles", params={"max_cost": 3}).json()} == {"totals"}


def test_endpoint_never_pairs_same_book(monkeypatch):
    ev = {"id": "x", "sport": "NBA", "home": "A", "away": "B", "start": "t", "markets": {"totals": [
        make_outcome("Over", 220.5, DraftKings=-110), make_outcome("Under", 222.5, DraftKings=-110)]}}
    monkeypatch.setattr(main, "get_snapshot", lambda: [ev])
    assert TestClient(main.app).get("/api/middles").json() == []


def test_endpoint_on_mock_snapshot(monkeypatch):
    monkeypatch.setattr(main, "get_snapshot", lambda: mock.snapshot(seed=1))
    rows = TestClient(main.app).get("/api/middles").json()
    assert rows and all(r["window"] > 0 and r["high"] > r["low"] for r in rows)
    assert rows == sorted(rows, key=lambda r: -r["ev_pct"])
