"""odderjam-142: event_start survives CSV import and export."""
from tests.test_bets import _bet, client  # noqa: F401  (client is the fixture)


def test_event_start_csv_round_trip(client):
    _bet(client, pick="Lakers", event="Celtics @ Lakers", event_start="2026-11-21T19:30:00Z")
    text = client.get("/api/bets/export.csv").text
    assert "event_start" in text.splitlines()[0]
    r = client.post("/api/bets/import", json={"csv": text}).json()
    assert r["imported"] == 1 and not r["errors"]
    a, b = client.get("/api/bets").json()
    assert a["event_start"] and a["event_start"] == b["event_start"]


def test_import_accepts_event_start_column(client):
    r = client.post("/api/bets/import", json={"csv": "pick,odds,stake,event_start\nA,+110,5,2030-01-02T03:04:00Z\n"}).json()
    assert r["imported"] == 1
    assert client.get("/api/bets").json()[0]["event_start"].startswith("2030-01-02T03:04")
