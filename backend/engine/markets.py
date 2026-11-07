"""Market model helpers.

An event's markets look like::

    {"moneyline": [{"name": "Lakers", "point": None, "prices": {"DraftKings": -120, ...}}, ...],
     "spreads":   [{"name": "Lakers", "point": -3.5, "prices": {...}},
                   {"name": "Celtics", "point": 3.5, "prices": {...}}, ...],
     "totals":    [{"name": "Over", "point": 220.5, "prices": {...}}, ...],
     "player_points": [{"name": "Over", "player": "LeBron James", "point": 25.5, "prices": {...}}, ...]}

Player props are any market whose key starts with a prop prefix (``player_``,
``batter_``, ``pitcher_``). Their outcomes carry the ``player`` and are
Over/Under (or Yes/No for markets like anytime scorer).

The same outcome name can appear several times at different points when books
hang different lines. Outcomes can only be compared (devigged, arbed) inside a
*line group*: the set of mutually exclusive outcomes at one line.
"""
DRAW = "Draw"
PROP_PREFIXES = ("player_", "batter_", "pitcher_")


def is_prop(market: str) -> bool:
    """True for player prop markets (e.g. player_points, batter_hits)."""
    return market.startswith(PROP_PREFIXES)


def line_key(market: str, outcome: dict, home: str) -> float | None:
    """Return the line an outcome belongs to, from a single shared perspective.

    Spreads use the home team's point (home -3.5 pairs with away +3.5).
    Totals use the total itself. Moneyline has no line.
    """
    p = outcome.get("point")
    if p is None or market == "moneyline":
        return None
    if market == "spreads" and outcome["name"] != home:
        return -p
    return p


def required_names(market: str, outcomes: list[dict], home: str, away: str) -> list[str]:
    """Return the outcome names that together make up one complete, mutually exclusive market."""
    if market == "totals":
        return ["Over", "Under"]
    if is_prop(market):
        return ["Yes", "No"] if any(o["name"] == "Yes" for o in outcomes) else ["Over", "Under"]
    names = [home, away]
    if market == "moneyline" and any(o["name"] == DRAW for o in outcomes):
        names.append(DRAW)  # 3-way market (e.g. soccer)
    return names


def line_groups(market: str, outcomes: list[dict], home: str, away: str) -> list[dict]:
    """Return complete line groups: [{"player": str | None, "point": key, "outcomes": [outcome per required name]}].

    Props are grouped per player as well as per line. Lines where not every side is offered are skipped.
    """
    names = required_names(market, outcomes, home, away)
    by_line: dict[tuple[str | None, float | None], dict[str, dict]] = {}
    for o in outcomes:
        if o["name"] in names:
            by_line.setdefault((o.get("player"), line_key(market, o, home)), {})[o["name"]] = o
    groups = []
    for (player, key), sides in by_line.items():
        if all(n in sides for n in names):
            groups.append({"player": player, "point": key, "outcomes": [sides[n] for n in names]})
    return sorted(groups, key=lambda g: (g["player"] or "", g["point"] is None, g["point"] or 0))


def label(outcome: dict) -> str:
    """Human-readable pick, e.g. 'Lakers', 'Lakers -3.5', 'Over 220.5', 'LeBron James Over 25.5'."""
    p = outcome.get("point")
    name = outcome["name"]
    if p is None:
        text = name
    elif name in ("Over", "Under"):
        text = f"{name} {p:g}"
    else:
        text = f"{name} {p:+g}"
    player = outcome.get("player")
    return f"{player} {text}" if player else text
