import pytest

from backend import db


@pytest.fixture(autouse=True)
def tmp_db(tmp_path, monkeypatch):
    """Every test gets its own SQLite file, so tests never touch .odderjam.db."""
    monkeypatch.setattr(db, "DB", tmp_path / "t.db")
