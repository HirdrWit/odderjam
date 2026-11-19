"""Alerts skip rows already in the Tracker (odderjam-133)."""
from backend import alerts, providers, scan
from tests.test_hidden import _event, _rule, client, track  # noqa: F401


def test_alert_does_not_fire_for_tracked_row(client, monkeypatch):
    monkeypatch.setattr(providers, "peek_snapshot", lambda: [])
    _rule()
    (row,) = scan.ev_rows([_event()], {"Pinnacle": 1.0}, 10, min_ev=1)
    track(client, row)
    assert alerts.evaluate([_event()]) == []
