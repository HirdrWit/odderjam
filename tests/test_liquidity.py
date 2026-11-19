"""odderjam-132: exchange liquidity on quotes and rows, and the sharp_counterparty flag."""
import copy
import json
import math
import shutil
import subprocess
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend import main, providers, scan
from backend.engine import bettable, sizing
from backend.providers import exchanges, kalshi, polymarket
from tests.test_bettable import NOW, ctx, event, iso, ml  # noqa: F401

ROOT = Path(__file__).resolve().parent.parent
FIXTURES = Path(__file__).parent / "fixtures"
FRONTEND = ROOT / "frontend"
KALSHI_FEE = {"model": "kalshi", "rate": 0.07}
NO_FEE = {"model": "none"}


def load(name):
    return json.loads((FIXTURES / name).read_text())


def kalshi_payload():
    """The recorded markets with order book sizes (contracts) added on the Boston/Lakers game only."""
    p = copy.deepcopy(load("kalshi_markets.json"))
    for m in p["markets"]:
        if m["ticker"].endswith("BOSLAL-BOS"):
            m["no_ask_size_fp"] = "200.00"   # backs Lakers at 38c
            m["yes_ask_size_fp"] = "10000.00"  # backs Boston at 62c
    return p


def polymarket_payload():
    p = copy.deepcopy(load("polymarket_events.json"))
    m1 = p[0]["markets"][0]
    m1["bestAskSize"], m1["bestBidSize"] = 1000, 200  # shares
    return p


# ---- I1: parsers ----------------------------------------------------------------------------

def test_kalshi_parse_returns_dollar_liquidity_and_null_without_depth():
    quotes = kalshi.parse(kalshi_payload(), "NBA", KALSHI_FEE)
    by = {frozenset(q["prices"]): q for q in quotes}
    lal = by[frozenset({"Los Angeles L", "Boston"})]["liquidity"]
    assert lal["Los Angeles L"] == pytest.approx(200 * 0.38)
    assert lal["Boston"] == pytest.approx(10000 * 0.62)
    gsw = by[frozenset({"Golden State", "Denver"})]["liquidity"]
    assert gsw == {"Golden State": None, "Denver": None}


def test_polymarket_parse_returns_dollar_liquidity_and_null_without_depth():
    quotes = polymarket.parse(polymarket_payload(), "NBA", NO_FEE)
    by = {frozenset(q["prices"]): q for q in quotes}
    bos = by[frozenset({"Celtics", "Lakers"})]["liquidity"]
    assert bos["Celtics"] == pytest.approx(1000 * 0.61)
    assert bos["Lakers"] == pytest.approx(200 * 0.40)
    den = by[frozenset({"Nuggets", "Warriors"})]["liquidity"]
    assert den == {"Nuggets": None, "Warriors": None}


def test_merge_keeps_liquidity_per_book_and_null_is_not_zero():
    ev = {"id": "x", "sport": "NBA", "home": "Los Angeles Lakers", "away": "Boston Celtics",
          "start": "2026-11-17T06:00:00+00:00", "markets": {}}
    q = {"book": "Kalshi", "sport": "NBA", "start": "2026-11-17T06:00:00+00:00",
         "prices": {"Los Angeles L": 140, "Boston": -160},
         "liquidity": {"Los Angeles L": 76.0, "Boston": None}}
    exchanges.merge_quotes([ev], [q])
    outs = {o["name"]: o for o in ev["markets"]["moneyline"]}
    assert outs["Los Angeles Lakers"]["liquidity"]["Kalshi"] == 76.0
    assert outs["Boston Celtics"].get("liquidity", {}).get("Kalshi") is None
    assert 0 not in (outs["Boston Celtics"].get("liquidity") or {}).values()


# ---- I2: flag --------------------------------------------------------------------------------

def test_flag_default_threshold_is_5000_strictly_above():
    assert bettable.DEFAULT_PROFILE["max_counterparty_liquidity"] == 5000
    p = bettable.DEFAULT_PROFILE
    assert "sharp_counterparty" not in bettable.flags(ctx(liquidity=68.0), p)
    assert "sharp_counterparty" in bettable.flags(ctx(liquidity=68000.0), p)
    assert "sharp_counterparty" not in bettable.flags(ctx(liquidity=5000.0), p)
    assert "sharp_counterparty" in bettable.flags(ctx(liquidity=5000.01), p)


def test_flag_follows_the_profile_threshold_and_has_a_label():
    p = {**bettable.DEFAULT_PROFILE, "max_counterparty_liquidity": 50}
    assert "sharp_counterparty" in bettable.flags(ctx(liquidity=68.0), p)
    assert bettable.LABELS["sharp_counterparty"] == "Large order on the other side: likely a sharp bettor"


def test_unknown_liquidity_never_flags():
    assert "sharp_counterparty" not in bettable.flags(ctx(liquidity=None), bettable.DEFAULT_PROFILE)
    assert "sharp_counterparty" not in bettable.flags(ctx(), bettable.DEFAULT_PROFILE)


# ---- endpoint ---------------------------------------------------------------------------------

def ex_event(eid, liq_a, liq_b=None):
    """Pinnacle-priced game with Kalshi at +105 on A (fair 50%) carrying the given liquidity."""
    markets = ml({"Pinnacle": -110, "Kalshi": 105, "DraftKings": 105}, {"Pinnacle": -110, "Kalshi": -140})
    o = markets["moneyline"]
    if liq_a is not None:
        o[0]["liquidity"] = {"Kalshi": liq_a}
    e = event(eid, NOW + 7200, markets)
    e["updated"]["Kalshi"] = iso(NOW - 5)
    return e


