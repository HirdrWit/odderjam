"""Kalshi public market data adapter (game winner markets)."""
import httpx

BOOK = "Kalshi"


def parse(payload: dict, sport: str, fee: dict) -> list[dict]:
    return []


def fetch(sport: str, client: httpx.Client) -> dict:
    return {}
