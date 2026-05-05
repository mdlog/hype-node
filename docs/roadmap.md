# HypeNode — Roadmap Pengembangan

> Dokumen ini mencatat **gap antara klaim di dokumentasi/landing page dan implementasi aktual** di codebase, lalu memprioritaskan pengerjaannya.
>
> Disusun: 2026-05-01
> Referensi: [dokumentasi-aplikasi.md](./dokumentasi-aplikasi.md) · [README](../README.md)

---

## 1. Tabel Prioritas

| # | Item | Severity | Effort | Path Terkait | Status |
|---|------|----------|--------|--------------|--------|
| 1 | Persistence Postgres untuk proposals + earnings | High | M | [app/api/proposals/route.ts](../app/api/proposals/route.ts) | ❌ deterministic snapshot |
| 2 | Real billing (Stripe / USDC verification) | High | L | [app/api/billing/topup/route.ts](../app/api/billing/topup/route.ts) | ❌ mock — trusts user |
| 3 | SoDEX trade execution flow lengkap | High | L | [lib/api/sodex.ts](../lib/api/sodex.ts) | ⚠️ read ok, write stub |
| 4 | SSE untuk reasoning stream | Medium | S | [components/live/ReasoningStream.tsx](../components/live/ReasoningStream.tsx) | ❌ masih polling 5s |
| 5 | LangGraph checkpoint ke Postgres/Redis | Medium | M | [agent-service/](../agent-service/) | ❌ in-memory only |
| 6 | Public subscriber marketplace | Medium | M | (belum ada) | ❌ tidak ada |
| 7 | Tax report engine | Medium | M | [app/publisher/earnings/](../app/publisher/earnings/) | ❌ button disabled |
| 8 | Auto-publish toggle per-index | Medium | S | [app/publisher/config/](../app/publisher/config/) | ❌ tidak ada UI |
| 9 | Withdraw flow (USDC payout) | Medium | M | [app/publisher/earnings/page.tsx](../app/publisher/earnings/page.tsx) | ❌ button disabled |
| 10 | Creator Rank system | Low | M | (belum ada) | ❌ zero implementation |
| 11 | MCP public HTTP endpoint | Low | S | [agent-service/src/mcp_server.py](../agent-service/src/mcp_server.py) | ❌ stdio only |
| 12 | Multi-source data (CoinGecko / Pyth) | Low | S | [lib/api/](../lib/api/) | ❌ SoSoValue only |

**Legend Severity:** High = blocker untuk produksi · Medium = penting untuk product-market fit · Low = nice-to-have
**Legend Effort:** S = < 1 minggu · M = 1–3 minggu · L = 3+ minggu

---

## 2. Detail Per Item

### #1 — Persistence Postgres untuk Proposals + Earnings · `High` · `M`

