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


# Fallback when the odds feed gives no deep link: the book's sportsbook homepage.
BOOK_URLS = {
    "DraftKings": "https://sportsbook.draftkings.com",
    "FanDuel": "https://sportsbook.fanduel.com",
    "BetMGM": "https://sports.betmgm.com",
    "Caesars": "https://sportsbook.caesars.com",
    "bet365": "https://www.bet365.com",
    "BetRivers": "https://www.betrivers.com",
    "Fanatics": "https://sportsbook.fanatics.com",
    "ESPN BET": "https://espnbet.com",
    "theScore Bet": "https://thescore.bet",
    "Hard Rock Bet": "https://www.hardrock.bet",
    "BetParx": "https://www.betparx.com",
    "Bally Bet": "https://www.ballybet.com",
    "Borgata": "https://sports.borgataonline.com",
    "Unibet": "https://www.unibet.com",
    "Fliff": "https://www.getfliff.com",
    "Novig": "https://www.novig.us",
    "SuperBook": "https://www.superbook.com",
    "Circa Sports": "https://www.circasports.com",
}


def bet_link(book: str, outcome: dict | None = None) -> str | None:
    """Best link for betting an outcome at a book: the deep link if known, else the book's homepage."""
    link = ((outcome or {}).get("links") or {}).get(book)
    return link or BOOK_URLS.get(book)
