"""Sharp Money spike detector on synthetic trade series (pure, no I/O)."""
import math

import pytest

from backend.engine import ev, odds, spikes

NOW = 1_800_000_000.0
WINDOW = 600.0      # 10 minutes
BASELINE = 6000.0   # 100 minutes = 10 windows


def t(ago, cents, size):
    """A trade `ago` seconds before NOW."""
    return {"ts": NOW - ago, "cents": cents, "size": size}


def steady(per_window=100, cents=40):
    """One trade of `per_window` contracts in each of the 10 baseline windows plus the current window."""
    return [t(30 + i * WINDOW, cents, per_window) for i in range(11)]


def detect(trades, k=3.0, min_volume=50):
    return spikes.detect(trades, NOW, window=WINDOW, baseline=BASELINE, k=k, min_volume=min_volume)


# AC1 — spike when window volume beats k x the baseline rate


def test_flat_series_is_not_a_spike():
    assert detect(steady()) is None


def test_burst_is_a_spike_with_ratio_and_baseline():
    trades = steady() + [t(60, 42, 300), t(120, 42, 100)]  # window volume 100 + 400 = 500
    r = detect(trades)
    assert r["volume"] == pytest.approx(500)
    assert r["baseline"] == pytest.approx(100)  # 1000 baseline contracts over 10 windows
    assert r["ratio"] == pytest.approx(5)
    assert r["trades"] == 3


def test_vwap_and_volume_by_price():
    trades = [t(10, 40, 100), t(20, 45, 300), t(30, 45, 100), t(40, 50, 100)]
    r = detect(trades)
    assert r["vwap_cents"] == pytest.approx((40 * 100 + 45 * 400 + 50 * 100) / 600)
    assert r["fair_prob"] == pytest.approx(r["vwap_cents"] / 100)
    assert r["price"] == pytest.approx(odds.prob_to_american(r["fair_prob"]))
    assert r["by_price"] == [{"cents": 45, "volume": 400}, {"cents": 40, "volume": 100}, {"cents": 50, "volume": 100}]
    assert spikes.volume_by_price(trades) == r["by_price"]


def test_below_min_volume_is_not_a_spike():
    trades = [t(60, 40, 40)]  # infinite ratio, but only 40 contracts
    assert detect(trades, min_volume=50) is None
    assert detect(trades, min_volume=40)["volume"] == 40


def test_ratio_equal_to_k_is_not_a_spike():
    trades = steady() + [t(60, 40, 200)]  # window 300 vs baseline 100: ratio exactly 3
    assert detect(trades, k=3.0) is None
    assert detect(trades, k=2.99)["ratio"] == pytest.approx(3)


def test_empty_baseline_spike_has_no_ratio():
    r = detect([t(60, 55, 200)])
    assert r["baseline"] == 0 and r["ratio"] is None
    assert r["vwap_cents"] == 55


# AC2 — period boundaries, bad trades, bad parameters


def test_period_boundaries():
    trades = [
        {"ts": NOW + 1, "cents": 90, "size": 10_000},              # in the future: ignored
        {"ts": NOW, "cents": 40, "size": 200},                     # at now: in the window
        {"ts": NOW - WINDOW, "cents": 40, "size": 100},            # at the window edge: baseline
        {"ts": NOW - WINDOW - BASELINE, "cents": 40, "size": 9_000},  # before the baseline: ignored
    ]
    r = detect(trades, k=10)
    assert r["volume"] == 200
    assert r["baseline"] == pytest.approx(100 * WINDOW / BASELINE)
    assert r["vwap_cents"] == 40


def test_invalid_trades_ignored():
    trades = [t(10, 40, 100), t(11, 0, 500), t(12, 100, 500), t(13, 40, 0), t(14, 40, -5), t(15, 101, 50)]
    r = detect(trades)
    assert r["volume"] == 100 and r["trades"] == 1 and r["vwap_cents"] == 40


@pytest.mark.parametrize("kw", [
    {"window": 0}, {"window": -1}, {"window": math.inf}, {"baseline": 0}, {"baseline": math.nan},
    {"k": 0}, {"k": math.inf}, {"min_volume": -1}, {"min_volume": math.nan},
])
def test_invalid_params_raise(kw):
    args = {"window": WINDOW, "baseline": BASELINE, "k": 3.0, "min_volume": 0, **kw}
    with pytest.raises(ValueError):
        spikes.detect([t(10, 40, 100)], NOW, **args)


# AC3 — sportsbooks beating the spike price


def test_beating_books_sorted_by_ev():
    fair = 0.5  # spike paid 50 cents: even money
    prices = {"DraftKings": 110, "FanDuel": -110, "BetMGM": 100, "Caesars": 125}
    r = spikes.beating(prices, fair)
    assert [b["book"] for b in r] == ["Caesars", "DraftKings"]
    assert r[0] == {"book": "Caesars", "price": 125, "ev_pct": pytest.approx(ev.ev_pct(fair, 125))}
    assert spikes.beating({}, fair) == []
