"""Indexer persistence seam. InMemoryStore for tests; SupabaseRestStore writes to
PostgREST with the service-role key (pb_earnings + pb_subscriptions are RLS service-role-only)."""
from typing import Protocol, Optional
import httpx

class IndexerStore(Protocol):
    def proposal_for_index(self, index_id: str) -> Optional[dict]: ...
    def insert_earning(self, row: dict) -> None: ...
    def upsert_subscription(self, row: dict) -> None: ...

class InMemoryStore:
    def __init__(self) -> None:
        self.proposals: dict[str, dict] = {}
        self.earnings: list[dict] = []
        self.subscriptions: dict[tuple, dict] = {}
    def add_proposal(self, p: dict) -> None:
        self.proposals[p["on_chain_index_id"].lower()] = p
    def proposal_for_index(self, index_id: str) -> Optional[dict]:
        return self.proposals.get(index_id.lower())
    def insert_earning(self, row: dict) -> None:
        self.earnings.append(row)
    def upsert_subscription(self, row: dict) -> None:
        self.subscriptions[(row["index_id"].lower(), row["subscriber_address"].lower())] = row
    def subscriptions_for_index(self, index_id: str) -> list[dict]:
        return [v for k, v in self.subscriptions.items() if k[0] == index_id.lower()]

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
        r = httpx.post(f"{self._base}/pb_earnings", json=row, headers=self._h, timeout=15)
        r.raise_for_status()
    def upsert_subscription(self, row: dict) -> None:
        r = httpx.post(f"{self._base}/pb_subscriptions", json=row,
                       headers={**self._h, "Prefer": "resolution=merge-duplicates"}, timeout=15)
        r.raise_for_status()
