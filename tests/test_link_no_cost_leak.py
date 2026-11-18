"""odderjam-123 review: an outcome with no link must stay None, not pick up the call-cost sum."""
from backend.providers import theoddsapi


def test_link_without_any_source_is_none_even_with_costs_recorded(monkeypatch):
    monkeypatch.setattr(theoddsapi, "_call_costs", [6.0])
    assert theoddsapi._link(None, None, None) is None
