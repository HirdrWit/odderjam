"""Team-name matching between exchanges and sportsbooks.

Exchanges abbreviate team names ("Los Angeles L", "Boston", "Lakers"); books use full names
("Los Angeles Lakers"). Two names match when every word of one name is the start of a word of
the other, in order. "Los Angeles C" therefore does not match "Los Angeles Lakers".
"""
import re
import unicodedata

# City abbreviations exchanges use, expanded before matching.
ALIASES = {
    "la": "los angeles", "ny": "new york", "nyc": "new york", "sf": "san francisco", "kc": "kansas city",
    "tb": "tampa bay", "gs": "golden state", "lv": "las vegas", "no": "new orleans", "okc": "oklahoma city",
    "st": "saint", "ne": "new england", "gb": "green bay",
}


def tokens(name: str) -> list[str]:
    """Lowercased words with punctuation removed and city abbreviations expanded."""
    folded = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()  # Montréal -> Montreal
    words = re.sub(r"[^a-z0-9 ]", " ", folded.lower()).split()
    return " ".join(ALIASES.get(w, w) for w in words).split()


def _covers(short: list[str], long: list[str]) -> bool:
    it = iter(long)
    return all(any(w.startswith(s) for w in it) for s in short)


def same_team(a: str, b: str) -> bool:
    """True when two names plausibly refer to the same team."""
    ta, tb = tokens(a), tokens(b)
    if not ta or not tb:
        return False
    return _covers(ta, tb) or _covers(tb, ta)
