"""SQLite connection shared by the bet tracker and the odds history."""
import sqlite3
from pathlib import Path

DB = Path(__file__).resolve().parent.parent / ".odderjam.db"

# Columns added after the first release; existing databases get them via ALTER TABLE.
_BET_COLUMNS = {
    "event_id": "TEXT", "outcome": "TEXT", "point": "REAL", "event_start": "TEXT",
    "closing_sharp_odds": "REAL",
}


def conn() -> sqlite3.Connection:
    """Open the connection, create missing tables and indexes, and add any missing bets columns."""
    c = sqlite3.connect(DB)
    c.row_factory = sqlite3.Row
    c.execute("""CREATE TABLE IF NOT EXISTS bets (
        id INTEGER PRIMARY KEY AUTOINCREMENT, placed_at TEXT NOT NULL, event TEXT, sport TEXT,
        market TEXT DEFAULT 'moneyline', pick TEXT NOT NULL, book TEXT, odds REAL NOT NULL,
        stake REAL NOT NULL, status TEXT NOT NULL DEFAULT 'pending', closing_odds REAL,
        ev_pct REAL, notes TEXT)""")
    have = {r["name"] for r in c.execute("PRAGMA table_info(bets)")}
    for name, typ in _BET_COLUMNS.items():
        if name not in have:
            c.execute(f"ALTER TABLE bets ADD COLUMN {name} {typ}")
    c.execute("CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value REAL)")
    c.execute("""CREATE TABLE IF NOT EXISTS odds_history (
        event_id TEXT NOT NULL, market TEXT NOT NULL, outcome TEXT NOT NULL, point REAL,
        book TEXT NOT NULL, price REAL NOT NULL, fetched_at TEXT NOT NULL)""")
    c.execute("CREATE INDEX IF NOT EXISTS odds_history_event ON odds_history (event_id, market, fetched_at)")
    c.execute("CREATE INDEX IF NOT EXISTS odds_history_age ON odds_history (fetched_at)")
    return c
