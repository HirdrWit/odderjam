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


TWO_WAY = [odds.american_to_prob(-200), odds.american_to_prob(170)]  # 0.6667, 0.3704
THREE_WAY = [1 / 2.0, 1 / 3.4, 1 / 4.2]  # overround ~3.2%


@pytest.mark.parametrize("name", [n for n in devig.METHODS if n != "worst_case"])
@pytest.mark.parametrize("p", [TWO_WAY, THREE_WAY])
def test_each_method_sums_to_one(name, p):
    fair = devig.METHODS[name](p)
    assert sum(fair) == pytest.approx(1, abs=1e-9)
    assert all(0 <= x <= 1 for x in fair)


def test_additive_reference():
    assert devig.additive([0.6, 0.5]) == pytest.approx([0.55, 0.45])
    assert devig.additive([0.5, 0.3, 0.3]) == pytest.approx([7 / 15, 4 / 15, 4 / 15])


def test_additive_clamps_longshot_at_zero():
    fair = devig.additive([0.9, 0.3, 0.02])  # margin 0.0733 per outcome > longshot's 0.02
    assert fair == pytest.approx([0.7848101, 0.2151899, 0.0])


def test_multiplicative_and_power_reference():
    assert devig.multiplicative([0.6, 0.5]) == pytest.approx([6 / 11, 5 / 11])
    assert devig.power([0.6, 0.5]) == pytest.approx([0.5527093, 0.4472907])


def test_shin_reference():
    # Two-way markets: Shin gives the same answer as additive.
    assert devig.shin(TWO_WAY) == pytest.approx(devig.additive(TWO_WAY), abs=1e-9)
    fair = devig.shin(THREE_WAY)
    assert fair == pytest.approx([0.4880228, 0.2837709, 0.2282063])
    # Shin takes more margin from the longshot than multiplicative does.
    mult = devig.multiplicative(THREE_WAY)
    assert fair[0] > mult[0] and fair[2] < mult[2]


def test_shin_reproduces_quoted_prices():
    """Under Shin's model the quoted prob is q_i = r_i * sum(r), r_i = sqrt(z p_i + (1-z) p_i^2)."""
    fair = devig.shin(THREE_WAY)

    def quoted(z):
        r = [(z * p + (1 - z) * p * p) ** 0.5 for p in fair]
        return [x * sum(r) for x in r]

    best = min((z / 10000 for z in range(10000)),
               key=lambda z: sum((a - b) ** 2 for a, b in zip(quoted(z), THREE_WAY)))
    assert quoted(best) == pytest.approx(THREE_WAY, rel=1e-3)


def test_shin_no_margin_is_identity():
    assert devig.shin([0.4, 0.6]) == pytest.approx([0.4, 0.6])


def test_worst_case_takes_max():
    m, p, w = devig.multiplicative(TWO_WAY), devig.power(TWO_WAY), devig.worst_case(TWO_WAY)
    assert w == [max(a, b) for a, b in zip(m, p)]
