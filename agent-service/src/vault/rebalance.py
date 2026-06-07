"""Pure rebalance diff engine + keeper orchestration helper.

diff_basket
    Pure function — no I/O. Given current holdings (USDC values), target
    weights (fractions summing to ~1), and total portfolio value, returns the
    minimal trade list to converge to target.  Sells come first so freed USDC
    funds subsequent buys.  Drifts below `threshold_bps` are dropped (dead-band
    to prevent micro-churn).

rebalance_once
    Orchestration helper called by keeper.rebalance_once (and directly tested
    with fakes).  Reads the target basket from a pb_proposals row, computes
    diff_basket, executes trades via the executor (Simulated by default), then
    calls keeper._sign_nav + vault.updateNav as a NAV checkpoint.

All autonomous paths are env-gated — this module never triggers live network
calls unless VAULT_REBALANCE_ENABLED is truthy (enforced in daemon.tick).
"""
from __future__ import annotations

import logging
from typing import Any

log = logging.getLogger(__name__)


# ── Pure diff engine ──────────────────────────────────────────────────────────

def diff_basket(
    current_value: dict[str, float],
    target_weights: dict[str, float],
    total_value_usdc: float,
    threshold_bps: int = 50,
) -> list[dict]:
    """Compute the trade list required to rebalance from current to target.

    Parameters
    ----------
    current_value
        {symbol: current_usdc_value} — the live holdings in USDC terms.
    target_weights
        {symbol: weight} — desired fractional weights, must sum to ≤ 1.0.
        Symbols absent here are treated as 0-weight (full sell).
    total_value_usdc
        Total portfolio value in USDC.  Used to convert weights → USDC targets.
    threshold_bps
        Minimum drift (in basis points of total_value_usdc) below which a trade
        is skipped.  50 bps = 0.5% = $50 on a $10k portfolio.

    Returns
    -------
    List of trade dicts: [{'symbol', 'side': 'buy'|'sell', 'usdc_amount'}],
    SELLS FIRST (so freed USDC is available for buys).  Empty list when
    everything is within threshold.

    Pure — no I/O, no side effects.
    """
    if total_value_usdc <= 0:
        return []

    threshold_usdc = total_value_usdc * threshold_bps / 10_000

    # Build the full symbol universe (union of current + target).
    all_symbols = set(current_value) | set(target_weights)

    sells: list[dict] = []
    buys: list[dict] = []

    for symbol in all_symbols:
        current = current_value.get(symbol, 0.0)
        target = total_value_usdc * target_weights.get(symbol, 0.0)
        delta = target - current  # positive → need to buy; negative → need to sell

        if abs(delta) < threshold_usdc:
            continue  # within dead-band — skip micro-trade

        if delta < 0:
            # Over-weight: sell the excess.
            sells.append({"symbol": symbol, "side": "sell", "usdc_amount": abs(delta)})
        else:
            # Under-weight: buy the shortfall.
            buys.append({"symbol": symbol, "side": "buy", "usdc_amount": delta})

    # Sells first — freed USDC funds subsequent buys.
    return sells + buys


# ── Cancel-before-pull helper ─────────────────────────────────────────────────

def should_cancel_before_pull(deposit_id: int, pending_cancel_ids: set) -> bool:
    """Return True when this deposit has a pending cancel request.

    Pure — no I/O, no side effects.  The keeper calls this before pullForDeposit
    to decide whether to honor a subscriber's cancellation request instead.

    Parameters
    ----------
    deposit_id
        The on-chain deposit request id.
    pending_cancel_ids
        Set of deposit ids that have a pending cancel request (status='pending')
        in pb_cancel_requests.  Supplied by the caller from the store.

    Returns
    -------
    True when deposit_id is in pending_cancel_ids, False otherwise.
    """
    return deposit_id in pending_cancel_ids


# ── Keeper rebalance orchestration ────────────────────────────────────────────

def rebalance_once(
    index_id: str,
    store: Any,
    keeper: Any,
    executor: Any,
    current_basket: dict[str, float],
    total_value_usdc: float,
    threshold_bps: int = 50,
) -> tuple[list[dict], bool]:
    """Execute one rebalance cycle for a single index.

    Steps
    -----
    1. Read target weights from pb_proposals.constituents (via store).
    2. Compute diff_basket(current_basket, target_weights, total_value_usdc).
    3. Execute each sell via executor.execute_redeem_swap and each buy via
       executor.execute_deposit_swap (amount in USDC integer micro-units).
    4. Sign a new NAV attestation and call vault.functions.updateNav.

    Parameters
    ----------
    index_id
        Hex index identifier (e.g. "0xabc...").
    store
        Object with .proposal_for_index(index_id) -> dict | None.
    keeper
        Keeper instance exposing ._sign_nav(idx_bytes, nav) and ._send(fn).
    executor
        SodexExecutor with .execute_deposit_swap / .execute_redeem_swap.
    current_basket
        {symbol: usdc_value} — current simulated holdings.
    total_value_usdc
        Total USDC value of the basket (sum of current_basket values).
    threshold_bps
        Passed through to diff_basket dead-band.

    Returns
    -------
    (trades, nav_called) — the trade list and whether updateNav was invoked.
    """
    # 1. Fetch target weights from the store.
    proposal = store.proposal_for_index(index_id)
    if proposal is None:
        log.warning("rebalance_once: no proposal for index %s — skipping", index_id)
        return [], False

    constituents = proposal.get("constituents") or []
    if not constituents:
        log.warning("rebalance_once: proposal for %s has no constituents — skipping", index_id)
        return [], False

    target_weights: dict[str, float] = {
        c["symbol"]: float(c["weight"])
        for c in constituents
        if c.get("symbol") and c.get("weight") is not None
    }

    # 2. Compute trade list.
    trades = diff_basket(current_basket, target_weights, total_value_usdc, threshold_bps)

    # 3. Execute trades via the executor.
    usdc_int = int(total_value_usdc)  # convert to micro-USDC integer for executor API
    for trade in trades:
        amount_int = max(1, int(trade["usdc_amount"]))
        try:
            if trade["side"] == "sell":
                executor.execute_redeem_swap(index_id, amount_int)
            else:
                executor.execute_deposit_swap(index_id, amount_int)
        except Exception as exc:  # noqa: BLE001
            log.warning("rebalance_once: trade %s failed: %s", trade, exc)

    # 4. NAV checkpoint — sign and update on-chain regardless of trade count.
    try:
        from web3 import Web3  # local import to avoid hard dep in pure tests
        idx_bytes = Web3.to_bytes(hexstr=index_id)
        nav = int(total_value_usdc)  # simplified: 1 USDC = 1 nav unit
        signed_at, sig = keeper._sign_nav(idx_bytes, nav)
        fn = keeper.vault.functions.updateNav(idx_bytes, nav, signed_at, sig)
        keeper._send(fn)
        nav_called = True
    except Exception as exc:  # noqa: BLE001
        log.warning("rebalance_once: updateNav failed: %s", exc)
        nav_called = False

    return trades, nav_called
