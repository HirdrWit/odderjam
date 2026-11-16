"""Fee models for exchanges and prediction markets, and contract price -> American odds.

A contract pays $1 if it wins and costs its price P (0 < P < 1). Fee models, per platform:

- ``kalshi``: taker fee of ``rate * P * (1 - P)`` per contract, paid up front (Kalshi rounds the
  whole order's fee up to the cent; per contract that vanishes on all but tiny orders, so it is ignored).
- ``commission``: ``rate`` of net winnings, taken only when the bet wins.
- ``none``: no fee.

Defaults can be overridden per platform with ``EXCHANGE_FEES``, a JSON object such as
``{"Kalshi": {"model": "kalshi", "rate": 0.035}}``.
"""
import json
import math
import os

from .odds import american_to_decimal, decimal_to_american

DEFAULT_FEES: dict[str, dict] = {
    "Kalshi": {"model": "kalshi", "rate": 0.07},
    "Polymarket": {"model": "none"},
    "Novig": {"model": "none"},
    "ProphetX": {"model": "commission", "rate": 0.0},
}
NO_FEE = {"model": "none"}


def fee_for(platform: str) -> dict:
    """The fee model for a platform: EXCHANGE_FEES override, else the default, else no fee."""
    try:
        overrides = json.loads(os.environ.get("EXCHANGE_FEES") or "{}")
    except ValueError:
        overrides = {}
    if not isinstance(overrides, dict):
        overrides = {}
    fee = overrides.get(platform) or DEFAULT_FEES.get(platform) or NO_FEE
    return dict(fee)


def _floor_american(decimal: float) -> float | None:
    """American odds for a decimal price, floored so float noise or rounding never favours the bettor."""
    if decimal <= 1:
        return None
    return math.floor(round(decimal_to_american(decimal), 6))


def contract_to_american(cents: float, fee: dict) -> float | None:
    """American odds for buying a contract at ``cents`` (0-100) after the platform's fee.

    None when the price is not strictly between 0 and 100 or the fee leaves no profit.
    """
    if not 0 < cents < 100:
        return None
    p = cents / 100
    model, rate = fee.get("model", "none"), float(fee.get("rate", 0.0))
    if model == "kalshi":
        cost = p + rate * p * (1 - p)
        decimal = 1 / cost if cost < 1 else 1.0
    elif model == "commission":
        decimal = 1 + (1 - p) / p * (1 - rate)
    else:
        decimal = 1 / p
    return _floor_american(decimal)


def apply_commission(american: float, fee: dict) -> float | None:
    """American odds after a commission on winnings; unchanged for other fee models.

    None when the commission takes all the winnings.
    """
    if fee.get("model") != "commission" or not fee.get("rate"):
        return american
    decimal = 1 + (american_to_decimal(american) - 1) * (1 - float(fee["rate"]))
    return _floor_american(decimal)
