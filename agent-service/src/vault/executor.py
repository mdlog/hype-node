"""SoDEX execution seam. Testnet MVP uses SimulatedExecutor (no real SoDEX).
The live executor (wrapping src/tools/sodex.py) is deferred until the SoDEX
bridge legs + team info land — see spec section 13."""
from typing import Protocol


class SodexExecutor(Protocol):
    def execute_deposit_swap(self, index_id: str, usdc_in: int) -> int: ...
    def execute_redeem_swap(self, index_id: str, usdc_target: int) -> int: ...


class SimulatedExecutor:
    """1:1 simulated fills with optional fixed slippage (bps). No real SoDEX calls."""
    def __init__(self, slippage_bps: int = 0) -> None:
        self.slippage_bps = slippage_bps

    def execute_deposit_swap(self, index_id: str, usdc_in: int) -> int:
        return usdc_in - usdc_in * self.slippage_bps // 10_000

    def execute_redeem_swap(self, index_id: str, usdc_target: int) -> int:
        return usdc_target - usdc_target * self.slippage_bps // 10_000


class LiveSodexExecutor:
    """DEFERRED — wraps src/tools/sodex.py once the EVM_DEPOSIT/EVM_WITHDRAW bridge
    legs + SoDEX-team info land. Raises so it cannot be used by accident."""
    def execute_deposit_swap(self, index_id: str, usdc_in: int) -> int:
        raise NotImplementedError("LiveSodexExecutor: pending SoDEX bridge legs (1b deferred)")

    def execute_redeem_swap(self, index_id: str, usdc_target: int) -> int:
        raise NotImplementedError("LiveSodexExecutor: pending SoDEX bridge legs (1b deferred)")
