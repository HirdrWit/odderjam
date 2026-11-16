"""odderjam-74: the +EV table shows a reason when a positive edge rounds to a $0 stake."""
from pathlib import Path

SRC = Path(__file__).resolve().parent.parent / "frontend" / "src"


def test_ev_table_uses_zero_stake_reason():
    jsx = (SRC / "main.jsx").read_text()
    assert "zeroStakeReason" in jsx
