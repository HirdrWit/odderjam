"""The Odds API v4 adapter (h2h, spreads, totals, player props). Needs ODDS_API_KEY.

Player props are only served by the per-event endpoint, so each game costs an extra
(regions x prop markets) credits. They are OFF unless ODDS_PROP_MARKETS is set, e.g.
ODDS_PROP_MARKETS=player_points,player_threes,batter_hits. Each sport only requests the
listed keys that belong to it (see SPORT_PROPS); keys we don't know are sent to every sport.
"""
import json
import os
from pathlib import Path

import httpx

from ..engine.markets import is_prop
from .books import SHARP, us_name

ALL = {"NBA": "basketball_nba", "NFL": "americanfootball_nfl", "MLB": "baseball_mlb", "NHL": "icehockey_nhl"}
# Each sport costs (regions x markets) credits per fetch. Pick sports in season via ODDS_SPORTS
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
REGIONS = "us,eu"
BASE = "https://api.the-odds-api.com/v4/sports"


META = Path(__file__).resolve().parent.parent.parent / ".odds_meta.json"


def parse_event(e: dict, sport: str) -> dict:
    """Convert one Odds API event into our event shape."""
    markets: dict[str, dict[tuple[str, float | None], dict]] = {}
    for bk in e["bookmakers"]:
        name = SHARP if bk["key"] == "pinnacle" else us_name(bk["title"])
        if name is None:
            continue  # not available to US bettors
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
                outcome["prices"][name] = o["price"]
    return {"id": e["id"], "sport": sport, "home": e["home_team"], "away": e["away_team"],
            "start": e["commence_time"], "markets": {k: list(v.values()) for k, v in markets.items()}}


def props_for(sport: str) -> list[str]:
    """The configured prop markets that apply to a sport."""
    known = set().union(*SPORT_PROPS.values())
    return [m for m in PROP_MARKETS if m in SPORT_PROPS.get(sport, set()) or m not in known]


def _get(url: str, params: dict) -> httpx.Response:
    r = httpx.get(url, params={"apiKey": os.environ["ODDS_API_KEY"], "regions": REGIONS, "oddsFormat": "american",
                               **params}, timeout=20)
    if "x-requests-remaining" in r.headers:
        META.write_text(json.dumps({"remaining": r.headers["x-requests-remaining"],
                                    "used": r.headers.get("x-requests-used")}))
    return r


def _add_props(event: dict, sport_key: str, markets: list[str]) -> None:
    """Fetch props for one event from the event-odds endpoint and merge them into its markets."""
    r = _get(f"{BASE}/{sport_key}/events/{event['id']}/odds", {"markets": ",".join(markets)})
    if r.status_code != 200:
        return
    props = parse_event(r.json(), event["sport"])["markets"]
    event["markets"].update({k: v for k, v in props.items() if is_prop(k)})


def snapshot() -> list[dict]:
    events = []
    for sport, k in SPORTS.items():
        r = _get(f"{BASE}/{k}/odds", {"markets": ",".join(MARKETS)})
        if r.status_code != 200:
            continue
        sport_events = [parse_event(e, sport) for e in r.json()]
        if props := props_for(sport):
            for e in sport_events:
                _add_props(e, k, props)
        events.extend(sport_events)
    return events
