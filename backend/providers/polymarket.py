"""Polymarket Gamma API adapter (game moneyline markets)."""
import httpx

BOOK = "Polymarket"


def parse(payload: list, sport: str, fee: dict) -> list[dict]:
    return []


def fetch(sport: str, client: httpx.Client) -> list:
    return []
