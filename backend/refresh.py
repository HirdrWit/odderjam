"""Auto-refresh interval for pre-game odds (odderjam-125).

The choice is saved in the settings table (key `refresh_seconds`, 0 = Off). It sets the pre-game cache
lifetime that get_snapshot() uses and the pace of the frontend timer. Nothing saved: ODDS_CACHE_MINUTES.
Off (odderjam-141) means no automatic fetch at all: the cache is served however old it is. Only the
Refresh button or a missing cache file fetches.
"""
import os

from . import db

KEY = "refresh_seconds"
CHOICES = [0, 1, 5, 10, 30, 60, 300, 900, 1800, 3600, 7200]


def default_seconds() -> int:
    """The lifetime used when nothing is saved: ODDS_CACHE_MINUTES (120 by default)."""
    return int(float(os.environ.get("ODDS_CACHE_MINUTES", "120")) * 60)


def get_seconds() -> int:
    with db.conn() as c:
        row = c.execute("SELECT value FROM settings WHERE key=?", (KEY,)).fetchone()
    return int(row["value"]) if row else default_seconds()


def set_seconds(seconds: int) -> int:
    if seconds not in CHOICES:
        raise ValueError(f"interval must be one of {CHOICES}")
    with db.conn() as c:
        c.execute("INSERT INTO settings(key,value) VALUES(?,?) "
                  "ON CONFLICT(key) DO UPDATE SET value=excluded.value", (KEY, seconds))
    return seconds


def cache_lifetime() -> float | None:
    """Seconds a pre-game snapshot stays fresh, or None for Off: the cache never goes stale by age."""
    seconds = get_seconds()
    return float(seconds) if seconds else None


def options(cost: float, remaining: float | None) -> list[dict]:
    """Each choice with its credits per hour (cost x 3600 / seconds) and the hours the credits left last."""
    out = []
    for s in CHOICES:
        per_hour = cost * 3600 / s if s else 0
        left = remaining / per_hour if s and remaining is not None and per_hour > 0 else None
        out.append({"seconds": s, "credits_per_hour": per_hour, "hours_left": left})
    return out
