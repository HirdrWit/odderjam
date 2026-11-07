"""Which sportsbooks the app shows. Only books legally operating in the US are listed.

Pinnacle and BetOnline are not available to US bettors; they are kept ONLY as sharp
reference prices for removing the vig, and are never shown as a place to bet.
"""
import os

SHARP = "Pinnacle"
# The Odds API bookmaker key -> name, for books used only as sharp references.
REFERENCE_ONLY = {"pinnacle": SHARP, "betonlineag": "BetOnline.ag"}

# Sharp books that set the fair price, and their weight in the consensus.
# Override with SHARP_WEIGHTS="Pinnacle:1,Circa Sports:0.5" (or per request from the UI).
SHARP_BOOKS = ["Pinnacle", "Circa Sports", "Novig", "BetOnline.ag"]
DEFAULT_SHARP_WEIGHTS = "Pinnacle:1,Circa Sports:0.5,Novig:0.5,BetOnline.ag:0.25"


def sharp_weights_spec() -> str:
    """Return the SHARP_WEIGHTS spec string: the env var, or the default."""
    return os.environ.get("SHARP_WEIGHTS", DEFAULT_SHARP_WEIGHTS)


def max_sharp_hold() -> float:
    """Sharp books holding more than this (percent) are left out of the fair price."""
    return float(os.environ.get("MAX_SHARP_HOLD", "6"))


US_BOOKS = {
    "DraftKings", "FanDuel", "BetMGM", "Caesars", "bet365", "BetRivers", "Fanatics",
    "ESPN BET", "theScore Bet", "Hard Rock Bet", "BetParx", "Bally Bet", "Borgata",
    "Unibet", "Fliff", "Novig", "SuperBook", "Circa Sports",
}
_LOWER = {b.lower(): b for b in US_BOOKS}


def us_name(title: str) -> str | None:
    """Canonical US book name, or None if the book is not US-legal."""
    return _LOWER.get(title.strip().lower())


def us_only(ml: dict) -> dict:
    """Moneyline map filtered to US books (drops Pinnacle and all non-US books)."""
    return {b: o for b, o in ml.items() if b in US_BOOKS}
