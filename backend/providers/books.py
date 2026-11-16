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
    # Exchanges and prediction markets (no limits on winners). Prices are after each platform's fee.
    "Kalshi", "Polymarket", "ProphetX",
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
    "Kalshi": "https://kalshi.com",
    "Polymarket": "https://polymarket.com",
    "ProphetX": "https://www.prophetx.co",
}


def bet_link(book: str, outcome: dict | None = None) -> str | None:
    """Best link for betting an outcome at a book: the deep link if known, else the book's homepage."""
    link = ((outcome or {}).get("links") or {}).get(book)
    return link or BOOK_URLS.get(book)


# Books that offer same-game parlays. Others reject two legs from one event.
SGP_BOOKS = {
    "DraftKings", "FanDuel", "BetMGM", "Caesars", "bet365", "BetRivers", "Fanatics",
    "ESPN BET", "theScore Bet", "Hard Rock Bet", "BetParx", "Bally Bet", "Borgata", "Unibet", "Fliff",
}
