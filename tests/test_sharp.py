import pytest
from fastapi.testclient import TestClient

from backend.engine import devig, odds, sharp
from backend.main import app

ML = {
    "Pinnacle": {"home": -150, "away": 135},      # hold ~2.5%
    "Circa Sports": {"home": -140, "away": 120},  # hold ~3.8%
    "DraftKings": {"home": -130, "away": 110},
}


def test_parse_weights():
    assert sharp.parse_weights("Pinnacle:1, Circa Sports:0.5,Novig:0,bad,X:y") == {"Pinnacle": 1, "Circa Sports": 0.5}
    assert sharp.parse_weights("") == {}


def test_hold_pct():
    assert sharp.hold_pct({"home": -110, "away": -110}) == pytest.approx(4.7619, abs=1e-4)


def test_consensus_is_weighted_mean_of_each_devigged_book():
    def fair(line):
        return devig.multiplicative([odds.american_to_prob(line["home"]), odds.american_to_prob(line["away"])])

    r = sharp.consensus(ML, {"Pinnacle": 3, "Circa Sports": 1})
    want = (3 * fair(ML["Pinnacle"])[0] + fair(ML["Circa Sports"])[0]) / 4
    assert r["home"] == pytest.approx(want)
    assert r["home"] + r["away"] == pytest.approx(1)
    assert [s["book"] for s in r["sharps"]] == ["Pinnacle", "Circa Sports"]
    assert r["sharps"][0]["hold_pct"] == pytest.approx(sharp.hold_pct(ML["Pinnacle"]))


def test_consensus_without_pinnacle():
    ml = {k: v for k, v in ML.items() if k != "Pinnacle"}
    r = sharp.consensus(ml, {"Pinnacle": 1, "Circa Sports": 0.5})
    assert [s["book"] for s in r["sharps"]] == ["Circa Sports"]


def test_consensus_drops_wide_sharps():
    r = sharp.consensus(ML, {"Pinnacle": 1, "Circa Sports": 1}, max_hold=3)
    assert [s["book"] for s in r["sharps"]] == ["Pinnacle"]
    assert sharp.consensus(ML, {"Pinnacle": 1}, max_hold=1) is None
    assert sharp.consensus(ML, {"Novig": 1}) is None


def test_api_ev_reports_sharps_and_filters_by_hold():
    c = TestClient(app)
    assert set(c.get("/api/sharps").json()["methods"]) >= {"additive", "shin"}
    rows = c.get("/api/ev", params={"min_ev": -100, "method": "shin", "sharps": "Pinnacle:1"}).json()
    assert rows and all(r["sharps"][0]["book"] == "Pinnacle" and r["sharp_hold_pct"] > 0 for r in rows)
    assert c.get("/api/ev", params={"min_ev": -100, "sharps": "Pinnacle:1", "max_hold": 0}).json() == []
    assert c.get("/api/ev", params={"method": "nope"}).status_code == 400
