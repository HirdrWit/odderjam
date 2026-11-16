import math

import pytest
from fastapi.testclient import TestClient

from backend import main
from backend.engine import pickem
from backend.engine.odds import american_to_prob


# --- math -----------------------------------------------------------------------------------------------------------


def test_hit_distribution_known_and_sums_to_one():
    dist = pickem.hit_distribution([0.5, 0.5])
    assert dist == pytest.approx([0.25, 0.5, 0.25])
    dist = pickem.hit_distribution([0.6, 0.7, 0.2])
    assert len(dist) == 4
    assert sum(dist) == pytest.approx(1.0)
    assert dist[3] == pytest.approx(0.6 * 0.7 * 0.2)
    assert dist[0] == pytest.approx(0.4 * 0.3 * 0.8)
    assert pickem.hit_distribution([]) == pytest.approx([1.0])


def test_power_slip_ev_known_example():
    # Two legs at 60% on a 3x power play: 0.36 * 3 = 1.08 -> +8%.
    r = pickem.slip_ev([0.6, 0.6], {2: 3.0})
    assert r["expected_return"] == pytest.approx(1.08)
    assert r["ev_pct"] == pytest.approx(8.0)
    assert r["win_prob"] == pytest.approx(0.36)


def test_flex_slip_ev_pays_partial_tiers():
    # 3-leg flex at 50%: P(3)=1/8 * 2.25 + P(2)=3/8 * 1.25 = 0.75 -> -25%.
    r = pickem.slip_ev([0.5, 0.5, 0.5], {3: 2.25, 2: 1.25})
    assert r["expected_return"] == pytest.approx(0.75)
    assert r["ev_pct"] == pytest.approx(-25.0)
    assert r["win_prob"] == pytest.approx(0.5)
    # A zero-multiplier tier is not a paying result.
    assert pickem.slip_ev([0.5, 0.5, 0.5], {3: 2.25, 2: 0.0})["win_prob"] == pytest.approx(0.125)


def test_breakeven_prob_two_leg_power():
    assert pickem.breakeven_prob({2: 3.0}, 2) == pytest.approx(1 / math.sqrt(3), abs=1e-6)
    p = pickem.breakeven_prob({3: 2.25, 2: 1.25}, 3)
    assert pickem.slip_ev([p] * 3, {3: 2.25, 2: 1.25})["ev_pct"] == pytest.approx(0.0, abs=1e-4)


def test_default_payouts_shape():
    power, flex = pickem.DEFAULT_PAYOUTS["power"], pickem.DEFAULT_PAYOUTS["flex"]
    assert sorted(power) == [2, 3, 4, 5, 6]
    assert sorted(flex) == [3, 4, 5, 6]
    for n, table in power.items():
        assert list(table) == [n] and table[n] > 1
    for n, table in flex.items():
        assert table[n] == max(table.values()) and min(table) < n
    pickem.validate_table(power)
    pickem.validate_table(flex)


@pytest.mark.parametrize("bad", [
    {2: {3: 3.0}},             # more hits than legs
    {2: {-1: 1.0}},            # negative hit count
    {2: {2: -3.0}},            # negative multiplier
    {2: {2: float("inf")}},    # non-finite multiplier
    {2: {2: float("nan")}},
    {1: {1: 2.0}},             # size below 2
    {7: {7: 50.0}},            # size above 6
])
def test_validate_table_rejects_bad(bad):
    with pytest.raises(ValueError):
        pickem.validate_table(bad)


def leg(player, event_id, prob):
    return {"player": player, "event_id": event_id, "prob": prob}


def test_best_slips_ranked_by_ev():
    legs = [leg("A", "e1", 0.60), leg("B", "e2", 0.70), leg("C", "e3", 0.55), leg("D", "e4", 0.65)]
    slips = pickem.best_slips(legs, 2, {2: 3.0}, top=3)
    assert len(slips) == 3
    assert [s["ev_pct"] for s in slips] == sorted((s["ev_pct"] for s in slips), reverse=True)
    best = slips[0]
    assert {x["player"] for x in best["legs"]} == {"B", "D"}
    assert best["expected_return"] == pytest.approx(0.70 * 0.65 * 3)
    assert best["ev_pct"] == pytest.approx((0.70 * 0.65 * 3 - 1) * 100)
    assert best["win_prob"] == pytest.approx(0.70 * 0.65)


