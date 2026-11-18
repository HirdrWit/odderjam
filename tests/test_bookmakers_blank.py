from backend.providers import theoddsapi


def test_blank_override_falls_back_to_defaults(monkeypatch):
    monkeypatch.setenv("ODDS_BOOKMAKERS", " , ")
    assert theoddsapi.bookmakers() == theoddsapi.DEFAULT_BOOKMAKERS
