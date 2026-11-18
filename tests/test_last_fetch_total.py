"""odderjam-128: .odds_meta.json last_cost is the whole fetch, not the final call."""
import json

import httpx
import pytest

from backend import providers
from backend.providers import theoddsapi
from tests.test_credits_cost import api, hdr, respond, Resp, NOW  # noqa: F401


def meta():
    return json.loads(theoddsapi.META.read_text())


def test_cache_last_cost_is_whole_snapshot(api, monkeypatch):
    respond(monkeypatch, [hdr(100, 1, 3), hdr(97, 4, 3)])
    theoddsapi.snapshot()
    assert float(providers.cache_info()["last_cost"]) == 6
    assert float(meta()["remaining"]) == 97


def test_cache_last_cost_zero_when_all_calls_free(api, monkeypatch):
    respond(monkeypatch, [hdr(100, 1, 0), hdr(100, 1, 0)])
    theoddsapi.snapshot()
    assert float(providers.cache_info()["last_cost"]) == 0


def test_scores_keeps_previous_last_cost(api, monkeypatch):
    respond(monkeypatch, [hdr(100, 1, 3), hdr(97, 4, 3), hdr(95, 6, 2)])
    theoddsapi.snapshot()
    theoddsapi.scores(["NBA"])
    assert float(meta()["last_cost"]) == 6
    assert float(meta()["remaining"]) == 95


def test_props_calls_counted_in_last_cost(api, monkeypatch):
    monkeypatch.setattr(theoddsapi, "SPORTS", {"NBA": "basketball_nba"})
    monkeypatch.setattr(theoddsapi, "props_for", lambda sport: ["player_points"])
    monkeypatch.setattr(theoddsapi, "parse_event", lambda e, sport: {"id": e["id"], "sport": sport, "markets": {}})
    calls = iter([Resp(hdr(100, 1, 3), [{"id": "e1"}]), Resp(hdr(97, 4, 1), {})])
    monkeypatch.setattr(httpx, "get", lambda *a, **k: next(calls))
    theoddsapi.snapshot()
    assert float(meta()["last_cost"]) == 4