@pytest.fixture
def client(monkeypatch):
    events = [ex_event("small", 68.0), ex_event("big", 68000.0), ex_event("nodata", None)]
    monkeypatch.setattr(main, "get_snapshot", lambda: events)
    monkeypatch.setattr(main, "_now", lambda: NOW)
    providers.reset_live()
    yield TestClient(main.app)
    providers.reset_live()


def row(client, eid, book="Kalshi", **params):
    rows = client.get("/api/ev", params=params).json()
    return next(r for r in rows if r["event_id"] == eid and r["book"] == book)


def test_ev_rows_carry_liquidity_and_the_flag(client):
    small, big = row(client, "small"), row(client, "big")
    assert small["liquidity"] == 68.0 and "sharp_counterparty" not in small["flags"]
    assert big["liquidity"] == 68000.0 and "sharp_counterparty" in big["flags"]


def test_threshold_query_param_changes_the_flag(client):
    assert "sharp_counterparty" in row(client, "small", max_counterparty_liquidity=50)["flags"]
    assert "sharp_counterparty" not in row(client, "big", max_counterparty_liquidity=100000)["flags"]


def test_books_without_size_data_show_no_liquidity_and_no_flag(client):
    assert row(client, "nodata")["liquidity"] is None
    assert "sharp_counterparty" not in row(client, "nodata")["flags"]
    dk = row(client, "big", book="DraftKings")
    assert dk["liquidity"] is None and "sharp_counterparty" not in dk["flags"]


def test_bettable_only_hides_the_large_order_row(client):
    ids = {(r["event_id"], r["book"]) for r in client.get("/api/ev", params={"bettable": "true"}).json()}
    assert ("big", "Kalshi") not in ids and ("small", "Kalshi") in ids


# ---- I3: stake cap ------------------------------------------------------------------------------

def test_ev_stake_is_capped_at_liquidity():
    events = [ex_event("small", 68.0), ex_event("nodata", None)]
    weights = {"Pinnacle": 1.0}
    rows = scan.ev_rows(events, weights, 6.0, bankroll=1_000_000.0, round_to=1.0, now=NOW)
    small = next(r for r in rows if r["event_id"] == "small" and r["book"] == "Kalshi")
    nodata = next(r for r in rows if r["event_id"] == "nodata" and r["book"] == "Kalshi")
    assert small["stake"] <= 68.0 and small["stake"] > 0
    assert nodata["stake"] > 68.0  # no size data: not capped


def test_size_arb_caps_each_leg():
    out = sizing.size_arb([120, 120], 1000.0, 1.0, None, leg_caps=[50.0, None])
    assert out["stakes"][0] <= 50.0
    # the other leg is scaled to keep the arb balanced, not left at the uncapped amount
    assert out["stakes"][1] <= 60.0
    assert out["min_profit"] > 0


def test_arb_rows_cap_legs_at_liquidity():
    markets = ml({"DraftKings": 120, "Kalshi": 130}, {"DraftKings": -150, "FanDuel": 120})
    markets["moneyline"][0]["liquidity"] = {"Kalshi": 40.0}
    e = event("arb", NOW + 7200, markets)
    e["updated"].update({"Kalshi": iso(NOW - 5), "FanDuel": iso(NOW - 5)})
    rows = scan.arb_rows([e], total=1000.0, now=NOW)
    assert rows
    legs = {leg["book"]: leg for leg in rows[0]["legs"]}
    assert legs["Kalshi"]["liquidity"] == 40.0 and legs["Kalshi"]["stake"] <= 40.0
    assert legs["FanDuel"]["liquidity"] is None  # a book without size data
    assert rows[0]["min_profit"] > 0


# ---- I4: settings ---------------------------------------------------------------------------------

def test_negative_threshold_is_422(client):
    assert client.get("/api/ev", params={"max_counterparty_liquidity": -1}).status_code == 422
    assert client.get("/api/ev", params={"max_counterparty_liquidity": "nan"}).status_code == 422
    assert client.get("/api/ev", params={"max_counterparty_liquidity": 0}).status_code == 200
    assert bettable.profile_error({**bettable.DEFAULT_PROFILE, "max_counterparty_liquidity": -1})


@pytest.mark.skipif(shutil.which("node") is None, reason="node not installed")
def test_liquidity_js():
    r = subprocess.run(["node", "--test", "src/liquidity.test.js"], cwd=FRONTEND, capture_output=True, text=True)
    assert r.returncode == 0, r.stdout + r.stderr


# ---- display ------------------------------------------------------------------------------------------

def test_odds_screen_exposes_liquidity(client):
    rows = client.get("/api/odds").json()
    outs = rows[0]["markets"]["moneyline"]
    assert outs[0]["liquidity"] == {"Kalshi": 68.0}


def test_ui_shows_liquidity_on_the_three_tables():
    main_jsx = (FRONTEND / "src" / "main.jsx").read_text()
    odds_jsx = (FRONTEND / "src" / "OddsScreen.jsx").read_text()
    assert main_jsx.count("fmtLiquidity(") >= 2   # +EV and Arbitrage rows
    assert "fmtLiquidity(" in odds_jsx
    assert "bettableQuery(" in main_jsx
