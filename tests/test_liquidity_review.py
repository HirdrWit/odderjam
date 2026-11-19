from backend.providers import polymarket


def test_polymarket_bad_size_is_null_not_a_dropped_quote():
    out = polymarket._liquidity({"bestAsk": 0.5, "bestBid": 0.4, "bestAskSize": "n/a", "bestBidSize": "100"}, [0.5, 0.6])
    assert out == [None, 60.0]