**Masalah:**
[app/api/proposals/route.ts](../app/api/proposals/route.ts) saat ini mengembalikan deterministic snapshot in-memory. Earnings di [app/publisher/earnings/page.tsx:35-48](../app/publisher/earnings/page.tsx#L35-L48) menampilkan `EmptyKpi` dengan label *"indexer not yet wired"*.

**Acceptance Criteria:**
- [ ] Skema Postgres: `proposals`, `published_indices`, `subscriptions`, `fee_payouts`.
- [ ] Migration setup (Prisma / Drizzle / Knex).
- [ ] Replace `/api/proposals` route handler untuk query DB.
- [ ] On-chain indexer service yang baca SSI Protocol events → simpan `fee_payouts`.
- [ ] `useEarnings(address)` hook menggantikan `EmptyKpi` di earnings page.

**Dependencies:** Tidak ada (foundation).

---

### #2 — Real Billing (Stripe / USDC Verification) · `High` · `L`

**Masalah:**
[app/api/billing/topup/route.ts:11-14](../app/api/billing/topup/route.ts#L11-L14) berisi comment eksplisit:
> *"For demo purposes the endpoint just trusts the authenticated user"*

Tidak ada Stripe webhook, USDC transfer proof, atau on-chain verification.

**Acceptance Criteria:**
- [ ] Pilihan #1: Stripe Checkout + webhook untuk Pro/Enterprise tier.
- [ ] Pilihan #2: USDC payment di ValueChain — verify tx hash + amount + recipient di server side.
- [ ] Schema `subscriptions` dengan `tier`, `started_at`, `expires_at`, `payment_method`.
- [ ] Rate-limit middleware konsumsi tier dari subscription, bukan static config.
- [ ] Receipt / invoice download.

**Dependencies:** #1 (butuh DB).

---

### #3 — SoDEX Trade Execution Flow Lengkap · `High` · `L`

**Masalah:**
[lib/api/sodex.ts:25-27](../lib/api/sodex.ts#L25-L27) menyatakan:
> *"stub focuses on read endpoints + placeholder placeOrder"*

Read endpoints sudah real, tapi tidak ada UI flow yang menyatukan: build action → wallet sign EIP-712 → broadcast → polling status.

**Acceptance Criteria:**
- [ ] Component `<SoDEXOrderModal />` yang ambil typed-data dari `buildExchangeAction()`, sign via wagmi `signTypedData`, kirim ke gateway.
- [ ] Status polling: `pending → submitted → filled / cancelled / rejected`.
- [ ] Error handling untuk insufficient balance, slippage, gateway down.
- [ ] Integrasi ke agent execute node — agent draft order, user sign di UI.

**Dependencies:** Tidak ada.

---

### #4 — SSE untuk Reasoning Stream · `Medium` · `S`

**Masalah:**
[components/live/ReasoningStream.tsx:65](../components/live/ReasoningStream.tsx#L65) pakai `setInterval(tick, 5_000)` untuk polling. README roadmap poin #4 secara eksplisit menyebut *"Stream reasoning entries via SSE rather than polling"*.

**Acceptance Criteria:**
- [ ] Endpoint `/api/agent/reasoning/stream` route handler dengan `text/event-stream`.
- [ ] Agent service push event ke Redis pub/sub atau in-memory channel.
- [ ] Client gunakan `EventSource` (atau `fetch` + ReadableStream) sebagai pengganti `setInterval`.
- [ ] Backpressure handling + reconnect on disconnect.

**Dependencies:** Tidak ada.

---

### #5 — LangGraph Checkpoint ke Postgres/Redis · `Medium` · `M`

**Masalah:**
Agent state hilang saat restart. README roadmap poin #3: *"Push the LangGraph checkpoint to Postgres or Redis (`LANGGRAPH_CHECKPOINT_DIR`)"*.

**Acceptance Criteria:**
- [ ] Konfigurasi `LANGGRAPH_CHECKPOINT_BACKEND=redis` di [agent-service/](../agent-service/).
- [ ] Setiap state transition di [graph.py](../agent-service/src/graph.py) di-persist.
- [ ] Resume dari checkpoint terakhir saat restart.
- [ ] Test crash recovery: kill agent saat node 5/10 → restart → lanjut dari node 6.

**Dependencies:** #1 (jika pilih Postgres backend).

---

### #6 — Public Subscriber Marketplace · `Medium` · `M`

**Masalah:**
Dokumentasi menjanjikan *"subscriber datang dengan sendirinya (browse SSI registry)"*, tapi **tidak ada halaman public** untuk browse index dari sisi subscriber.

**Acceptance Criteria:**
- [ ] Halaman `/marketplace` (public, tidak butuh wallet untuk lihat).
- [ ] List index dengan filter: sektor, Sharpe, AUM, creator rank, fee.
- [ ] Detail page `/marketplace/[ticker]` — chart NAV, constituents, creator profile, subscribe button.
- [ ] Subscribe flow: connect wallet → approve USDC → enter SSI subscription contract.
- [ ] SEO: server-rendered, structured data untuk Google.

**Dependencies:** #1 (butuh DB index metadata).

---

### #7 — Tax Report Engine · `Medium` · `M`

**Masalah:**
Button "View tax report" disabled di [app/publisher/earnings/page.tsx:27](../app/publisher/earnings/page.tsx#L27). Tidak ada engine perhitungan.

**Acceptance Criteria:**
- [ ] FIFO accounting untuk fee payouts.
- [ ] Cost-basis tracking per USDC inflow.
- [ ] Export CSV (Form 1099-MISC compatible) dan PDF.
- [ ] Filter per tahun pajak.
- [ ] Disclaimer legal: "not tax advice, consult professional".

**Dependencies:** #1 (butuh history payouts).

---

### #8 — Auto-Publish Toggle per-Index · `Medium` · `S`

**Masalah:**
FAQ landing page menyebut *"unless you explicitly enable auto-publish for a specific index"*, tapi toggle UI **tidak ada** di [app/publisher/config/](../app/publisher/config/) maupun index settings.

**Acceptance Criteria:**
- [ ] Toggle switch di config page per index.
- [ ] Backend enforcement: jika `auto_publish=true`, agent skip review node.
- [ ] Audit log: catat siapa toggle, kapan, untuk index mana.
- [ ] Warning modal: "auto-publish berarti agen langsung trade tanpa konfirmasi user".

**Dependencies:** #1 (butuh per-index config table).

---

### #9 — Withdraw Flow (USDC Payout) · `Medium` · `M`

**Masalah:**
Button "Withdraw" disabled di [app/publisher/earnings/page.tsx:24](../app/publisher/earnings/page.tsx#L24).

**Acceptance Criteria:**
- [ ] Modal: input amount + destination address (default = connected wallet).
- [ ] Smart contract call ke SSI Protocol untuk claim accumulated fees.
- [ ] Multi-step flow: estimate gas → user sign → broadcast → confirmation.
- [ ] History tab: list semua withdrawal dengan tx hash + status.

**Dependencies:** #1, #3 (butuh wallet sign flow).

---

### #10 — Creator Rank System · `Low` · `M`

**Masalah:**
Disebut di [dokumentasi-aplikasi.md](./dokumentasi-aplikasi.md) sebagai fitur ("Creator Rank — Sistem reputasi"), tapi **tidak ada implementasi sama sekali** di codebase.

**Acceptance Criteria:**
- [ ] Algoritma scoring: Sharpe ratio (40%) + AUM (30%) + tenure (15%) + subscriber count (15%).
- [ ] Tampilan badge di setiap index card di marketplace.
- [ ] Halaman `/leaderboard` top 100 creator.
- [ ] Recompute harian via cron job.

**Dependencies:** #1, #6.

---

### #11 — MCP Public HTTP Endpoint · `Low` · `S`

**Masalah:**
[agent-service/src/mcp_server.py](../agent-service/src/mcp_server.py) hanya stdio (lokal). Dokumentasi menyebut `mcp.hypenode.ai` sebagai potensi revenue stream berbayar.

**Acceptance Criteria:**
- [ ] HTTP transport untuk MCP (sse / streamable-http).
- [ ] Auth: API key per tier.
- [ ] Rate-limit per key.
- [ ] Public docs di `/docs/mcp` dengan tool schema.
- [ ] Sample integration code (Python, TypeScript).

**Dependencies:** #2 (butuh subscription tier untuk billing).

---

### #12 — Multi-Source Data (CoinGecko / Pyth) · `Low` · `S`

**Masalah:**
Dokumentasi sebut CoinGecko + Pyth, tapi codebase hanya wired ke SoSoValue. Risk: vendor lock-in.

**Acceptance Criteria:**
- [ ] `lib/api/coingecko.ts` untuk price fallback.
- [ ] `lib/api/pyth.ts` untuk on-chain oracle price (anti-manipulation).
- [ ] Strategi fallback: SoSoValue primary → CoinGecko if down → Pyth on-chain as last resort.
- [ ] Per-source health monitoring di [/(indexer)/settings](../app/(indexer)/settings/).

**Dependencies:** Tidak ada.

---

## 3. Saran Urutan Eksekusi

### Sprint 1 (Foundation · 2-3 minggu)
1. **#1** Postgres persistence — semua fitur lain bergantung di sini.
2. **#5** LangGraph checkpoint Redis — stabilitas agent.

### Sprint 2 (Revenue Unlock · 3-4 minggu)
3. **#2** Real billing — kunci utama monetisasi.
4. **#3** SoDEX execution lengkap — kunci pengalaman trader real.
5. **#9** Withdraw flow — kunci kepercayaan creator.

### Sprint 3 (Network Effect · 3-4 minggu)
6. **#6** Public marketplace — kunci akuisisi subscriber.
7. **#7** Tax report — kunci retention creator serius.
8. **#8** Auto-publish toggle — kunci power user.

### Sprint 4 (Polish & Differentiation · 2 minggu)
9. **#4** SSE streaming — UX upgrade.
10. **#12** Multi-source data — reliability upgrade.

### Sprint 5 (Growth · 3 minggu)
11. **#10** Creator Rank — gamifikasi.
12. **#11** MCP public endpoint — developer ecosystem revenue.

---

## 4. Sudah Selesai (Tidak Termasuk Roadmap)

Untuk konteks, item-item berikut **sudah real** di codebase dan tidak perlu masuk roadmap:

- ✅ SoSoValue Terminal API integration ([lib/api/sosovalue.ts](../lib/api/sosovalue.ts)) — real fetch + synthetic fallback + rate-limiting + 15-menit cache.
- ✅ SSI Protocol on-chain calls ([lib/api/ssi.ts](../lib/api/ssi.ts)) — `wrapIndex()` & `publishProposal()` via viem.
- ✅ Wallet auth (SIWE) — [components/auth/SignInButton.tsx](../components/auth/SignInButton.tsx).
- ✅ LangGraph 10-node state machine — [agent-service/src/graph.py](../agent-service/src/graph.py).
- ✅ MCP server dengan 7 tools (stdio mode) — [agent-service/src/mcp_server.py](../agent-service/src/mcp_server.py).
- ✅ Rate-limit tier detection (Demo vs Paid) — [app/(indexer)/settings/page.tsx](../app/(indexer)/settings/page.tsx).
- ✅ Wallet balance card — [components/auth/WalletBalance.tsx](../components/auth/WalletBalance.tsx).

---

*Dokumen ini bersifat hidup — perbarui setiap item selesai (ubah ❌ → ✅) dan tambahkan item baru saat scope berkembang.*
