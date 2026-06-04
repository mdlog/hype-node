"""Simulated per-index NAV ledger for the vault keeper (testnet MVP).

navPerShare = USDC(6dp) value of WAD shares. Tracks an off-chain basket USDC
value per index (the simulated custody) and prices against on-chain totalShares.
Swap this out for real SoDEX mark-to-market when the live executor lands.
"""
WAD = 10**18
INITIAL_NAV = 1_000_000        # opening navPerShare, matches the contract test convention

class NavEngine:
    def __init__(self) -> None:
        self._basket: dict[str, int] = {}

    def basket_usd(self, index_id: str) -> int:
        return self._basket.get(index_id, 0)

    def quote_deposit(self, index_id: str, usdc_in: int, total_shares_onchain: int) -> tuple[int, int]:
        basket = self._basket.get(index_id, 0)
        if total_shares_onchain == 0 or basket == 0:
            nav = INITIAL_NAV
        else:
            nav = basket * WAD // total_shares_onchain
        return nav, usdc_in

    def on_deposit_settled(self, index_id: str, usdc_in: int, minted_shares: int) -> None:
        self._basket[index_id] = self._basket.get(index_id, 0) + usdc_in

    def quote_redeem(self, index_id: str, shares: int, total_shares_onchain: int) -> tuple[int, int]:
        basket = self._basket.get(index_id, 0)
        if total_shares_onchain == 0:
            return INITIAL_NAV, 0
        nav = basket * WAD // total_shares_onchain
        usdc_out = basket * shares // total_shares_onchain
        return nav, usdc_out

    def on_redeem_settled(self, index_id: str, usdc_out: int) -> None:
        self._basket[index_id] = max(0, self._basket.get(index_id, 0) - usdc_out)

    def mark(self, index_id: str, multiplier: float) -> None:
        self._basket[index_id] = int(self._basket.get(index_id, 0) * multiplier)
