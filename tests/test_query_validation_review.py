"""odderjam-39 review: preset odds ranges and /api/lowhold max_hold."""
import pytest
from fastapi.testclient import TestClient

from backend import main
from backend.providers import mock


@pytest.fixture
def client(monkeypatch):  # conftest gives each test its own DB
    monkeypatch.setattr(main, "get_snapshot", lambda: mock.snapshot(seed=1))
    return TestClient(main.app)


INVERTED = {"odds_min": 500, "odds_max": 100}


def test_saving_inverted_preset_is_rejected(client):
    r = client.post("/api/filters", json={"name": "bad", "filters": INVERTED})
    assert r.status_code == 422 and "odds_min" in r.text
    assert client.get("/api/filters").json() == []


def test_updating_preset_to_inverted_range_is_rejected(client):
    p = client.post("/api/filters", json={"name": "ok", "filters": {"odds_min": 100}}).json()
    r = client.put(f"/api/filters/{p['id']}", json={"name": "ok", "filters": INVERTED})
    assert r.status_code == 422
    assert client.get(f"/api/filters/{p['id']}").json()["filters"]["odds_max"] is None


@pytest.mark.parametrize("url", ["/api/arbs", "/api/ev"])
def test_query_param_inverting_a_preset_is_rejected(client, url):
    p = client.post("/api/filters", json={"name": "plus", "filters": {"odds_min": 150}}).json()
    r = client.get(url, params={"preset": p["id"], "odds_max": 100})
    assert r.status_code == 422 and "odds_max" in r.text


@pytest.mark.parametrize("value", ["nan", "inf", "-inf"])
def test_lowhold_rejects_non_finite_max_hold(client, value):
    assert client.get("/api/lowhold", params={"max_hold": value}).status_code == 422


def test_lowhold_negative_max_hold_means_arbs_only(client):
    r = client.get("/api/lowhold", params={"max_hold": -0.5})
    assert r.status_code == 200 and all(row["hold_pct"] <= -0.5 for row in r.json())
