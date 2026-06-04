from src.vault.nav import NavEngine, WAD, INITIAL_NAV

def test_first_deposit_uses_initial_nav():
    eng = NavEngine()
    nav, bval = eng.quote_deposit("idx", usdc_in=100_000_000, total_shares_onchain=0)
    assert nav == INITIAL_NAV            # 1e6
    assert bval == 100_000_000           # 1:1 sim
    shares = bval * WAD // nav
    eng.on_deposit_settled("idx", usdc_in=100_000_000, minted_shares=shares)
    assert eng.basket_usd("idx") == 100_000_000

def test_subsequent_deposit_prices_against_basket():
    eng = NavEngine()
    eng.quote_deposit("idx", 100_000_000, 0); eng.on_deposit_settled("idx", 100_000_000, 100*10**18)
    nav, bval = eng.quote_deposit("idx", 50_000_000, total_shares_onchain=100*10**18)
    assert nav == 1_000_000
    assert bval == 50_000_000

def test_mark_changes_nav():
    eng = NavEngine()
    eng.quote_deposit("idx", 100_000_000, 0); eng.on_deposit_settled("idx", 100_000_000, 100*10**18)
    eng.mark("idx", 2.0)
    nav, _ = eng.quote_deposit("idx", 1_000_000, total_shares_onchain=100*10**18)
    assert nav == 2_000_000

def test_redeem_pro_rata():
    eng = NavEngine()
    eng.quote_deposit("idx", 100_000_000, 0); eng.on_deposit_settled("idx", 100_000_000, 100*10**18)
    nav, usdc_out = eng.quote_redeem("idx", shares=50*10**18, total_shares_onchain=100*10**18 + 1000)
    assert 49_900_000 <= usdc_out <= 50_000_000
    eng.on_redeem_settled("idx", usdc_out)
    assert eng.basket_usd("idx") == 100_000_000 - usdc_out
