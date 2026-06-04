"""KeeperConfig — env-driven configuration for the vault keeper."""
from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass
class KeeperConfig:
    rpc_url: str
    vault_address: str
    signer_key: str
    keeper_key: str
    chain_id: int
    usdc_address: str

    @classmethod
    def from_env(cls) -> "KeeperConfig":
        return cls(
            rpc_url=os.environ.get("VAULT_RPC_URL", "http://127.0.0.1:8545"),
            vault_address=os.environ["VAULT_ADDRESS"],
            signer_key=os.environ["VAULT_SIGNER_PRIVATE_KEY"],
            keeper_key=os.environ["VAULT_KEEPER_PRIVATE_KEY"],
            chain_id=int(os.environ["VAULT_CHAIN_ID"]),
            usdc_address=os.environ["VAULT_USDC_ADDRESS"],
        )
