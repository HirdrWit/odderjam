"""odderjam-36: /api/middles must reject a stake it cannot divide by, never 500."""
import pytest
from fastapi.testclient import TestClient

from backend import main
from tests.test_middles import make_outcome


@pytest.fixture
def client(monkeypatch):
    ev = {"id": "x", "sport": "NFL", "home": "A", "away": "B", "start": "t", "markets": {
        "totals": [make_outcome("Over", 44.5, DraftKings=-105), make_outcome("Under", 46.5, FanDuel=-102)]}}
    monkeypatch.setattr(main, "get_snapshot", lambda: [ev])
    return TestClient(main.app, raise_server_exceptions=False)


@pytest.mark.parametrize("stake", ["0", "-5"])
def test_endpoint_rejects_non_positive_stake(client, stake):
    assert client.get("/api/middles", params={"stake": stake}).status_code == 422


@pytest.mark.parametrize("stake", ["nan", "inf"])
def test_endpoint_rejects_non_finite_stake(client, stake):
    assert client.get("/api/middles", params={"stake": stake}).status_code == 422


def test_endpoint_custom_stake_scales_legs(client):
    r = client.get("/api/middles", params={"stake": 250})
    assert r.status_code == 200
    (row,) = r.json()
    assert sum(leg["stake"] for leg in row["legs"]) == pytest.approx(250)
