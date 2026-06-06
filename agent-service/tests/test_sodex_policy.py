from src.tools.sodex_policy import classify_trade_result, MAX_TRADE_ATTEMPTS

def c(tx): return classify_trade_result(tx)

def test_success_done():
    assert c({"ok": True, "order_id": 12345}) == "done"

def test_silent_reject_retry():
    assert c({"ok": True, "order_id": None}) == "retry"

def test_cancel_only_routes_to_perps():
    assert c({"ok": False, "skipped": True, "reason": "pair vBTC_vUSDC status=CANCEL_ONLY"}) == "route_to_perps"
    assert c({"ok": False, "skipped": True, "reason": "pair vBTC_vUSDC status=HALT"}) == "route_to_perps"

def test_no_pair_gives_up():
    assert c({"ok": False, "skipped": True, "reason": "no SoDEX spot pair for XYZ"}) == "give_up"

def test_below_min_gives_up():
    assert c({"ok": False, "skipped": True, "reason": "notional 2.30 < min 5.0 on vBTC_vUSDC"}) == "give_up"

def test_no_price_retry():
    assert c({"ok": False, "skipped": True, "reason": "no last price for vBTC_vUSDC"}) == "retry"

def test_rate_limit_retry():
    assert c({"ok": False, "skipped": False, "error": "SoDEX 429: rate limited"}) == "retry"

def test_5xx_retry():
    assert c({"ok": False, "skipped": False, "error": "SoDEX 500: internal"}) == "retry"

def test_4xxx_gives_up():
    assert c({"ok": False, "skipped": False, "error": "SoDEX action error: {code: 4001}"}) == "give_up"

def test_max_attempts_const():
    assert MAX_TRADE_ATTEMPTS >= 2
