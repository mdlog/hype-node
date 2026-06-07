"""Indexer persistence seam. InMemoryStore for tests; SupabaseRestStore writes to
PostgREST with the service-role key (pb_earnings + pb_subscriptions are RLS service-role-only).

Idempotency: earnings are deduped on (tx_hash, event_type, proposal_id) so the
indexer can safely re-scan overlapping block ranges without double-counting. The
daemon also persists a block checkpoint so it only ingests new blocks each tick."""
from typing import Protocol, Optional
import httpx


def _earning_key(row: dict) -> tuple:
    return (
        (row.get("tx_hash") or "").lower(),
        row.get("event_type"),
        row.get("proposal_id"),
    )


class IndexerStore(Protocol):
    def proposal_for_index(self, index_id: str) -> Optional[dict]: ...
    def insert_earning(self, row: dict) -> None: ...
    def upsert_subscription(self, row: dict) -> None: ...
    def subscriptions_for_index(self, index_id: str) -> list[dict]: ...
    def published_indices(self) -> list[dict]: ...
    def get_checkpoint(self, key: str) -> Optional[int]: ...
    def set_checkpoint(self, key: str, block: int) -> None: ...


class InMemoryStore:
    def __init__(self) -> None:
        self.proposals: dict[str, dict] = {}
        self.earnings: list[dict] = []
        self._earning_keys: set[tuple] = set()
        self.subscriptions: dict[tuple, dict] = {}
        self.checkpoints: dict[str, int] = {}

    def add_proposal(self, p: dict) -> None:
        self.proposals[p["on_chain_index_id"].lower()] = p

    def proposal_for_index(self, index_id: str) -> Optional[dict]:
        return self.proposals.get(index_id.lower())

    def insert_earning(self, row: dict) -> None:
        # Dedupe on (tx_hash, event_type, proposal_id) — mirrors the partial
        # unique index in supabase migration 0005 so re-indexing is a no-op.
        key = _earning_key(row)
        if key[0] and key in self._earning_keys:
            return
        if key[0]:
            self._earning_keys.add(key)
        self.earnings.append(row)

    def upsert_subscription(self, row: dict) -> None:
        self.subscriptions[(row["index_id"].lower(), row["subscriber_address"].lower())] = row

    def subscriptions_for_index(self, index_id: str) -> list[dict]:
        return [v for k, v in self.subscriptions.items() if k[0] == index_id.lower()]

    def published_indices(self) -> list[dict]:
        return [
            p for p in self.proposals.values()
            if p.get("on_chain_index_id") and p.get("status") in ("published", "live")
        ]

    def get_checkpoint(self, key: str) -> Optional[int]:
        return self.checkpoints.get(key)

    def set_checkpoint(self, key: str, block: int) -> None:
        self.checkpoints[key] = block


class SupabaseRestStore:
    """PostgREST writes. Requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY."""
    def __init__(self, base_url: str, service_key: str) -> None:
        self._base = base_url.rstrip("/") + "/rest/v1"
        self._h = {"apikey": service_key, "Authorization": f"Bearer {service_key}",
                   "Content-Type": "application/json"}

    def proposal_for_index(self, index_id: str) -> Optional[dict]:
        r = httpx.get(f"{self._base}/pb_proposals",
                      params={"on_chain_index_id": f"eq.{index_id}",
                              "select": "id,creator_address,on_chain_index_id", "limit": 1},
                      headers=self._h, timeout=15)
        r.raise_for_status()
        rows = r.json()
        return rows[0] if rows else None

    def insert_earning(self, row: dict) -> None:
        # Idempotent insert: on a (tx_hash,event_type,proposal_id) conflict the
        # row is ignored, so re-scanning blocks never double-counts earnings.
        r = httpx.post(
            f"{self._base}/pb_earnings",
            params={"on_conflict": "tx_hash,event_type,proposal_id"},
            json=row,
            headers={**self._h, "Prefer": "resolution=ignore-duplicates,return=minimal"},
            timeout=15,
        )
        r.raise_for_status()

    def upsert_subscription(self, row: dict) -> None:
        r = httpx.post(f"{self._base}/pb_subscriptions", json=row,
                       headers={**self._h, "Prefer": "resolution=merge-duplicates"}, timeout=15)
        r.raise_for_status()

    def published_indices(self) -> list[dict]:
        r = httpx.get(f"{self._base}/pb_proposals",
                      params={"on_chain_index_id": "not.is.null",
                              "status": "in.(published,live)",
                              "select": "id,creator_address,on_chain_index_id,status"},
                      headers=self._h, timeout=15)
        r.raise_for_status()
        return r.json()

    def get_checkpoint(self, key: str) -> Optional[int]:
        r = httpx.get(f"{self._base}/sys_indexer_state",
                      params={"key": f"eq.{key}", "select": "last_block", "limit": 1},
                      headers=self._h, timeout=15)
        r.raise_for_status()
        rows = r.json()
        return int(rows[0]["last_block"]) if rows else None

    def set_checkpoint(self, key: str, block: int) -> None:
        r = httpx.post(
            f"{self._base}/sys_indexer_state",
            params={"on_conflict": "key"},
            json={"key": key, "last_block": block, "updated_at": "now()"},
            headers={**self._h, "Prefer": "resolution=merge-duplicates,return=minimal"},
            timeout=15,
        )
        r.raise_for_status()
