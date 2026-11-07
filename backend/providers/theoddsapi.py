"""The Odds API v4 adapter (moneyline / h2h). Needs ODDS_API_KEY."""
import json
import os
from pathlib import Path

import httpx

from .books import REFERENCE_ONLY, us_name

ALL = {"NBA": "basketball_nba", "NFL": "americanfootball_nfl", "MLB": "baseball_mlb", "NHL": "icehockey_nhl"}
# Each sport costs (regions x markets) credits per fetch. Pick sports in season via ODDS_SPORTS.
SPORTS = {k: v for k, v in ALL.items() if k in os.environ.get("ODDS_SPORTS", "NFL,NBA").split(",")}


META = Path(__file__).resolve().parent.parent.parent / ".odds_meta.json"


def snapshot() -> list[dict]:
    key = os.environ["ODDS_API_KEY"]
    events = []
    for sport, k in SPORTS.items():
        r = httpx.get(
            f"https://api.the-odds-api.com/v4/sports/{k}/odds",
            params={"apiKey": key, "regions": "us,eu", "markets": "h2h", "oddsFormat": "american"},
            timeout=20,
        )
        if "x-requests-remaining" in r.headers:
            META.write_text(json.dumps({"remaining": r.headers["x-requests-remaining"],
                                        "used": r.headers.get("x-requests-used")}))
        if r.status_code != 200:
            continue
        for e in r.json():
            ml = {}
            for bk in e["bookmakers"]:
                name = REFERENCE_ONLY.get(bk["key"]) or us_name(bk["title"])
                if name is None:
                    continue  # not available to US bettors
                oc = {o["name"]: o["price"] for o in bk["markets"][0]["outcomes"]}
                if e["home_team"] in oc and e["away_team"] in oc:
                    ml[name] = {"home": oc[e["home_team"]], "away": oc[e["away_team"]]}
            events.append({"id": e["id"], "sport": sport, "home": e["home_team"], "away": e["away_team"],
                           "start": e["commence_time"], "markets": {"moneyline": ml}})
    return events
