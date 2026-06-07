#!/usr/bin/env python3
"""Always-on vault keeper + earnings indexer.

Wires the tested Keeper + VaultIndexer into the VaultDaemon loop:
  reconcile vaults → settle deposits/redeems → accrue mgmt fee → index earnings.

Required env (see contracts/DEPLOY-VAULT.md + agent-service/src/vault/README.md):
  VAULT_RPC_URL, VAULT_ADDRESS, VAULT_USDC_ADDRESS, VAULT_CHAIN_ID
  VAULT_SIGNER_PRIVATE_KEY, VAULT_KEEPER_PRIVATE_KEY
  SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
Optional:
  VAULT_DEPLOY_BLOCK   (default 0)  block the vault was deployed at — indexer start
  VAULT_CONFIRMATIONS  (default 2)  blocks behind head before ingesting
  VAULT_POLL_INTERVAL  (default 30) seconds between ticks

NOTE: uses SimulatedExecutor — shares mint against a simulated basket value, no
real SoDEX swap. Real execution (LiveSodexExecutor) + a custody re-architecture
are P2 / pre-mainnet. This runs the full loop end-to-end on testnet.

Usage:
  cd agent-service
  VAULT_ADDRESS=0x... SUPABASE_URL=... .venv/bin/python scripts/run_keeper.py
"""
from __future__ import annotations

import logging
import os
import sys

_AGENT_SERVICE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if _AGENT_SERVICE_DIR not in sys.path:
    sys.path.insert(0, _AGENT_SERVICE_DIR)

from src.vault.config import KeeperConfig
from src.vault.keeper import Keeper
from src.vault.nav import NavEngine
from src.vault.executor import SimulatedExecutor
from src.vault.indexer import VaultIndexer
from src.vault.store import SupabaseRestStore
from src.vault.daemon import VaultDaemon


def main() -> None:
    logging.basicConfig(
        level=os.environ.get("LOG_LEVEL", "INFO"),
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    log = logging.getLogger("run_keeper")

    cfg = KeeperConfig.from_env()

    supabase_url = os.environ.get("SUPABASE_URL")
    service_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not supabase_url or not service_key:
        sys.exit("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for the indexer.")

    nav_engine = NavEngine()
    executor = SimulatedExecutor()
    keeper = Keeper(cfg, executor, nav_engine)

    if not keeper.w3.is_connected():
        sys.exit(f"Cannot connect to RPC: {cfg.rpc_url}")

    store = SupabaseRestStore(supabase_url, service_key)
    indexer = VaultIndexer(keeper.w3, keeper.vault, store)

    daemon = VaultDaemon(
        keeper,
        indexer,
        store,
        deploy_block=int(os.environ.get("VAULT_DEPLOY_BLOCK", "0")),
        confirmations=int(os.environ.get("VAULT_CONFIRMATIONS", "2")),
        poll_interval=int(os.environ.get("VAULT_POLL_INTERVAL", "30")),
    )

    log.info("keeper=%s vault=%s chain=%d", keeper.keeper_acct.address, cfg.vault_address, cfg.chain_id)
    daemon.run()


if __name__ == "__main__":
    main()
