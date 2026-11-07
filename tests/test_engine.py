import pytest

from backend.engine import arb, devig, ev, odds, parlay, promo


def test_odds_roundtrip():
    assert odds.american_to_decimal(-110) == pytest.approx(1.9091, abs=1e-4)
    assert odds.american_to_decimal(150) == pytest.approx(2.5)
    assert odds.decimal_to_american(2.5) == pytest.approx(150)
    assert odds.prob_to_american(odds.american_to_prob(-200)) == pytest.approx(-200)


@pytest.mark.parametrize("m", list(devig.METHODS.values()))
def test_devig_even_market(m):
    p = [odds.american_to_prob(-110)] * 2
    assert m(p) == pytest.approx([0.5, 0.5])


def test_devig_sums_to_one():
    p = [odds.american_to_prob(-200), odds.american_to_prob(170)]
    for m in devig.METHODS.values():
        assert sum(m(p)) == pytest.approx(1, abs=1e-6) or m is devig.worst_case


def test_ev_and_kelly():
    assert ev.ev_pct(0.5, 110) == pytest.approx(5.0)
    assert ev.ev_pct(0.5, -110) < 0
    assert ev.kelly_fraction(0.5, -110) == 0
    assert ev.kelly_fraction(0.55, 100, 1.0) == pytest.approx(0.10)


def test_arb():
    r = arb.arb([110, 110], 100)
    assert r["profit_pct"] == pytest.approx(5.0)
    assert r["stakes"] == pytest.approx([50, 50])
    assert arb.arb([-110, -110])["profit_pct"] < 0


def test_promo_and_parlay():
    r = promo.bonus_bet_hedge(100, 200, -200)
    assert 60 < r["conversion_pct"] < 80
    assert parlay.parlay([100, 100])["decimal"] == pytest.approx(4)
    assert parlay.parlay([100, 100], [0.55, 0.55])["ev_pct"] == pytest.approx(21.0)
