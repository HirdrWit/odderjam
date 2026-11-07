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


def hold_pct(line: dict) -> float:
    """Book margin on a two-way line, in percent."""
    return (american_to_prob(line["home"]) + american_to_prob(line["away"]) - 1) * 100


def consensus(ml: dict, weights: dict[str, float], method: str = "multiplicative",
              max_hold: float | None = None) -> dict | None:
    """Devig each weighted sharp book on its own, then take the weighted mean of the fair probs.

    Sharp books whose hold is above max_hold (percent) are left out: a wide market
    gives an unreliable fair price. Returns None when no sharp book is usable.
    """
    fn = devig.METHODS[method]
    used, total = [], 0.0
    for book, w in weights.items():
        line = ml.get(book)
        if not line or w <= 0:
            continue
        h = hold_pct(line)
        if max_hold is not None and h > max_hold:
            continue
        ph, pa = fn([american_to_prob(line["home"]), american_to_prob(line["away"])])
        used.append({"book": book, "weight": w, "hold_pct": h, "home": ph, "away": pa})
        total += w
    if not used:
        return None
    home = sum(u["weight"] * u["home"] for u in used) / total
    away = sum(u["weight"] * u["away"] for u in used) / total
    return {
        "home": home, "away": away,
        "hold_pct": sum(u["weight"] * u["hold_pct"] for u in used) / total,
        "sharps": [{"book": u["book"], "weight": u["weight"], "hold_pct": u["hold_pct"]} for u in used],
    }
