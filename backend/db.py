"""SQLite connection shared by the bet tracker, the odds history and the Sharp Money trade store."""
import sqlite3
from pathlib import Path

DB = Path(__file__).resolve().parent.parent / ".odderjam.db"

# Columns added after the first release; existing databases get them via ALTER TABLE.
_BET_COLUMNS = {
    "strategy": "TEXT", "event_id": "TEXT", "selection": "TEXT", "point": "REAL", "settled_at": "TEXT",
    "event_start": "TEXT", "last_settle_check": "TEXT", "closing_sharp_odds": "REAL",
    "is_bonus": "INTEGER NOT NULL DEFAULT 0",
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
    # Sharp Money: public exchange trades, once per (book, trade_id). traded_at is epoch seconds.
    c.execute("""CREATE TABLE IF NOT EXISTS exchange_trades (
        book TEXT NOT NULL, trade_id TEXT NOT NULL, market TEXT NOT NULL, event_id TEXT NOT NULL,
        outcome TEXT NOT NULL, cents REAL NOT NULL, size REAL NOT NULL, traded_at REAL NOT NULL,
        UNIQUE (book, trade_id))""")
    c.execute("CREATE INDEX IF NOT EXISTS exchange_trades_outcome "
              "ON exchange_trades (book, event_id, outcome, traded_at)")
    c.execute("CREATE INDEX IF NOT EXISTS exchange_trades_market ON exchange_trades (book, market, traded_at)")
    c.execute("CREATE INDEX IF NOT EXISTS exchange_trades_age ON exchange_trades (traded_at)")
    c.execute("CREATE TABLE IF NOT EXISTS hidden_rows (key TEXT PRIMARY KEY, expires_at REAL NOT NULL)")
    return c
