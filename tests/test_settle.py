import pytest

from backend.engine.settle import final_scores, grade, parse_pick

H, A = "Lakers", "Celtics"


@pytest.mark.parametrize("sel,hs,as_,want", [
    (H, 110, 100, "won"), (A, 110, 100, "lost"), (A, 99, 100, "won"),
    (H, 100, 100, "push"), ("Draw", 1, 1, "won"), ("Draw", 2, 1, "lost"),
])
def test_moneyline(sel, hs, as_, want):
    assert grade("moneyline", sel, None, H, A, hs, as_) == want


@pytest.mark.parametrize("sel,point,hs,as_,want", [
    (H, -3.5, 110, 106, "won"),   # wins by 4
    (H, -3.5, 110, 107, "lost"),  # wins by 3
    (H, -3.0, 110, 107, "push"),  # wins by exactly 3
    (A, 3.5, 110, 107, "won"),    # loses by 3, +3.5 covers
    (A, 3.0, 110, 107, "push"),
    (A, -1.5, 100, 105, "won"),   # road favourite wins by 5
    (A, -7.0, 100, 105, "lost"),
])
def test_spreads(sel, point, hs, as_, want):
    assert grade("spreads", sel, point, H, A, hs, as_) == want


@pytest.mark.parametrize("sel,point,hs,as_,want", [
    ("Over", 220.5, 111, 110, "won"), ("Under", 220.5, 111, 110, "lost"),
    ("Over", 220.5, 110, 110, "lost"), ("Under", 220.5, 110, 110, "won"),
    ("Over", 220.0, 110, 110, "push"), ("Under", 220.0, 110, 110, "push"),
])
def test_totals(sel, point, hs, as_, want):
    assert grade("totals", sel, point, H, A, hs, as_) == want


def test_ungradeable():
    assert grade("player_points", "LeBron Over 25.5", 25.5, H, A, 1, 0) is None  # props stay manual
    assert grade("moneyline", "Knicks", None, H, A, 1, 0) is None
    assert grade("spreads", H, None, H, A, 1, 0) is None
    assert grade("totals", H, 200, H, A, 1, 0) is None


def test_parse_pick():
    assert parse_pick("spreads", "Lakers -3.5") == ("Lakers", -3.5)
    assert parse_pick("spreads", "Trail Blazers +7") == ("Trail Blazers", 7.0)
    assert parse_pick("totals", "Over 220.5") == ("Over", 220.5)
    assert parse_pick("moneyline", "76ers") == ("76ers", None)


def test_final_scores():
    g = {"completed": True, "home_team": H, "away_team": A,
         "scores": [{"name": A, "score": "99"}, {"name": H, "score": "101"}]}
    assert final_scores(g) == (101, 99)
    assert final_scores({**g, "completed": False}) is None
    assert final_scores({**g, "scores": None}) is None
