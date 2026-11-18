"""The Odds API v4 adapter (h2h, spreads, totals, player props). Needs ODDS_API_KEY.

Player props are only served by the per-event endpoint, so each game costs an extra
(bookmaker groups x prop markets) credits. They are OFF unless ODDS_PROP_MARKETS is set, e.g.
ODDS_PROP_MARKETS=player_points,player_threes,batter_hits. Each sport only requests the
listed keys that belong to it (see SPORT_PROPS); keys we don't know are sent to every sport.
"""
import json
import logging
import math
import os
import time
from datetime import datetime, timezone
from pathlib import Path

import httpx

from ..engine.exchange import apply_commission, fee_for
from ..engine.markets import is_prop
from .. import providers
from . import ProviderError
from .books import KEY_NAMES, REFERENCE_ONLY, us_name

ALL = {"NBA": "basketball_nba", "NFL": "americanfootball_nfl", "MLB": "baseball_mlb", "NHL": "icehockey_nhl"}
# Each sport costs (bookmaker groups x markets) credits per fetch. Pick sports in season via ODDS_SPORTS
# and markets via ODDS_MARKETS (e.g. "h2h" alone costs a third of "h2h,spreads,totals").
SPORTS = {k: v for k, v in ALL.items() if k in os.environ.get("ODDS_SPORTS", "NFL,NBA").split(",")}
MARKETS = [m.strip() for m in os.environ.get("ODDS_MARKETS", "h2h,spreads,totals").split(",") if m.strip()]
# The Odds API market key -> our market key (prop keys are kept as-is).
MARKET_KEYS = {"h2h": "moneyline", "spreads": "spreads", "totals": "totals"}
# Known prop market keys per sport, used to send each sport only the props it has.
SPORT_PROPS = {
    "NBA": {"player_points", "player_rebounds", "player_assists", "player_threes", "player_blocks", "player_steals",
            "player_points_rebounds_assists", "player_double_double"},
    "NFL": {"player_pass_yds", "player_pass_tds", "player_rush_yds", "player_receptions", "player_reception_yds",
            "player_anytime_td"},
    "MLB": {"batter_hits", "batter_home_runs", "batter_total_bases", "batter_rbis", "pitcher_strikeouts"},
    "NHL": {"player_points", "player_goals", "player_assists", "player_shots_on_goal"},
}
PROP_MARKETS = [m.strip() for m in os.environ.get("ODDS_PROP_MARKETS", "").split(",") if m.strip()]
DEFAULT_BOOKMAKERS = ["pinnacle", "betonlineag", "draftkings", "fanduel", "betmgm", "betrivers", "williamhill_us",
                      "fanatics", "espnbet", "hardrockbet"]
MAX_PER_GROUP = 10  # The Odds API bills every group of 10 bookmakers as 1 region
log = logging.getLogger(__name__)
BASE = "https://api.the-odds-api.com/v4/sports"


# Some deep links contain a {state} placeholder (e.g. BetMGM). Set ODDS_STATE (e.g. "nj") to fill it;
# without it those links are dropped and the UI falls back to the book's homepage.
STATE = os.environ.get("ODDS_STATE", "").strip().lower()

META = Path(__file__).resolve().parent.parent.parent / ".odds_meta.json"


def _link(*candidates: str | None) -> str | None:
    """First usable link: outcome beats market beats bookmaker."""
    for url in candidates:
        if not url:
            continue
        if "{state}" in url:
            if not STATE:
                continue
            url = url.replace("{state}", STATE)
        return url
    return None


def parse_event(e: dict, sport: str) -> dict:
    """Convert one Odds API event into our event shape."""
    markets: dict[str, dict[tuple[str, float | None], dict]] = {}
    updated: dict[str, str] = {}
    for bk in e["bookmakers"]:
        name = REFERENCE_ONLY.get(bk["key"]) or KEY_NAMES.get(bk["key"]) or us_name(bk["title"])
        if name is None:
            continue  # not available to US bettors
        if bk.get("last_update"):
            updated[name] = bk["last_update"]
        fee = fee_for(name)  # exchanges quoted in American odds may take a commission on winnings
        for m in bk["markets"]:
            key = m["key"] if is_prop(m["key"]) else MARKET_KEYS.get(m["key"])
            if key is None:
                continue
            outcomes = markets.setdefault(key, {})
            for o in m["outcomes"]:
                point = o.get("point")
                player = o.get("description") if is_prop(key) else None
                new = {"name": o["name"], "point": point, "prices": {}}
                if player:
                    new["player"] = player
                outcome = outcomes.setdefault((o["name"], player, point), new)
                price = apply_commission(o["price"], fee)
                if price is None:
                    continue
                outcome["prices"][name] = price
                link = _link(o.get("link"), m.get("link"), bk.get("link"))
                if link:
                    outcome.setdefault("links", {})[name] = link
    return {"id": e["id"], "sport": sport, "home": e["home_team"], "away": e["away_team"],
            "start": e["commence_time"], "markets": {k: list(v.values()) for k, v in markets.items()}, "updated": updated}


def fetch_cost() -> int:
    """Credits one live snapshot(live_only=True) costs: sports x ceil(bookmakers / 10) x markets (no props)."""
    return len(SPORTS) * math.ceil(len(bookmakers()) / MAX_PER_GROUP) * len(MARKETS)