def test_best_slips_no_same_player_or_single_event():
    legs = [leg("A", "e1", 0.80), leg("A", "e1", 0.75),   # same player twice
            leg("B", "e2", 0.70), leg("C", "e2", 0.68)]   # B and C share an event
    for s in pickem.best_slips(legs, 2, {2: 3.0}, top=10):
        players = [x["player"] for x in s["legs"]]
        assert len(set(players)) == len(players)
        assert len({x["event_id"] for x in s["legs"]}) > 1
    best = pickem.best_slips(legs, 2, {2: 3.0}, top=1)[0]
    assert {x["player"] for x in best["legs"]} == {"A", "B"}
    assert best["legs"][0]["prob"] == 0.80 or best["legs"][1]["prob"] == 0.80


def test_best_slips_too_few_legs():
    assert pickem.best_slips([leg("A", "e1", 0.6), leg("B", "e2", 0.6)], 3, {3: 5.0}) == []
    # Only one distinct player: no valid 2-leg slip.
    assert pickem.best_slips([leg("A", "e1", 0.6), leg("A", "e2", 0.6)], 2, {2: 3.0}) == []


def test_parse_lines_formats_and_errors():
    text = ("LeBron James, points, 25.5\n"
            "\n"
            "Jayson Tatum\tplayer_threes\t2.5\tunder\n"
            "nonsense row\n"
            "Anthony Davis, rebounds, ten\n"
            " Luka Doncic , assists , 8.5 , OVER \n")
    lines, errors = pickem.parse_lines(text)
    assert lines == [
        {"player": "LeBron James", "market": "points", "point": 25.5, "side": None},
        {"player": "Jayson Tatum", "market": "player_threes", "point": 2.5, "side": "Under"},
        {"player": "Luka Doncic", "market": "assists", "point": 8.5, "side": "Over"},
    ]
    assert [e["row"] for e in errors] == [4, 5]
    assert errors[0]["text"] == "nonsense row"
    assert all(e["error"] for e in errors)


def test_parse_lines_rejects_unknown_side():
    lines, errors = pickem.parse_lines("LeBron James, points, 25.5, sideways")
    assert lines == [] and [e["row"] for e in errors] == [1]


# --- endpoint -------------------------------------------------------------------------------------------------------


def p(name, point, player, **prices):
    return {"name": name, "point": point, "player": player, "prices": prices}


EVENTS = [
    {"id": "g1", "sport": "NBA", "home": "A", "away": "B", "start": "t", "markets": {
        "player_points": [p("Over", 25.5, "LeBron James", Pinnacle=-150, DraftKings=-140),
                          p("Under", 25.5, "LeBron James", Pinnacle=130, DraftKings=120)],
        "player_rebounds": [p("Over", 10.5, "Anthony Davis", Pinnacle=120, DraftKings=110),
                            p("Under", 10.5, "Anthony Davis", Pinnacle=-140, DraftKings=-130)]}},
    {"id": "g2", "sport": "NBA", "home": "C", "away": "D", "start": "t", "markets": {
        "player_points": [p("Over", 27.5, "Jayson Tatum", Pinnacle=-110, DraftKings=-115),
                          p("Under", 27.5, "Jayson Tatum", Pinnacle=-110, DraftKings=-105)],
        "player_threes": [p("Over", 2.5, "Jayson Tatum", DraftKings=-130, FanDuel=-120),
                          p("Under", 2.5, "Jayson Tatum", DraftKings=110, FanDuel=100)]}},
]


def devig2(a, b):
    pa, pb = american_to_prob(a), american_to_prob(b)
    return pa / (pa + pb)


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(main, "get_snapshot", lambda: EVENTS)
    monkeypatch.setenv("SHARP_WEIGHTS", "Pinnacle:1")
    monkeypatch.setenv("MAX_SHARP_HOLD", "6")
    return TestClient(main.app)


def line(player, market, point, side=None):
    return {"player": player, "market": market, "point": point, "side": side}


def post(client, **body):
    return client.post("/api/pickem", json=body)


def test_pickem_endpoint_matches_and_ranks(client):
    r = post(client, lines=[line("Jayson Tatum", "player_points", 27.5), line("LeBron James", "player_points", 25.5),
                            line("Anthony Davis", "player_rebounds", 10.5)])
    assert r.status_code == 200
    legs = r.json()["legs"]
    assert all(x["matched"] for x in legs)
    # Ranked by hit probability of the chosen side, best first.
    assert [x["player"] for x in legs] == ["LeBron James", "Anthony Davis", "Jayson Tatum"]
    assert [x["prob"] for x in legs] == sorted((x["prob"] for x in legs), reverse=True)
    lebron, davis, tatum = legs
    assert lebron["side"] == "Over" and lebron["source"] == "sharp"
    assert lebron["prob"] == pytest.approx(devig2(-150, 130))
    assert lebron["probs"]["Under"] == pytest.approx(1 - devig2(-150, 130))
    assert lebron["event_id"] == "g1" and lebron["event"] == "B @ A" and lebron["sport"] == "NBA"
    assert davis["side"] == "Under"  # the better side when none is given
    assert davis["prob"] == pytest.approx(devig2(-140, 120))
    assert tatum["prob"] == pytest.approx(0.5)


