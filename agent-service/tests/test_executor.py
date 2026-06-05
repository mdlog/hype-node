from src.vault.executor import SimulatedExecutor


def test_simulated_executor_one_to_one():
    ex = SimulatedExecutor()
    assert ex.execute_deposit_swap("idx", 1_000_000) == 1_000_000
    assert ex.execute_redeem_swap("idx", 1_000_000) == 1_000_000


def test_simulated_executor_slippage():
    ex = SimulatedExecutor(slippage_bps=100)  # 1%
    assert ex.execute_deposit_swap("idx", 1_000_000) == 990_000
