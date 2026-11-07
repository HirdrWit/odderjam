import pytest
from fastapi.testclient import TestClient

from backend import alerts, main, providers
from backend.providers import mock
from backend.routes import bets


def outcome(name, point=None, **prices):
    return {"name": name, "point": point, "prices": prices}


def event(dk_price=150, fd_price=-110):
    # Pinnacle -110/-110 -> fair 50%, so DraftKings +150 is a big +EV price.
    return {"id": "e1", "sport": "NBA", "home": "A", "away": "B", "start": "t", "markets": {"moneyline": [
        outcome("A", Pinnacle=-110, DraftKings=dk_price), outcome("B", Pinnacle=-110, FanDuel=fd_price)]}}


@pytest.fixture
def db(tmp_path, monkeypatch):
    monkeypatch.setattr(bets, "DB", tmp_path / "t.db")
    monkeypatch.delenv("DISCORD_WEBHOOK_URL", raising=False)


@pytest.fixture
def snapshot(monkeypatch):
    data = {"events": [event()]}
    monkeypatch.setattr(providers, "peek_snapshot", lambda: data["events"])
    return data


@pytest.fixture
def client(db, snapshot):
    return TestClient(main.app)


def add_rule(**kw):
    with alerts.conn() as c:
        c.execute("INSERT INTO alert_rules (name,kind,min_value,book,market,sport,created_at) VALUES (?,?,?,?,?,?,?)",
                  (kw.get("name", "r"), kw.get("kind", "ev"), kw.get("min_value", 1.0), kw.get("book", ""),
                   kw.get("market", ""), kw.get("sport", ""), "now"))


def test_opportunity_key_identity():
    row = {"event_id": "e1", "market": "spreads", "point": -3.5, "pick": "A -3.5", "book": "FanDuel", "odds": 120}
    k = alerts.opportunity_key("ev", row)
    assert k == alerts.opportunity_key("ev", {**row, "ev_pct": 9.9, "stake": 5})  # extra fields don't matter
    for change in ({"odds": 125}, {"book": "BetMGM"}, {"point": -4.5}, {"pick": "B +3.5"}, {"event_id": "e2"},
                   {"market": "totals"}):
        assert alerts.opportunity_key("ev", {**row, **change}) != k
    legs = [{"pick": "A", "book": "DK", "odds": 110}, {"pick": "B", "book": "FD", "odds": 105}]
    arb = {"event_id": "e1", "market": "moneyline", "point": None, "legs": legs}
    assert alerts.opportunity_key("arb", arb) == alerts.opportunity_key("arb", {**arb, "legs": legs[::-1]})
    assert alerts.opportunity_key("arb", arb) != alerts.opportunity_key(
        "arb", {**arb, "legs": [legs[0], {**legs[1], "odds": 106}]})


def test_evaluate_dedupes_until_price_moves(db):
    add_rule(min_value=1.0)
    first = alerts.evaluate([event()])
    assert [(o["kind"], o["data"]["book"], o["data"]["odds"]) for o in first] == [("ev", "DraftKings", 150)]
    assert alerts.evaluate([event()]) == []  # same price again: no new alert
    moved = alerts.evaluate([event(dk_price=155)])
    assert [o["data"]["odds"] for o in moved] == [155]


def test_overlapping_rules_alert_once(db):
    add_rule(name="any", min_value=0)
    add_rule(name="dk", min_value=5, book="DraftKings")
    assert len(alerts.evaluate([event()])) == 1


def test_rule_filters(db):
    add_rule(min_value=1, book="FanDuel")
    add_rule(min_value=1, sport="NFL")
    add_rule(min_value=1, market="spreads")
    assert alerts.evaluate([event()]) == []


def test_arb_rule(db):
    add_rule(kind="arb", min_value=0)
    (o,) = alerts.evaluate([event(dk_price=120, fd_price=110)])
    assert o["kind"] == "arb" and o["value"] > 0 and o["title"].startswith("Arb ")
    assert alerts.evaluate([event(dk_price=120, fd_price=110)]) == []


def test_no_rules_or_no_events_records_nothing(db):
    assert alerts.evaluate([event()]) == []
    add_rule()
    assert alerts.evaluate([]) == []


def test_discord_webhook_called_for_new_only(db, monkeypatch):
    calls = []

    class Resp:
        def raise_for_status(self):
            pass

    monkeypatch.setattr(alerts.httpx, "post", lambda url, json, timeout: calls.append((url, json)) or Resp())
    monkeypatch.setenv("DISCORD_WEBHOOK_URL", "https://discord.test/hook")
    add_rule()
    alerts.evaluate([event()])
    alerts.evaluate([event()])
    assert len(calls) == 1
    url, body = calls[0]
    assert url == "https://discord.test/hook" and "DraftKings" in body["content"] and "+150" in body["content"]


def test_discord_skipped_without_url_and_failures_swallowed(db, monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("down")

    monkeypatch.setattr(alerts.httpx, "post", boom)
    assert alerts.send_discord([{"title": "x"}]) is False  # no URL: never called
    monkeypatch.setenv("DISCORD_WEBHOOK_URL", "https://discord.test/hook")
    assert alerts.send_discord([{"title": "x"}]) is False
    add_rule()
    assert len(alerts.evaluate([event()])) == 1  # still recorded even though delivery failed


def test_discord_splits_long_messages(monkeypatch):
    calls = []

    class Resp:
        def raise_for_status(self):
            pass

    monkeypatch.setattr(alerts.httpx, "post", lambda url, json, timeout: calls.append(json["content"]) or Resp())
    monkeypatch.setenv("DISCORD_WEBHOOK_URL", "https://discord.test/hook")
    assert alerts.send_discord([{"title": "x" * 500} for _ in range(10)])
    assert len(calls) > 1 and all(len(c) <= 2000 for c in calls)


def test_fetch_listener_runs_only_on_live_fetch(tmp_path, monkeypatch):
    seen = []
    monkeypatch.setenv("ODDS_API_KEY", "k")
    monkeypatch.setattr(providers, "CACHE", tmp_path / "c.json")
    monkeypatch.setattr(providers, "_fetch", lambda: [event()])
    monkeypatch.setattr(providers, "_fetched", lambda data: seen.append(data))
    providers.get_snapshot()  # no cache -> fetch
    providers.get_snapshot()  # cache fresh -> no fetch, no alert run
    assert len(seen) == 1
    assert providers.peek_snapshot() == [event()]
    assert len(seen) == 1  # peeking never fetches


def test_api_rules_and_feed(client, snapshot):
    r = client.post("/api/alerts/rules", json={"kind": "ev", "min_value": 1}).json()
    assert r["name"].startswith("+EV") and r["new_alerts"] == 1  # checked against data on hand
    feed = client.get("/api/alerts").json()
    assert feed["latest_id"] == feed["items"][0]["id"] and feed["discord"] is False
    assert client.get("/api/alerts", params={"after": feed["latest_id"]}).json()["items"] == []
    assert [x["id"] for x in client.get("/api/alerts/rules").json()] == [r["id"]]
    assert client.delete(f"/api/alerts/rules/{r['id']}").json() == {"ok": True}
    assert client.delete(f"/api/alerts/rules/{r['id']}").status_code == 404


def test_mock_snapshot_rule_runs(db):
    add_rule(min_value=-100)
    assert alerts.evaluate(mock.snapshot(seed=1))