def props_for(sport: str) -> list[str]:
    """The configured prop markets that apply to a sport."""
    known = set().union(*SPORT_PROPS.values())
    return [m for m in PROP_MARKETS if m in SPORT_PROPS.get(sport, set()) or m not in known]


_call_costs: list[float] = []  # x-requests-last of each call in the latest snapshot()


def _note_cost(r: httpx.Response) -> None:
    try:
        _call_costs.append(float(r.headers["x-requests-last"]))
    except (KeyError, TypeError, ValueError):
        pass  # no usable header: the cost of this call is unknown


def _read_last_cost() -> str | float | None:
    try:
        return json.loads(META.read_text()).get("last_cost")
    except (OSError, ValueError, AttributeError):
        return None


def _write_meta(r: httpx.Response) -> None:
    """Save the credit headers atomically (a truncated file would break /api/cache).

    remaining and used come from this response. last_cost is the cost of a whole fetch, not of one
    call, so a single call keeps the stored figure; _store_fetch_cost() records the sum when a snapshot finishes.
    """
    if "x-requests-remaining" in r.headers:
        tmp = META.with_name(META.name + ".tmp")
        tmp.write_text(json.dumps({"remaining": r.headers["x-requests-remaining"],
                                   "used": r.headers.get("x-requests-used"),
                                   "last_cost": _read_last_cost()}))
        tmp.replace(META)


def _store_fetch_cost() -> None:
    """Record the summed cost of the finished snapshot() as last_cost, keeping remaining and used."""
    total = last_fetch_cost()
    if total is None:
        return
    try:
        meta = json.loads(META.read_text())
    except (OSError, ValueError):
        return
    if not isinstance(meta, dict):
        return
    tmp = META.with_name(META.name + ".tmp")
    tmp.write_text(json.dumps({**meta, "last_cost": total}))
    tmp.replace(META)


def _get(url: str, params: dict) -> httpx.Response:
    r = httpx.get(url, params={"apiKey": os.environ["ODDS_API_KEY"], "bookmakers": ",".join(bookmakers()), "oddsFormat": "american",
                               **params}, timeout=20)
    _write_meta(r)
    _note_cost(r)
    return r


def _add_props(event: dict, sport_key: str, markets: list[str]) -> None:
    """Fetch props for one event from the event-odds endpoint and merge them into its markets."""
    r = _get(f"{BASE}/{sport_key}/events/{event['id']}/odds", {"markets": ",".join(markets), "includeLinks": "true"})
    if r.status_code != 200:
        return
    props = parse_event(r.json(), event["sport"])["markets"]
    event["markets"].update({k: v for k, v in props.items() if is_prop(k)})


def snapshot(live_only: bool = False, now: float | None = None) -> list[dict]:
    """Fetch all sports. With live_only, only events that have already started (commenceTimeTo=now).

    Live fetches skip player props: they cost extra credits per event, which fetch_cost() and the
    live budget do not count.
    """
    params = {"markets": ",".join(MARKETS), "includeLinks": "true"}
    if live_only:
        ts = time.time() if now is None else now
        params["commenceTimeTo"] = datetime.fromtimestamp(ts, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    events, failures = [], []
    _call_costs.clear()
    for sport, k in SPORTS.items():
        r = _get(f"{BASE}/{k}/odds", dict(params))
        if r.status_code != 200:
            failures.append(r.status_code)
            continue
        sport_events = [parse_event(e, sport) for e in r.json()]
        if not live_only and (props := props_for(sport)):
            for e in sport_events:
                _add_props(e, k, props)
        events.extend(sport_events)
    _store_fetch_cost()
    if failures and not events:
        raise ProviderError(f"every sport failed ({failures[0]})", status=failures[0])
    if failures:
        providers._partial_failure = failures[0]
    return events


def scores(sports: list[str], days_from: int = 3) -> list[dict]:
    """Recent and live games from /scores for our sport codes (e.g. ["NBA"]).

    Costs 2 credits per sport with daysFrom set, so callers should only ask for sports they need.
    Each game gets a "sport" key with our sport code.
    """
    key = os.environ["ODDS_API_KEY"]
    games = []
    for sport in sports:
        k = ALL.get(sport)
        if k is None:
            continue
        r = httpx.get(f"https://api.the-odds-api.com/v4/sports/{k}/scores",
                      params={"apiKey": key, "daysFrom": days_from}, timeout=20)
        _write_meta(r)
        if r.status_code != 200:
            raise ProviderError(f"scores request failed ({r.status_code})", status=r.status_code)
        games.extend({**g, "sport": sport} for g in r.json())
    return games


def bookmakers() -> list[str]:
    """Bookmaker keys to request: ODDS_BOOKMAKERS or the defaults. Warns above 10 (each extra group of 10 costs more)."""
    raw = os.environ.get("ODDS_BOOKMAKERS")
    keys = [k.strip() for k in (raw or "").split(",") if k.strip()] or list(DEFAULT_BOOKMAKERS)
    if len(keys) > MAX_PER_GROUP:
        log.warning("ODDS_BOOKMAKERS has %d keys; more than 10 costs an extra credit group per market", len(keys))
    return keys


def last_fetch_cost() -> float | None:
    """Sum of x-requests-last over the calls of the latest snapshot(); None if no call reported one."""
    return sum(_call_costs) if _call_costs else None
