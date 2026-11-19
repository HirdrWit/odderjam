"""Fair prices from a weighted consensus of sharp books."""
from . import devig
from .odds import american_to_prob


CLASSES = ("main", "props")


def _parse_flat(spec: str) -> dict[str, float]:
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


def _is_per_class(spec: str) -> bool:
    head, _, rest = spec.strip().partition(":")
    flat_name_has_colon = any(part.rpartition(":")[0].count(":") for part in spec.split(","))
    return ";" in spec or flat_name_has_colon or (head.strip().lower() in CLASSES and ":" in rest)


def _parse_strict(body: str, cls: str) -> dict[str, float]:
    out = {}
    for part in body.split(","):
        name, _, w = part.rpartition(":")
        try:
            weight = float(w)
        except ValueError:
            raise ValueError(f"bad weight {part.strip()!r} in the {cls} weights") from None
        if not name.strip() or not weight >= 0 or weight == float("inf"):
            raise ValueError(f"bad weight {part.strip()!r} in the {cls} weights")
        if weight > 0:
            out[name.strip()] = weight
    return out


def parse_weights(spec: str) -> dict:
    """Parse a SHARP_WEIGHTS spec.

    Flat 'Pinnacle:1,Circa Sports:0.5' -> {'Pinnacle': 1.0, ...} (bad or <=0 entries dropped; applies to every class).
    Per-class 'main:Pinnacle:1;props:Pinnacle:0.5' -> {'main': {...}, 'props': {...}}.
    A bad per-class spec (unknown or repeated class, bad weight) raises ValueError.
    """
    if not _is_per_class(spec):
        return _parse_flat(spec)
    out: dict[str, dict[str, float]] = {}
    for seg in spec.split(";"):
        if not seg.strip():
            continue
        cls, _, body = seg.strip().partition(":")
        cls = cls.strip().lower()
        if cls not in CLASSES:
            raise ValueError(f"unknown market class {cls!r}; use main or props")
        if cls in out:
            raise ValueError(f"market class {cls!r} given twice")
        if not body.strip():
            raise ValueError(f"no weights for the {cls} class")
        out[cls] = _parse_strict(body, cls)
    return out


def class_weights(weights: dict) -> dict[str, dict[str, float]]:
    """Normalise parse_weights output to {'main': {...}, 'props': {...}}; a flat dict applies to both."""
    if weights and all(k in CLASSES and isinstance(v, dict) for k, v in weights.items()):
        return {c: dict(weights.get(c, {})) for c in CLASSES}
    return {c: dict(weights) for c in CLASSES}


def format_weights(weights: dict) -> str:
    """Inverse of parse_weights for a per-class dict."""
    cw = class_weights(weights)
    return ";".join(f"{c}:" + ",".join(f"{b}:{w:g}" for b, w in cw[c].items()) for c in CLASSES)


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
        "sharp_probs": {u["book"]: u["probs"] for u in used},  # each sharp's own fair probs, per outcome
    }


def group_consensus(outcomes: list[dict], weights: dict[str, float], method: str = "multiplicative",
                    max_hold: float | None = None, all_books: bool = False) -> dict | None:
    """consensus_probs for one line group; only books pricing every outcome of the line are used.

    With all_books every book pricing every outcome counts, each with weight 1 (the market average).
    """
    if not outcomes:
        return None
    if all_books:
        weights = {b: 1.0 for b in set.intersection(*(set(o["prices"]) for o in outcomes))}
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


def worst_consensus(outcomes: list[dict], weights: dict[str, float], max_hold: float | None = None,
                    all_books: bool = False) -> dict | None:
    """Lowest fair prob per outcome (lowest EV for the bettor) over every usable sharp, each devigged alone with worst_case.

    The weighted mean is not used: one sharp pricing a side lower is enough. Returns None when no sharp
    is usable, else {"probs": [...], "books": [the sharp that set each outcome's prob]}.
    """
    r = group_consensus(outcomes, weights, "worst_case", max_hold, all_books)
    if r is None:
        return None
    per_book = r["sharp_probs"]
    n = len(outcomes)
    books = [min(per_book, key=lambda b: per_book[b][i]) for i in range(n)]
    return {"probs": [per_book[books[i]][i] for i in range(n)], "books": books}
