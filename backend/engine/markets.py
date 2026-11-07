"""Market model helpers.

An event's markets look like::

    {"moneyline": [{"name": "Lakers", "point": None, "prices": {"DraftKings": -120, ...}}, ...],
     "spreads":   [{"name": "Lakers", "point": -3.5, "prices": {...}},
                   {"name": "Celtics", "point": 3.5, "prices": {...}}, ...],
     "totals":    [{"name": "Over", "point": 220.5, "prices": {...}}, ...]}

The same outcome name can appear several times at different points when books
hang different lines. Outcomes can only be compared (devigged, arbed) inside a
*line group*: the set of mutually exclusive outcomes at one line.
"""
DRAW = "Draw"


def line_key(market: str, outcome: dict, home: str) -> float | None:
    """The line an outcome belongs to, from a single shared perspective.

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
    """Outcome names that together make up one complete, mutually exclusive market."""
    if market == "totals":
        return ["Over", "Under"]
    names = [home, away]
    if market == "moneyline" and any(o["name"] == DRAW for o in outcomes):
        names.append(DRAW)  # 3-way market (e.g. soccer)
    return names


def line_groups(market: str, outcomes: list[dict], home: str, away: str) -> list[dict]:
    """Complete line groups: [{"point": key, "outcomes": [outcome per required name]}].

    Lines where not every side is offered are skipped.
    """
    names = required_names(market, outcomes, home, away)
    by_line: dict = {}
    for o in outcomes:
        if o["name"] in names:
            by_line.setdefault(line_key(market, o, home), {})[o["name"]] = o
    groups = []
    for key, sides in by_line.items():
        if all(n in sides for n in names):
            groups.append({"point": key, "outcomes": [sides[n] for n in names]})
    return sorted(groups, key=lambda g: (g["point"] is None, g["point"] or 0))


def label(outcome: dict) -> str:
    """Human-readable pick, e.g. 'Lakers', 'Lakers -3.5', 'Over 220.5'."""
    p = outcome.get("point")
    if p is None:
        return outcome["name"]
    return f'{outcome["name"]} {p:+g}' if outcome["name"] not in ("Over", "Under") else f'{outcome["name"]} {p:g}'
