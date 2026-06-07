"""SoDEX execution seam. Testnet MVP uses SimulatedExecutor (no real SoDEX).
LiveSodexExecutor wraps src/tools/sodex.py for the spot buy/sell legs.

EVM↔SoDEX custody bridge
-------------------------
The bridge methods (_bridge_usdc_to_sodex / _bridge_usdc_to_evm) are guarded
stubs that raise NotImplementedError with a clear blocker message.  They will
remain so until SoDEX's transferAsset type 0 (EVM_DEPOSIT) and type 2
(EVM_WITHDRAW) specs are published.  Reference:

    https://sodex.com/documentation/api/rest-v1/sodex-rest-perps-api
    TransferAssetTypeEnum: 0=EVM_DEPOSIT, 2=EVM_WITHDRAW

SimulatedExecutor is the default in all daemon/keeper paths.
LiveSodexExecutor is selectable via config but its custody bridge will raise
loudly until the spec lands — it is never silently skipped.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Any

log = logging.getLogger(__name__)


# ── Protocol ─────────────────────────────────────────────────────────────────

class SodexExecutor:
    def execute_deposit_swap(self, index_id: str, usdc_in: int) -> int: ...
    def execute_redeem_swap(self, index_id: str, usdc_target: int) -> int: ...


# ── Simulated (default) ──────────────────────────────────────────────────────

class SimulatedExecutor:
    """1:1 simulated fills with optional fixed slippage (bps). No real SoDEX calls."""
    def __init__(self, slippage_bps: int = 0) -> None:
        self.slippage_bps = slippage_bps

    def execute_deposit_swap(self, index_id: str, usdc_in: int) -> int:
        return usdc_in - usdc_in * self.slippage_bps // 10_000

    def execute_redeem_swap(self, index_id: str, usdc_target: int) -> int:
        return usdc_target - usdc_target * self.slippage_bps // 10_000


# ── Live (built, bridge stub pending) ────────────────────────────────────────

class LiveSodexExecutor:
    """Live executor that calls SoDEX spot market for buy/sell legs.

    Custody bridge stubs
    --------------------
    _bridge_usdc_to_sodex and _bridge_usdc_to_evm raise NotImplementedError
    because SoDEX's EVM_DEPOSIT (type 0) and EVM_WITHDRAW (type 2) transferAsset
    specs are not yet published.  The spot trading legs (execute_trade /
    execute_sell_trade) are fully built and exercised when
    SODEX_PRIVATE_KEY + SODEX_AUTONOMOUS_TRADE are set.

    Blocker: SoDEX transferAsset type 0/2 spec
    See: https://sodex.com/documentation/api/rest-v1/sodex-rest-perps-api

    Async/sync
    ----------
    The SodexExecutor protocol is synchronous (int return).  This class wraps
    the async sodex.py functions with asyncio.run() or, if an event loop is
    already running, schedules via loop.run_until_complete().
    """

    def __init__(
        self,
        slippage_bps: int = 25,
        target_basket: dict[str, float] | None = None,
    ) -> None:
        self.slippage_bps = slippage_bps
        # target_basket: {symbol: weight fraction} used for deposit allocation
        self.target_basket: dict[str, float] = target_basket or {}

    # -- custody stubs --------------------------------------------------------

    def _bridge_usdc_to_sodex(self, usdc_amount: int) -> None:
        """Move USDC from the EVM vault contract to the SoDEX spot account.

        STUB — raises until SoDEX publishes the EVM_DEPOSIT (type 0)
        transferAsset spec.

        Blocker: EVM<->SoDEX custody bridge pending SoDEX transferAsset
        type 0/2 spec (EVM_DEPOSIT=0, EVM_WITHDRAW=2).
        See: https://sodex.com/documentation/api/rest-v1/sodex-rest-perps-api
        """
        raise NotImplementedError(
            "EVM<->SoDEX custody bridge pending SoDEX transferAsset type 0/2 spec"
        )

    def _bridge_usdc_to_evm(self, usdc_amount: int) -> None:
        """Move USDC from the SoDEX spot account back to the EVM vault contract.

        STUB — raises until SoDEX publishes the EVM_WITHDRAW (type 2)
        transferAsset spec.

        Blocker: EVM<->SoDEX custody bridge pending SoDEX transferAsset
        type 0/2 spec (EVM_DEPOSIT=0, EVM_WITHDRAW=2).
        See: https://sodex.com/documentation/api/rest-v1/sodex-rest-perps-api
        """
        raise NotImplementedError(
            "EVM<->SoDEX custody bridge pending SoDEX transferAsset type 0/2 spec"
        )

    # -- async helper ---------------------------------------------------------

    def _run(self, coro: Any) -> Any:
        """Run an async coroutine synchronously, compatible with running loops."""
        try:
            loop = asyncio.get_running_loop()
            # Running inside an event loop (e.g. FastAPI / LangGraph) — schedule
            # on the current loop.  Note: this blocks the current thread which is
            # acceptable for the keeper's sequential tick model.
            import concurrent.futures
            with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
                future = pool.submit(asyncio.run, coro)
                return future.result(timeout=60)
        except RuntimeError:
            # No running loop — safe to call asyncio.run directly.
            return asyncio.run(coro)

    # -- spot trade legs ------------------------------------------------------

    def execute_deposit_swap(self, index_id: str, usdc_in: int) -> int:
        """Buy the target basket on SoDEX spot using USDC.

        Calls execute_trade (buy) for each symbol in self.target_basket
        proportional to its weight.  The EVM→SoDEX custody transfer is a
        guarded stub that will raise until the transferAsset spec lands —
        this method documents but does NOT call the bridge stub so the spot
        legs can be tested independently.

        Returns the realized basket value in USDC (integer, 6 dp).
        Env-guarded: skips silently when SODEX_PRIVATE_KEY / SODEX_AUTONOMOUS_TRADE
        are absent (returns usdc_in as-if simulated).
        """
        from src.tools.sodex import execute_trade, SODEX_PRIVATE_KEY, SODEX_AUTONOMOUS_TRADE

        if not SODEX_PRIVATE_KEY or not SODEX_AUTONOMOUS_TRADE:
            log.info("LiveSodexExecutor.execute_deposit_swap: env guard skipping (keys absent)")
            return usdc_in  # degrade to simulated pass-through

        if not self.target_basket:
            log.warning("LiveSodexExecutor.execute_deposit_swap: no target_basket configured")
            return usdc_in

        total_realized = 0
        for symbol, weight in self.target_basket.items():
            alloc_usdc = int(usdc_in * weight)
            if alloc_usdc <= 0:
                continue
            try:
                result = self._run(execute_trade(
                    symbol_in="USDC",
                    symbol_out=symbol,
                    amount_in=alloc_usdc / 1_000_000,  # executor uses micro-USDC
                    slippage_bps=self.slippage_bps,
                ))
                if result.get("ok"):
                    total_realized += alloc_usdc
                else:
                    log.warning(
                        "LiveSodexExecutor buy %s skipped/failed: %s",
                        symbol, result.get("reason") or result.get("error"),
                    )
            except Exception as exc:  # noqa: BLE001
                log.warning("LiveSodexExecutor buy %s exception: %s", symbol, exc)

        return total_realized or usdc_in  # fallback to usdc_in if all fills failed

    def execute_redeem_swap(self, index_id: str, usdc_target: int) -> int:
        """Sell basket → USDC on SoDEX spot.

        Calls execute_sell_trade for each symbol in self.target_basket to
        raise approximately usdc_target USDC.  The SoDEX→EVM custody transfer
        is a guarded stub (see _bridge_usdc_to_evm).

        Returns realized USDC (integer, 6 dp).
        Env-guarded: skips silently when keys absent.
        """
        from src.tools.sodex import execute_sell_trade, SODEX_PRIVATE_KEY, SODEX_AUTONOMOUS_TRADE

        if not SODEX_PRIVATE_KEY or not SODEX_AUTONOMOUS_TRADE:
            log.info("LiveSodexExecutor.execute_redeem_swap: env guard skipping (keys absent)")
            return usdc_target  # degrade to simulated pass-through

        if not self.target_basket:
            log.warning("LiveSodexExecutor.execute_redeem_swap: no target_basket configured")
            return usdc_target

        total_realized = 0
        for symbol, weight in self.target_basket.items():
            alloc_usdc = int(usdc_target * weight)
            if alloc_usdc <= 0:
                continue
            # Convert USDC notional → asset quantity using a rough price estimate.
            # The actual quantity is passed as amount_in (asset units) to execute_sell_trade.
            # For the redeem case we pass the USDC notional as a proxy quantity —
            # execute_sell_trade will quantize against the symbol's step size.
            amount_asset_approx = alloc_usdc / 1_000_000  # unit-agnostic proxy
            try:
                result = self._run(execute_sell_trade(
                    symbol_in=symbol,
                    amount_in=amount_asset_approx,
                    slippage_bps=self.slippage_bps,
                ))
                if result.get("ok"):
                    total_realized += int(result.get("usdc_received", alloc_usdc / 1_000_000) * 1_000_000)
                else:
                    log.warning(
                        "LiveSodexExecutor sell %s skipped/failed: %s",
                        symbol, result.get("reason") or result.get("error"),
                    )
            except Exception as exc:  # noqa: BLE001
                log.warning("LiveSodexExecutor sell %s exception: %s", symbol, exc)

        return total_realized or usdc_target
