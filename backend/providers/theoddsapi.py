"""The Odds API v4 adapter (h2h, spreads, totals). Needs ODDS_API_KEY."""
import json
import os
from pathlib import Path

import httpx

from .books import SHARP, us_name

ALL = {"NBA": "basketball_nba", "NFL": "americanfootball_nfl", "MLB": "baseball_mlb", "NHL": "icehockey_nhl"}
# Each sport costs (regions x markets) credits per fetch. Pick sports in season via ODDS_SPORTS
# and markets via ODDS_MARKETS (e.g. "h2h" alone costs a third of "h2h,spreads,totals").
SPORTS = {k: v for k, v in ALL.items() if k in os.environ.get("ODDS_SPORTS", "NFL,NBA").split(",")}
MARKETS = [m.strip() for m in os.environ.get("ODDS_MARKETS", "h2h,spreads,totals").split(",") if m.strip()]
# The Odds API market key -> our market key.
MARKET_KEYS = {"h2h": "moneyline", "spreads": "spreads", "totals": "totals"}


META = Path(__file__).resolve().parent.parent.parent / ".odds_meta.json"


def parse_event(e: dict, sport: str) -> dict:
    """Convert one Odds API event into our event shape."""
    markets: dict[str, dict] = {}
    for bk in e["bookmakers"]:
        name = SHARP if bk["key"] == "pinnacle" else us_name(bk["title"])
        if name is None:
            continue  # not available to US bettors
        for m in bk["markets"]:
            key = MARKET_KEYS.get(m["key"])
            if key is None:
                continue
            outs = markets.setdefault(key, {})
            for o in m["outcomes"]:
                point = o.get("point")
                oc = outs.setdefault((o["name"], point), {"name": o["name"], "point": point, "prices": {}})
                oc["prices"][name] = o["price"]
    return {"id": e["id"], "sport": sport, "home": e["home_team"], "away": e["away_team"],
            "start": e["commence_time"], "markets": {k: list(v.values()) for k, v in markets.items()}}


def snapshot() -> list[dict]:
    key = os.environ["ODDS_API_KEY"]
    events = []
    for sport, k in SPORTS.items():
        r = httpx.get(
            f"https://api.the-odds-api.com/v4/sports/{k}/odds",
            params={"apiKey": key, "regions": "us,eu", "markets": ",".join(MARKETS), "oddsFormat": "american"},
            timeout=20,
        )
        if "x-requests-remaining" in r.headers:
            META.write_text(json.dumps({"remaining": r.headers["x-requests-remaining"],
                                        "used": r.headers.get("x-requests-used")}))
        if r.status_code != 200:
            continue
        events.extend(parse_event(e, sport) for e in r.json())
    return events
