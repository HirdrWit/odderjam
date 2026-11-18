"""odderjam-124 review follow-ups: stronger checks than the locked tests."""
import json
import re
from pathlib import Path

from backend import providers

SRC = Path(__file__).resolve().parent.parent / "frontend" / "src"


def test_only_visibility_js_uses_setinterval():
    offenders = [p.name for p in SRC.glob("*.js*") if ".test." not in p.name and p.name != "visibility.js"
                 and re.search(r"\bsetInterval\(", p.read_text())]
    assert offenders == []


def test_peek_live_snapshot_overlays_cached_live_events(monkeypatch, tmp_path):
    monkeypatch.setenv("ODDS_API_KEY", "k")
    monkeypatch.setattr(providers, "CACHE", tmp_path / "cache.json")
    monkeypatch.setattr(providers, "LIVE_CACHE", tmp_path / "live.json")
    monkeypatch.setattr(providers, "BUDGET_FILE", tmp_path / "budget.json")
    providers.reset_live()
    try:
        (tmp_path / "cache.json").write_text(json.dumps([{"id": "a", "v": "pre"}]))
        (tmp_path / "live.json").write_text(json.dumps([{"id": "a", "v": "live"}]))
        monkeypatch.setattr("backend.engine.live.is_live", lambda e, now: True)
        providers.set_live(enabled=True)
        assert providers.peek_live_snapshot() == [{"id": "a", "v": "live"}]
    finally:
        providers.reset_live()
