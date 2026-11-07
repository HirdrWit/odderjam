"""Fair prices from a weighted consensus of sharp books."""
from . import devig
from .odds import american_to_prob


def parse_weights(spec: str) -> dict[str, float]:
    """'Pinnacle:1,Circa Sports:0.5' -> {'Pinnacle': 1.0, 'Circa Sports': 0.5}. Bad or <=0 entries are dropped."""
    out = {}
    for part in spec.split(","):
        name, _, w = part.rpartition(":")
        try:
            weight = float(w)
        except ValueError:
            continue
        if name.strip() and weight > 0:
            out[name.strip()] = weight
    return out


def hold_pct(line: dict | list[float]) -> float:
    """Book margin in percent, on a two-way {home, away} line or a list of prices (one per outcome)."""
    prices = [line["home"], line["away"]] if isinstance(line, dict) else line
    return (sum(american_to_prob(p) for p in prices) - 1) * 100


def consensus_probs(lines: dict[str, list[float]], weights: dict[str, float], method: str = "multiplicative",
                    max_hold: float | None = None) -> dict | None:
    """Devig each weighted sharp book on its own, then take the weighted mean of the fair probs.

    `lines` maps book -> prices, one per outcome, all in the same order.
    Sharp books whose hold is above max_hold (percent) are left out: a wide market
    gives an unreliable fair price. Returns None when no sharp book is usable,
    else {"probs": [...], "hold_pct": weighted hold, "sharps": [...]}.
    """
    fn = devig.METHODS[method]
    used, total = [], 0.0
    for book, w in weights.items():
        prices = lines.get(book)
        if not prices or w <= 0:
            continue
        h = hold_pct(prices)
        if max_hold is not None and h > max_hold:
            continue
        used.append({"book": book, "weight": w, "hold_pct": h,
                     "probs": fn([american_to_prob(p) for p in prices])})
        total += w
    if not used:
        return None
    n = len(used[0]["probs"])
    return {
        "probs": [sum(u["weight"] * u["probs"][i] for u in used) / total for i in range(n)],
        "hold_pct": sum(u["weight"] * u["hold_pct"] for u in used) / total,
        "sharps": [{"book": u["book"], "weight": u["weight"], "hold_pct": u["hold_pct"]} for u in used],
    }


def group_consensus(outcomes: list[dict], weights: dict[str, float], method: str = "multiplicative",
                    max_hold: float | None = None) -> dict | None:
    """consensus_probs for one line group; only books pricing every outcome of the line are used."""
    lines = {b: [o["prices"][b] for o in outcomes] for b in weights
             if all(b in o["prices"] for o in outcomes)}
    return consensus_probs(lines, weights, method, max_hold)


def consensus(ml: dict, weights: dict[str, float], method: str = "multiplicative",
              max_hold: float | None = None) -> dict | None:
    """consensus_probs for a two-way {book: {home, away}} moneyline; adds "home" and "away"."""
    r = consensus_probs({b: [l["home"], l["away"]] for b, l in ml.items()}, weights, method, max_hold)
    if r is None:
        return None
    r["home"], r["away"] = r["probs"]
    return r
