"""Sharp weights per market class and the all-books fair price (odderjam-131)."""
import pytest
from fastapi.testclient import TestClient

from backend import main, scan
from backend.engine import sharp
from backend.providers import books

SPEC = "main:Pinnacle:1,Circa Sports:0.5;props:Pinnacle:0.5,FanDuel:0.25"


def o(name, point, player=None, **prices):
    return {"name": name, "point": point, "player": player, "prices": prices}


def event(markets):
    return {"id": "e1", "sport": "NBA", "home": "Nets", "away": "76ers", "start": "2099-01-01T00:00:00Z",
            "markets": markets}


def ml_event():
    return event({"moneyline": [
        o("Nets", None, **{"Pinnacle": -150, "Circa Sports": -120, "DraftKings": -110, "FanDuel": -130}),
        o("76ers", None, **{"Pinnacle": 130, "Circa Sports": 100, "DraftKings": -110, "FanDuel": 110})]})


def prop_event():
    return event({"player_points": [
        o("Over", 20.5, "P1", **{"Pinnacle": -150, "Circa Sports": -105, "DraftKings": -110, "FanDuel": -130}),
        o("Under", 20.5, "P1", **{"Pinnacle": 130, "Circa Sports": -115, "DraftKings": -110, "FanDuel": 110})]})


def rows(ev, weights, **kw):
    return scan.ev_rows([ev], weights, 100.0, min_ev=-100, now=0.0, **kw)


def fair(rs, book="DraftKings"):
    return next(r["fair_prob"] for r in rs if r["book"] == book)


def test_parse_weights_flat_unchanged_and_per_class():
    assert sharp.parse_weights("Pinnacle:1,Circa Sports:0.5") == {"Pinnacle": 1, "Circa Sports": 0.5}
    assert sharp.parse_weights(SPEC) == {"main": {"Pinnacle": 1, "Circa Sports": 0.5},
                                         "props": {"Pinnacle": 0.5, "FanDuel": 0.25}}


def test_class_weights_flat_applies_to_both_classes():
    flat = {"Pinnacle": 1.0}
    assert sharp.class_weights(flat) == {"main": flat, "props": flat}
    assert sharp.class_weights(sharp.parse_weights("Pinnacle:1")) == {"main": flat, "props": flat}


@pytest.mark.parametrize("bad", ["foo:Pinnacle:1", "main:Pinnacle:x", "main:Pinnacle:1;props:", "main:Pinnacle:1;main:Novig:1"])
def test_bad_per_class_spec_raises(bad):
    with pytest.raises(ValueError):
        sharp.parse_weights(bad)


def test_missing_class_falls_back_to_other_class_is_empty():
    cw = sharp.class_weights(sharp.parse_weights("main:Pinnacle:1"))
    assert cw["main"] == {"Pinnacle": 1.0} and cw["props"] == {}


def test_prop_priced_with_props_weights_and_moneyline_with_main():
    w = sharp.parse_weights("main:Pinnacle:1;props:Circa Sports:1")
    ml, pr = rows(ml_event(), w), rows(prop_event(), w)
    assert {r["weight_class"] for r in ml} == {"main"}
    assert {r["weight_class"] for r in pr} == {"props"}
    assert [s["book"] for s in ml[0]["sharps"]] == ["Pinnacle"]
    assert [s["book"] for s in pr[0]["sharps"]] == ["Circa Sports"]


def test_different_weights_give_different_fair_probs():
    a = rows(prop_event(), sharp.parse_weights("main:Pinnacle:1;props:Pinnacle:1"))
    b = rows(prop_event(), sharp.parse_weights("main:Pinnacle:1;props:Circa Sports:1"))
    assert fair(a) != pytest.approx(fair(b))


def test_flat_weights_still_work_for_both_classes():
    flat = {"Pinnacle": 1.0}
    assert rows(ml_event(), flat) and rows(prop_event(), flat)
    assert fair(rows(prop_event(), flat)) == pytest.approx(
        fair(rows(prop_event(), sharp.parse_weights("main:Pinnacle:1;props:Pinnacle:1"))))


def test_all_books_weights_every_book_equally():
    ev = ml_event()
    rs = rows(ev, {"Pinnacle": 1.0}, fair_source="all_books")
    assert {s["book"] for s in rs[0]["sharps"]} == {"Pinnacle", "Circa Sports", "DraftKings", "FanDuel"}
    assert all(s["weight"] == 1 for s in rs[0]["sharps"])
    manual = sharp.group_consensus(ev["markets"]["moneyline"], {b: 1 for b in
                                   ["Pinnacle", "Circa Sports", "DraftKings", "FanDuel"]})
    assert fair(rs) == pytest.approx(manual["probs"][0])


def test_all_books_drops_books_over_max_hold():
    ev = ml_event()
    # max_hold 4: Pinnacle -150/+130 holds 3.48% (kept); DraftKings -110/-110 holds 4.76% (dropped)
    rs = scan.ev_rows([ev], {"Pinnacle": 1.0}, 4.0, min_ev=-100, now=0.0, fair_source="all_books")
    books_used = {s["book"] for s in rs[0]["sharps"]}
    assert "DraftKings" not in books_used and "Pinnacle" in books_used


def test_all_books_skips_books_missing_a_side():
    ev = ml_event()
    del ev["markets"]["moneyline"][1]["prices"]["FanDuel"]
    rs = rows(ev, {"Pinnacle": 1.0}, fair_source="all_books")
    assert "FanDuel" not in {s["book"] for s in rs[0]["sharps"]}


def test_defaults_are_per_class_dict_with_flat_free_spec():
    d = books.DEFAULT_SHARP_WEIGHTS
    assert set(d) == {"main", "props"} and d["main"]["Pinnacle"] == 1
    assert d["props"]["Pinnacle"] < d["main"]["Pinnacle"]
    assert sharp.class_weights(sharp.parse_weights(books.sharp_weights_spec())) == d


def test_api_sharps_returns_recommended_per_class():
    j = TestClient(main.app).get("/api/sharps").json()
    assert set(j["weights"]) == {"main", "props"}
    assert j["recommended"] == j["weights"] == books.DEFAULT_SHARP_WEIGHTS
    assert j["fair_source"] == "sharp"


def test_api_bad_spec_is_400_with_message():
    c = TestClient(main.app)
    r = c.get("/api/ev", params={"sharps": "bogus:Pinnacle:1"})
    assert r.status_code == 400 and r.json()["detail"]
    assert c.get("/api/ev", params={"sharps": "main:Pinnacle:x"}).status_code == 400


def test_api_per_class_spec_and_fair_source():
    c = TestClient(main.app)
    j = c.get("/api/ev", params={"min_ev": -100, "sharps": "main:Pinnacle:1;props:Pinnacle:1"}).json()
    assert j and {r["weight_class"] for r in j} <= {"main", "props"}
    allb = c.get("/api/ev", params={"min_ev": -100, "fair_source": "all_books"})
    assert allb.status_code == 200 and all(len(r["sharps"]) >= 1 for r in allb.json())
    assert c.get("/api/ev", params={"fair_source": "nope"}).status_code == 400