def test_pickem_market_short_name_and_case(client):
    legs = post(client, lines=[line("lebron james", "points", 25.5),
                               line("ANTHONY DAVIS", "Rebounds", 10.5)]).json()["legs"]
    assert [(x["matched"], x["event_id"]) for x in legs] == [(True, "g1"), (True, "g1")]
    assert {x["market"] for x in legs} == {"player_points", "player_rebounds"}


def test_pickem_unmatched_line(client):
    r = post(client, lines=[line("LeBron James", "player_points", 30.5), line("Nobody", "points", 1.5),
                            line("LeBron James", "player_points", 25.5)])
    assert r.status_code == 200
    legs = r.json()["legs"]
    assert legs[0]["matched"] is True  # matched legs rank ahead of unmatched ones
    unmatched = [x for x in legs if not x["matched"]]
    assert {(x["player"], x["point"]) for x in unmatched} == {("LeBron James", 30.5), ("Nobody", 1.5)}
    assert all(x["prob"] is None for x in unmatched)


def test_pickem_market_fallback_when_no_sharp(client):
    legs = post(client, lines=[line("Jayson Tatum", "threes", 2.5)]).json()["legs"]
    (x,) = legs
    assert x["matched"] and x["source"] == "market"
    assert x["side"] == "Over"
    assert x["prob"] == pytest.approx((devig2(-130, 110) + devig2(-120, 100)) / 2)


def test_pickem_given_side_respected(client):
    (x,) = post(client, lines=[line("LeBron James", "points", 25.5, "Under")]).json()["legs"]
    assert x["side"] == "Under"
    assert x["prob"] == pytest.approx(1 - devig2(-150, 130))
    (y,) = post(client, lines=[line("LeBron James", "points", 25.5, "under")]).json()["legs"]
    assert y["side"] == "Under"


def test_pickem_slips_by_size_and_custom_table(client):
    lines = [line("LeBron James", "points", 25.5), line("Anthony Davis", "rebounds", 10.5),
             line("Jayson Tatum", "points", 27.5), line("Jayson Tatum", "threes", 2.5)]
    r = post(client, lines=lines, sizes=[2, 3]).json()
    assert r["payout"] == "power"
    assert set(r["slips"]) == {"2", "3"}
    best2 = r["slips"]["2"][0]
    probs = [x["prob"] for x in best2["legs"]]
    assert best2["expected_return"] == pytest.approx(math.prod(probs) * pickem.DEFAULT_PAYOUTS["power"][2][2])
    assert len({x["player"] for x in best2["legs"]}) == 2
    # Flex has no 2-leg table, so that size is left out.
    flex = post(client, lines=lines, sizes=[2, 3], payout="flex").json()
    assert set(flex["slips"]) == {"3"}
    # A custom table overrides the defaults.
    custom = post(client, lines=lines, sizes=[2], payouts={"2": {"2": 10.0}}).json()
    best = custom["slips"]["2"][0]
    assert best["expected_return"] == pytest.approx(math.prod(x["prob"] for x in best["legs"]) * 10)
    assert custom["table"] == {"2": {"2": 10.0}}


def test_pickem_rejects_bad_input(client):
    ok = [line("LeBron James", "points", 25.5), line("Jayson Tatum", "points", 27.5)]
    assert post(client, lines=ok, payouts={"2": {"3": 3.0}}).status_code == 400
    assert post(client, lines=ok, payouts={"2": {"2": -1.0}}).status_code in (400, 422)
    assert post(client, lines=ok, method="bogus").status_code == 400
    assert post(client, lines=ok, sizes=[7]).status_code == 422
    assert post(client, lines=ok, sizes=[1]).status_code == 422
    assert post(client, lines=ok, payout="parlay").status_code == 422
    assert post(client, lines=[]).status_code == 422


def test_pickem_payouts_endpoint(client):
    r = client.get("/api/pickem/payouts").json()
    assert r["power"]["2"] == {"2": pickem.DEFAULT_PAYOUTS["power"][2][2]}
    assert set(r["flex"]) == {"3", "4", "5", "6"}
