# Vault Event Indexer → Supabase (sub-project 2) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]` checkboxes.

**Goal:** Index the on-chain `HypeIndexVault` fee/subscription events into Supabase so the publisher earnings dashboard and `/discover` show **real** data (not "—"). Built in `agent-service` (Python), verified end-to-end on anvil.

**Architecture (approved 2026-06-04):** A Python indexer reads vault events (`Subscribed`, `Redeemed`, `MgmtAccrued`) from a block range (reusing the keeper's web3 client), maps them to `pb_earnings` + a new `pb_subscriptions` table, and writes via a `Store` seam — `SupabaseRestStore` (httpx + service-role key against PostgREST) for production, `InMemoryStore` for tests. Subscription shares mirror on-chain `positions(indexId, who)` (authoritative); mgmt-fee USD value uses the vault's `lastNav`; `indexId→proposal` resolves via `pb_proposals.on_chain_index_id`.

**Tech:** Python 3.12, web3 7.16, httpx, pytest, Foundry/anvil. Supabase Postgres (`pb_earnings` exists; `pb_subscriptions` new).

**Key schema facts:** `pb_earnings(proposal_id uuid FK pb_proposals, creator_address, event_type in (mgmt_fee|perf_fee|subscription_fee|manual), amount_usd numeric, accrued_at, tx_hash, block_number, aum_usd_at_accrual, subscriber_count)`, RLS service-role-only. `pb_proposals(id uuid, creator_address, on_chain_index_id text /* bytes32 */, status)`.

**Event→row mapping:**
- `Subscribed(id, indexId, who, shares, navPerShare)` → upsert `pb_subscriptions` for (proposal, who) with `shares = positions(indexId, who).shares` (read on-chain), `status='active'`.
- `Redeemed(id, indexId, who, netUsdc, perfFeeUsdc)` → (a) `pb_earnings` perf_fee row `amount_usd = perfFeeUsdc / 1e6`; (b) upsert `pb_subscriptions` for (proposal, who) with the now-current on-chain shares (`status='redeemed'` if 0).
- `MgmtAccrued(indexId, feeShares, epochDay)` → `pb_earnings` mgmt_fee row `amount_usd = feeShares * lastNav / 1e18 / 1e6` (lastNav = `vaults(indexId).lastNav`).
- Every `pb_earnings` row is stamped with `tx_hash`, `block_number`, `aum_usd_at_accrual` (Σ active shares × lastNav / 1e18 / 1e6) and `subscriber_count` (active rows for the index).
- `FeesClaimed` → out of scope for this sub-project (informational only).

**Boundary / deferred:** `pb_creators`/reputation; a persistent last-block checkpoint table (MVP keeps it in a small state row/file); the live Supabase round-trip (tests use `InMemoryStore`; `SupabaseRestStore` is typed + schema-backed but not hit live here).

---

## File Structure

| File | Responsibility |
|---|---|
| `supabase/migrations/0003_pb_subscriptions.sql` | new `pb_subscriptions` table + RLS + indexes |
| `agent-service/src/vault/abi.py` (modify) | add `MgmtAccrued` + `FeesClaimed` event fragments |
| `agent-service/src/vault/store.py` | `IndexerStore` protocol + `InMemoryStore` + `SupabaseRestStore` |
| `agent-service/src/vault/indexer.py` | `VaultIndexer` — read events for a block range, map, write via store |
| `agent-service/tests/test_indexer.py` | pytest: synthetic events → rows (InMemoryStore) |
| `agent-service/tests/test_e2e_anvil.py` (modify) | run the indexer over the real lifecycle, assert rows |
| `app/discover/page.tsx` (modify) | read `subscriber_count`/AUM from `pb_subscriptions` |
| `lib/supabase/types.ts` (modify) | add `PbSubscriptionRow`/`Insert` types |

---

## Task 2A: `pb_subscriptions` migration

**File:** Create `supabase/migrations/0003_pb_subscriptions.sql`.

- [ ] **Step 1:** read `supabase/migrations/0001_init.sql` lines ~194-246 (the `pb_proposals` + `pb_earnings` definitions) to match style/conventions exactly. Then write:
```sql
-- 0003_pb_subscriptions.sql — subscriber positions mirrored from the HypeIndexVault.
create table public.pb_subscriptions (
  id                 uuid primary key default gen_random_uuid(),
  proposal_id        uuid not null references public.pb_proposals(id) on delete cascade,
  index_id           text not null,                 -- bytes32 vault indexId (0x..)
  subscriber_address text not null,
  shares             numeric not null default 0,    -- on-chain position shares (WAD)
  status             text not null default 'active' check (status in ('active','redeemed')),
  first_subscribed_at timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (index_id, subscriber_address)
);
create index idx_pb_subs_proposal on public.pb_subscriptions (proposal_id);
create index idx_pb_subs_index_active on public.pb_subscriptions (index_id) where status = 'active';

alter table public.pb_subscriptions enable row level security;
create policy "service role only" on public.pb_subscriptions for all using (false);

create trigger trg_pb_subscriptions_updated_at before update on public.pb_subscriptions
  for each row execute function public.set_updated_at();
```
> Confirm the trigger function name matches the one `pb_proposals` uses (grep `set_updated_at` / `trg_pb_proposals_updated_at` in 0001 — reuse the exact function name; if it's different, match it).

- [ ] **Step 2:** commit `git add supabase/migrations/0003_pb_subscriptions.sql && git commit -m "feat(indexer): pb_subscriptions migration"`.

---

## Task 2B: Store seam + indexer mapping (pure) + unit tests

**Files:** modify `agent-service/src/vault/abi.py`; create `agent-service/src/vault/store.py`, `agent-service/src/vault/indexer.py`, `agent-service/tests/test_indexer.py`.

- [ ] **Step 1:** add the `MgmtAccrued` + `FeesClaimed` event fragments to `VAULT_ABI` in `abi.py` (copy from `contracts/out/HypeIndexVault.sol/HypeIndexVault.json`). Verify: `.venv/bin/python -c "from src.vault.abi import VAULT_ABI; print([e['name'] for e in VAULT_ABI if e['type']=='event'])"` includes `MgmtAccrued`, `FeesClaimed`.

- [ ] **Step 2: failing tests** `agent-service/tests/test_indexer.py`:
```python
from src.vault.store import InMemoryStore
from src.vault.indexer import map_mgmt_accrued, map_redeemed, map_subscribed

PROP = {"id": "prop-uuid", "creator_address": "0xCreator", "on_chain_index_id": "0xidx"}

def _store():
    s = InMemoryStore()
    s.add_proposal(PROP)
    return s

def test_mgmt_accrued_maps_to_mgmt_fee_usd():
    s = _store()
    # feeShares=10e18, lastNav=1e6 → amount_usd = 10e18 * 1e6 / 1e18 / 1e6 = 10.0
    row = map_mgmt_accrued(s, index_id="0xidx", fee_shares=10*10**18, last_nav=1_000_000,
                           aum_usd=1000.0, subscriber_count=1, tx_hash="0xtx", block_number=5)
    assert row["event_type"] == "mgmt_fee"
    assert row["proposal_id"] == "prop-uuid"
    assert row["creator_address"] == "0xCreator"
    assert abs(row["amount_usd"] - 10.0) < 1e-9
    assert row["subscriber_count"] == 1

def test_redeemed_maps_to_perf_fee_usd():
    s = _store()
    row = map_redeemed(s, index_id="0xidx", who="0xSub", perf_fee_usdc=100_000_000,
                       aum_usd=500.0, subscriber_count=1, tx_hash="0xtx", block_number=6)
    assert row["event_type"] == "perf_fee"
    assert abs(row["amount_usd"] - 100.0) < 1e-9   # 100e6 / 1e6

def test_subscribed_upserts_subscription():
    s = _store()
    map_subscribed(s, index_id="0xidx", who="0xSub", onchain_shares=123, status="active")
    subs = s.subscriptions_for_index("0xidx")
    assert len(subs) == 1 and subs[0]["subscriber_address"] == "0xSub" and subs[0]["shares"] == 123

def test_unknown_index_skips():
    s = _store()
    row = map_mgmt_accrued(s, index_id="0xUNKNOWN", fee_shares=1, last_nav=1, aum_usd=0, subscriber_count=0, tx_hash="0x", block_number=1)
    assert row is None   # no proposal → skip
```

- [ ] **Step 3:** `agent-service/src/vault/store.py`:
```python
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
                      params={"on_chain_index_id": f"eq.{index_id}", "select": "id,creator_address,on_chain_index_id", "limit": 1},
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
```

- [ ] **Step 4:** `agent-service/src/vault/indexer.py` — the pure mappers (plus the `VaultIndexer` class in Task 2C):
```python
"""Map HypeIndexVault events to Supabase rows. Pure mappers are unit-tested;
the VaultIndexer (Task 2C) reads events from chain and drives them through a store."""
from typing import Optional
from .store import IndexerStore

def map_mgmt_accrued(store: IndexerStore, index_id: str, fee_shares: int, last_nav: int,
                     aum_usd: float, subscriber_count: int, tx_hash: str, block_number: int) -> Optional[dict]:
    prop = store.proposal_for_index(index_id)
    if not prop:
        return None
    amount_usd = fee_shares * last_nav / 1e18 / 1e6
    row = {"proposal_id": prop["id"], "creator_address": prop["creator_address"],
           "event_type": "mgmt_fee", "amount_usd": amount_usd, "tx_hash": tx_hash,
           "block_number": block_number, "aum_usd_at_accrual": aum_usd, "subscriber_count": subscriber_count}
    store.insert_earning(row)
    return row

def map_redeemed(store: IndexerStore, index_id: str, who: str, perf_fee_usdc: int,
                 aum_usd: float, subscriber_count: int, tx_hash: str, block_number: int) -> Optional[dict]:
    prop = store.proposal_for_index(index_id)
    if not prop:
        return None
    row = {"proposal_id": prop["id"], "creator_address": prop["creator_address"],
           "event_type": "perf_fee", "amount_usd": perf_fee_usdc / 1e6, "tx_hash": tx_hash,
           "block_number": block_number, "aum_usd_at_accrual": aum_usd, "subscriber_count": subscriber_count}
    store.insert_earning(row)
    return row

def map_subscribed(store: IndexerStore, index_id: str, who: str, onchain_shares: int, status: str) -> Optional[dict]:
    prop = store.proposal_for_index(index_id)
    if not prop:
        return None
    row = {"proposal_id": prop["id"], "index_id": index_id, "subscriber_address": who,
           "shares": onchain_shares, "status": status}
    store.upsert_subscription(row)
    return row
```

- [ ] **Step 5:** run `cd agent-service && .venv/bin/python -m pytest tests/test_indexer.py -q` → 4 pass. Commit `feat(indexer): event→row mappers + Store seam (in-memory + supabase-rest)`.

---

## Task 2C: VaultIndexer (chain read) + e2e

**Files:** modify `agent-service/src/vault/indexer.py` (add `VaultIndexer`), modify `agent-service/tests/test_e2e_anvil.py`.

- [ ] **Step 1:** add `VaultIndexer` to `indexer.py`:
  - `__init__(self, w3, vault_contract, store)`.
  - `_aum_and_count(self, index_id_bytes) -> (aum_usd, count)`: read active `pb_subscriptions` from the store for the index... in the InMemoryStore test path compute from the store's subscriptions; for the on-chain mirror, count = number of active subs, aum = Σ shares × `vaults(idx).lastNav` / 1e18 / 1e6. Keep it simple: derive count + aum from the store's current `subscriptions_for_index` (the indexer updates subs before earnings within a block range, or compute from chain — implementer's choice, but the e2e must show non-zero aum/count on the mgmt_fee row).
  - `index_range(self, from_block, to_block)`: for each `Subscribed`/`Redeemed`/`MgmtAccrued` log in range (use `vault.events.X().get_logs(from_block=.., to_block=..)`; if that API is fiddly under web3 7.x, fall back to `w3.eth.get_logs` with the event topic + `vault.events.X().process_log`), in block/log order: on Subscribed → read `positions(idx, who).shares` on-chain, `map_subscribed(...)`; on Redeemed → read positions, `map_subscribed(..., status='redeemed' if shares==0 else 'active')` then `map_redeemed(...)`; on MgmtAccrued → `map_mgmt_accrued(..., last_nav=vaults(idx).lastNav, ...)`. Return counts.
- [ ] **Step 2:** extend `tests/test_e2e_anvil.py`: after the existing lifecycle (deposit → accrue → redeem → claim), construct `store = InMemoryStore()`, `store.add_proposal({"id":"p1","creator_address":<creator>,"on_chain_index_id":"0x"+idx.hex()})`, run `VaultIndexer(w3, vault, store).index_range(0, w3.eth.block_number)`, then assert: `store.earnings` contains ≥1 `mgmt_fee` row (amount_usd ≈ 9.9–10.0) AND ≥1 `perf_fee` row (0 here since redeem at flat NAV → perf_fee 0; if so assert the perf_fee row exists with amount 0 OR adjust the lifecycle to create a profit so perf_fee>0 — prefer adding a profit leg so the perf_fee path is genuinely exercised), AND `store.subscriptions_for_index` shows the subscriber (redeemed → shares 0/status redeemed). Make it pass.
- [ ] **Step 3:** run `cd agent-service && .venv/bin/python -m pytest tests/ -q` → all green. Commit `feat(indexer): VaultIndexer chain read + anvil e2e assertions`.

> To genuinely exercise the perf_fee path, the e2e should include a profit leg: after deposit, `nav_engine.mark(idx_hex, 1.5)` won't affect the on-chain settleRedeem nav (the keeper signs nav from the engine). Ensure the keeper redeems at a nav above the subscriber's HWM so `Redeemed.perfFeeUsdc > 0`, then assert the perf_fee row's amount_usd > 0.

---

## Task 2D: TS read-side wiring (/discover subscriber_count + types)

**Files:** modify `lib/supabase/types.ts`, `app/discover/page.tsx`.

- [ ] **Step 1:** add `PbSubscriptionRow` + `PbSubscriptionInsert` types to `lib/supabase/types.ts` matching the migration columns.
- [ ] **Step 2:** in `app/discover/page.tsx`, where the card currently reads `subscriber_count`/AUM from `pb_earnings.latest_earning` (renders "—"), add a query to `pb_subscriptions` (via the service-role `db`) aggregating active subscriber count per `index_id`, and use it for the subscriber tile. Keep AUM from the latest `pb_earnings.aum_usd_at_accrual` if present. (Read the current page.tsx aggregation first; make a minimal, additive change — do not break the existing filter/sort.)
- [ ] **Step 3:** `npm run typecheck` → clean. Commit `feat(indexer): wire /discover subscriber_count from pb_subscriptions`.

---

## Self-Review (plan author)
- **Coverage:** migration (2A), mappers + store seam + unit tests (2B), chain reader + e2e over real events (2C), read-side wiring (2D). Deferred items fenced (pb_creators, live Supabase round-trip, checkpoint table).
- **Verifiability:** the mappers are unit-tested; the VaultIndexer is exercised against REAL anvil events in the e2e (with InMemoryStore); `SupabaseRestStore` is typed + schema-aligned but not hit live (honest caveat). `/discover` change is typecheck-gated.
- **Consistency:** `amount_usd` USDC math (feeShares×lastNav/1e18/1e6; perfFeeUsdc/1e6) matches the contract units; `pb_earnings`/`pb_subscriptions` column names match the migrations; `indexId→proposal` via `on_chain_index_id` consistent across store + mappers.
