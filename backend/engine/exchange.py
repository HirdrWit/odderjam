"""Fee models for exchanges and prediction markets, and contract price -> American odds."""

DEFAULT_FEES: dict[str, dict] = {}


def fee_for(platform: str) -> dict:
    return {}


def contract_to_american(cents: float, fee: dict) -> float | None:
    return None


def apply_commission(american: float, fee: dict) -> float:
    return american
