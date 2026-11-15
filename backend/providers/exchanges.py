"""Merge exchange and prediction-market quotes into sportsbook events as extra books."""
import httpx


def merge_quotes(events: list[dict], quotes: list[dict], tolerance_hours: float = 12) -> list[dict]:
    return events


def enrich(events: list[dict], platforms: list[str] | None = None, client: httpx.Client | None = None) -> list[dict]:
    return events
