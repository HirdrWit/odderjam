"""Which sportsbooks the app shows. Only books legally operating in the US are listed.

Pinnacle is not available to US bettors; it is kept ONLY as the sharp reference price
for removing the vig, and is never shown as a place to bet.
"""
SHARP = "Pinnacle"

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


# Books that offer same-game parlays. Others reject two legs from one event.
SGP_BOOKS = {
    "DraftKings", "FanDuel", "BetMGM", "Caesars", "bet365", "BetRivers", "Fanatics",
    "ESPN BET", "theScore Bet", "Hard Rock Bet", "BetParx", "Bally Bet", "Borgata", "Unibet", "Fliff",
}
