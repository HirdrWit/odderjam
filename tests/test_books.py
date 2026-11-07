from fastapi.testclient import TestClient

from backend.main import app
from backend.providers.books import us_name, us_only


def test_us_filter():
    assert us_name("draftkings") == "DraftKings"
    assert us_name("Betfair") is None and us_name("Bovada") is None
    assert us_only({"Pinnacle": 1, "FanDuel": 2, "Betfair": 3}) == {"FanDuel": 2}


def test_api_hides_non_us_books():
    c = TestClient(app)
    for e in c.get("/api/odds").json():
        assert "Pinnacle" not in e["markets"]["moneyline"]
    for r in c.get("/api/ev").json():
        assert r["book"] != "Pinnacle"
    for r in c.get("/api/arbs").json():
        assert all(l["book"] != "Pinnacle" for l in r["legs"])
