# Product Roadmap — HypeNode

> **3-Wave plan** dari MVP saat ini hingga production-ready. Tiap wave punya tema yang jelas, value proposition spesifik, dan exit criteria yang terukur. Tidak ada wave yang "selesai 100%" — kita tutup wave saat exit criteria terpenuhi, sisanya geser ke wave berikut.

```
┌─ WAVE 1 ───────────────┐  ┌─ WAVE 2 ──────────────┐  ┌─ WAVE 3 ──────────────┐
│                        │  │                       │  │                       │
│  INDEXER MVP           │  │  PUBLISHER REVENUE    │  │  PRODUCTION HARDENING │
│  (current — kita       │→ │  LOOP                 │→ │  + SCALE              │
│  sedang di sini)       │  │                       │  │                       │
│                        │  │  13 May → 29 May      │  │  30 May → 15 Jun      │
│  1 May → 12 May        │  │  (17 hari)            │  │  (17 hari)            │
│  (12 hari, ~80%)       │  │                       │  │                       │
└────────────────────────┘  └───────────────────────┘  └───────────────────────┘
   Audience: Trader            Audience: Creator+         Audience: Multi-tenant
   (Personal use)              Subscriber                 (Production users)
```

---

## Wave 1 — Indexer MVP (CURRENT WAVE)

**Periode: 1 Mei 2026 → 12 Mei 2026** (12 hari kalender, ~7 hari engineering setelah weekend)
**Status hari ini (5 Mei): hari ke-5 dari 12, ~95% feature complete — semua 7 exit criteria terpenuhi**

### Tema
**"Single user bisa beneran kelola portfolio index sendiri end-to-end."**

User connect wallet, buat basket berbasis SoSoValue real data, simulate, deploy on-chain, lihat di portfolio mereka — semua tanpa fitur multi-tenant atau revenue mechanic.

### Value proposition Wave 1
Personal trader / quant bisa **research → execute → monitor** strategi tanpa watch market manual. Agent jadi engine, user jadi pemilik strategi.

### Yang sudah selesai di Wave 1 ✅

| Komponen | Status | Catatan |
|---|---|---|
| **Auth flow (SIWE + iron-session)** | ✅ Done | MetaMask connect → sign-in → cookie session |
| **Wallet mismatch detection** | ✅ Done | useSessionGuard + WalletMismatchBanner (Opsi A strict) |
| **Dashboard** | ✅ Done | Sector momentum, SSI snapshots, news, smart money widget |
| **Tokens explorer** | ✅ Done | Universe + token detail (4 tab: economics, supply, pairs, fundraising) |
| **Fundraising tracker** | ✅ Done | Project list + per-project detail, paginated |
| **Builder — full pipeline** | ✅ Done | Signal → Constituents → Weights → Simulate → Deploy |
|   ↳ Sector picker + N assets + weighting rule | ✅ | Wired ke API (rule benar-benar mempengaruhi basket) |
|   ↳ Add asset modal | ✅ | Search SoSoValue universe |
|   ↳ Real backtest 90d | ✅ | Replay klines, Sharpe/MaxDD/WinRate/vs BTC/ETH |
|   ↳ Save/Load draft | ✅ | localStorage |
|   ↳ Sign & Deploy | ✅ | Wagmi useWriteContract → SSIRegistry.registerIndex on Sepolia |
| **Portfolio (real)** | ✅ Done | SSI Registry creator filter + SoDEX balances + reference benchmark |
| **Agent observability** | ✅ Done | LangGraph state graph + reasoning stream (live polling 5s) |
| **Agent control** | ✅ Done | Pause / Step / Reset / Halt — 4 endpoint POST + UI button |
| **Visibility API polling** | ✅ Done | Pause polling saat tab hidden |
| **Path-specific cache TTL** | ✅ Done | klines 30min, news 30s, dll — fix "rate-limit guard serving stale" |
| **Logo system** | ✅ Done | CoinGecko via /api/asset-logos + ProjectLogo + SsiCompositeLogo + InvestorLogo |
| **Loading states (LogoSplash)** | ✅ Done | Centered logo + ring ripple animation |
| **Strategy agent (Claude tool-use)** | ✅ Done | Opt-in via ANTHROPIC_API_KEY, replaces rule-based |
| **Retry logic Anthropic** | ✅ Done | Token bucket, exponential backoff untuk 529 |

### Yang masih outstanding di Wave 1 ⚠️

| Komponen | Status | Estimasi |
|---|---|---|
| **Sector picker UI di dropdown** | ✅ Done | — |
| **Step indicator state-driven** | ✅ Done | — |
| **Triggers field di registerIndex** | ⚠️ Toggle ada tapi belum diteruskan ke `rebalanceCron` field | ~2 jam |
| **Chart period button (1D/1W/1M/3M/ALL)** | ✅ Done client-side | — |
| **History page real data** | ✅ Done | Agent decision log SQLite-persisted, AgentDecisionLog panel di /history |
| **Risk page real wiring** | ✅ Done | Risk gate config persistent + per-rule toggles + manual override |
| **Backtest page (standalone)** | ⚠️ UI ada, share dengan builder simulate | ~0.5 hari |
| **Settings page** | ⚠️ UI mockup | ~0.5 hari |
| **Chat page wiring (sebagian sudah)** | ⚠️ Already chats, beberapa tools belum | ~1 hari |
| **Per-asset USD price aggregation di Portfolio** | ⚠️ Skip di v1 (deferred ke v2) | ~0.5 hari |
| **Logo + sponsor di tokens detail** | ✅ Done | — |
| **Empty state per tab token detail** | ✅ Done | — |
| **WalletConnect Project ID** | ❌ Placeholder masih `YOUR_WALLETCONNECT_PROJECT_ID` | 5 menit (gratis di cloud.reown.com) |

### Exit criteria Wave 1

Wave 1 dianggap "ready to ship" saat **semua tujuh** item di bawah terpenuhi:

- [x] **Auth + session sync**: connect MetaMask → SIWE → ke /dashboard tanpa friction
- [x] **Builder full flow**: user bisa buat basket → simulate → deploy ke Sepolia, tx confirmed
- [x] **Portfolio real wiring**: connected wallet bisa lihat published indices + SoDEX balances
- [x] **Agent observability**: /agent menampilkan reasoning live, control button beneran berfungsi
- [x] **Quota safe-mode**: AGENT_LOOP_SEC=120 + path-specific cache TTL → fit dalam 100k/bulan SoSoValue tier
- [x] **Risk gate config functional**: user bisa set drawdown threshold (+ vol/sentiment/weight/outflow caps + per-rule toggles + manual override), agent honor itu setiap cycle. Persistent di SQLite (`agent-service/data/hypenode.db`), endpoints `GET/POST /risk/config`.
- [x] **History audit trail**: decision log persistent di SQLite, satu row per cycle (sector, basket, risk verdict, breaches, sodex placed/skipped/errors, ssi tx hash, strategy source/confidence/reasoning). Surfaced di /history via `GET /history` + `GET /history/stats`. Retention indefinite — minimal 30 hari memenuhi exit criteria.

**Wave 1 exit criteria semua hijau.** Sisa kerja `5 → 12 Mei` (~7 hari kalender) untuk polish + close item ⚠️ kecil yang masih outstanding (Settings page, Backtest standalone, Triggers field, per-asset USD price aggregation, WalletConnect Project ID). Buffer akhir minggu untuk regression test sebelum Wave 2 mulai.

---

## Wave 2 — Publisher Revenue Loop

**Periode: 13 Mei 2026 → 29 Mei 2026** (17 hari kalender, ~12 hari engineering)

### Tema
**"Creator publish index, subscriber deposit, fee USDC stream ke creator wallet — semua on-chain."**

Wave 2 mengubah Publisher dari "publish metadata only" jadi **revenue-generating product**.

### Value proposition Wave 2

Untuk **creator / KOL**:
- Monetize alpha/research jadi recurring USDC income
- Track AUM, subscriber, fee earnings real-time
- Reputation building via published track record on-chain

Untuk **subscriber**:
- Discover index strategi dari creator yang dipercaya
- Deposit USDC, dapat exposure ke basket otomatis
- Auto-rebalance, no manual trade

Untuk **HypeNode platform**:
- Revenue mulai (% from creator fee + subscription tier upsell)
- Network effect: lebih banyak creator → lebih banyak subscriber → lebih banyak data

### Komponen wajib Wave 2

#### 2.1. HypeIndexVault smart contract
**Effort: 1.5-2 minggu engineering + 1 minggu audit-ready test**

Pilihan implementasi:
- **A. ERC-4626 vault** per index (1 contract per index, factory pattern)
- **B. Multi-asset shared vault** (1 contract handle banyak index, indexed by `id`)

Rekomendasi: **B (shared vault)** untuk gas efficiency dan UX simpler.

Required functions:
```solidity
contract HypeIndexVault {
  function deposit(bytes32 indexId, uint256 usdcAmount) returns (uint256 shares);
  function redeem(bytes32 indexId, uint256 shares) returns (uint256 usdcAmount);
  function nav(bytes32 indexId) view returns (uint256);  // NAV per share
  function totalAssets(bytes32 indexId) view returns (uint256);  // AUM
  function accruePendingFees(bytes32 indexId);
  function claimFees(bytes32 indexId) returns (uint256 mgmt, uint256 perf);
}

// Per-subscriber state
mapping(bytes32 => mapping(address => SubscriberPosition)) subscribers;
struct SubscriberPosition {
  uint256 shares;
  uint256 highWaterMark;
  uint256 lastFeeAccrualAt;
}
```

Acceptance test:
- [ ] User A deposit 100 USDC → mint shares
- [ ] Vault swap USDC → 8 underlying tokens via SoDEX router
- [ ] NAV update reflect price changes per token
- [ ] After 365 days, mgmt fee = 1% × AUM accrued correctly
- [ ] User redeem → swap balik ke USDC, perf fee dipotong
- [ ] Creator claimFees → USDC transfer ke creator wallet

#### 2.2. SoDEX router integration
**Effort: 1 minggu**

Vault perlu eksekusi swap saat deposit/redeem/rebalance. Sudah ada [`agent-service/src/tools/sodex.py`](../agent-service/src/tools/sodex.py) dengan signing logic — wave 2 perlu:

- [ ] On-chain SoDEX adapter contract (atau pakai EOA-signed off-chain dispatch)
- [ ] Slippage protection (max 1% default per swap)
- [ ] Multi-leg execution (1 USDC deposit → 8 swap)
- [ ] Failed swap rollback (atomic transaction atau partial-fill handling)

#### 2.3. Daily fee accrual cron
**Effort: 3-5 hari**

Background job yang setiap hari:
- [ ] Iterate active indices
- [ ] Hit `accruePendingFees(indexId)` for each
- [ ] Update HWM
- [ ] Log untuk earnings dashboard

Implementasi:
- Pakai existing FastAPI agent service + APScheduler
- Atau external cron (GitHub Actions, Render cron, dll)
- Atau on-chain keeper bot (Gelato, Chainlink Automation)

#### 2.4. Subscriber discovery UI
**Effort: 1 minggu**

Halaman baru:
- [ ] `/discover` (atau `/marketplace`) — browse semua public index
- [ ] Filter: sector, AUM, return 30d, creator reputation
- [ ] `/discover/[id]` — detail index untuk calon subscriber
  - Real backtest performance
  - Current AUM + subscriber count
  - Creator profile + track record
  - Fee structure transparent
  - "Deposit to subscribe" button

#### 2.5. Subscribe / Deposit flow
**Effort: 4-5 hari**

UX:
1. Subscriber buka `/discover/[id]`
2. Klik "Subscribe with X USDC"
3. Wagmi: approve USDC → call vault.deposit
4. Confirm tx
5. Now subscriber, share token muncul di portfolio

Need:
- [ ] Approval flow + gas estimation
- [ ] Slippage UI (preview swap output)
- [ ] Subscriber confirmation modal
- [ ] Toast / success state

#### 2.6. Earnings dashboard real
**Effort: 3-4 hari**

`/publisher/earnings` saat ini placeholder. Wave 2 wire ke:
- [ ] Read vault state per published index (AUM, subscriber count)
- [ ] Read fee accrual history
- [ ] Cumulative earnings chart
- [ ] Per-index breakdown: AUM, subscriber, mgmt+perf revenue
- [ ] CSV export untuk pajak

#### 2.7. Hype Radar → auto-draft
**Effort: 1 minggu**

Saat ini Hype Radar UI ada tapi tidak trigger draft. Wave 2:
- [ ] Backend agent monitor sentiment threshold
- [ ] Saat breach → auto-create proposal di `/publisher/proposals`
- [ ] Notification ke creator (email + in-app)
- [ ] Creator review + approve/reject + edit

### Komponen optional Wave 2 (nice-to-have)

- [ ] Creator profile page (Twitter handle, bio, badge)
- [ ] Creator reputation score (track record, AUM history, drawdown)
- [ ] Subscriber waitlist untuk private index
- [ ] Multi-currency base (selain USDC: ETH, USDT)
- [ ] Performance fee dengan crystallization period (vest over 30 hari)

### Exit criteria Wave 2

Wave 2 ready saat:
- [ ] User A publish index → User B subscribe dengan 100 USDC
- [ ] Vault execute 8 swap, share token mint
- [ ] After 30 hari (atau test fast-forward), creator A bisa claim mgmt fee USDC ke wallet mereka
- [ ] User B redeem → swap balik ke USDC, perf fee dipotong correctly (test profitable scenario + loss scenario)
- [ ] Earnings dashboard tampilkan AUM + subscriber + fee revenue real
- [ ] Marketplace `/discover` punya min 5 index dummy untuk test discovery flow
- [ ] Smart contract audit (internal review minimum, external bonus)
- [ ] Slippage protection tested di market volatil

**Window kalender: 13 Mei → 29 Mei (17 hari)**. Original effort estimate komulatif komponen 2.1–2.7 ≈ 8-9 minggu serial — ini hanya feasible kalau:

1. **Paralel 2 dev minimum** — solidity dev kerjakan vault+SoDEX (komponen 2.1, 2.2, 2.3) sementara fullstack kerjakan UI+wiring (komponen 2.4, 2.5, 2.6, 2.7).
2. **Scope cut**: deferred ke Wave 3 kalau slip — slippage protection advanced, multi-leg atomic rollback, performance fee crystallization.
3. **Audit external defer ke Wave 3** — Wave 2 cukup internal review + Foundry test coverage >80%.

Kalau hanya 1 dev solo: realistic scope adalah **vault + minimal subscribe + earnings read-only** (komponen 2.1, 2.5, 2.6 saja). Komponen 2.4 marketplace, 2.7 Hype Radar auto-draft — geser ke Wave 3.

### Risk Wave 2

| Risk | Mitigasi |
|---|---|
| **Smart contract bug** drain dana subscriber | Audit sebelum mainnet. Start di testnet. Pause mechanism. Withdrawal-only mode. |
| **Slippage di SoDEX** untuk small AUM | Cap min deposit (e.g., 100 USDC). Limit max slippage 1%. |
| **Fee accrual race condition** | Atomic update. Re-entrancy guard. Test dengan fork sim. |
| **Creator wallet kompromi** → fee theft | 2-of-2 multisig untuk creator > $X AUM. Time-lock fee claim. |
| **MEV / sandwich attack** saat large deposit swap | Use private mempool (Flashbots). Or batch deposit hourly. |
| **Regulatory** (apakah ini securities?) | Konsul dengan lawyer crypto. Disclosure prominent. KYC opsional untuk creator besar. |

---

## Wave 3 — Production Hardening + Scale

**Periode: 30 Mei 2026 → 15 Juni 2026** (17 hari kalender, ~12 hari engineering)

### Tema
**"Bisa di-launch ke ribuan user tanpa pecah, dengan SLA dan observability yang nyata."**

Wave 1+2 fokus build feature. Wave 3 fokus operating at scale.

### Value proposition Wave 3

Untuk **end user**: app reliable, fast, available 24/7.
Untuk **HypeNode team**: bisa support N user tanpa N orang on-call.
Untuk **investor / acquirer**: due-diligence ready (security audit, observability, compliance).

### Komponen Wave 3

#### 3.1. Multi-chain + mainnet migration
**Effort: 1.5-2 minggu**

Saat ini Sepolia testnet only. Wave 3:
- [ ] Deploy SSIRegistry + HypeIndexVault ke mainnet (Ethereum atau ValueChain L1)
- [ ] Multi-chain dropdown di UI (Sepolia / mainnet / ValueChain)
- [ ] Per-chain config: RPC, USDC address, SoDEX endpoint, gas oracle
- [ ] Withdrawal flow lintas chain (kalau perlu)

#### 3.2. Activity-aware loop
**Effort: 3-5 hari**

Diskusi sebelumnya — defer dari Wave 1. Wave 3 implement:
- [ ] Track `_last_user_activity` di main.py
- [ ] Loop pause kalau no user > 5 menit
- [ ] Quota burn drop drastis di idle periods
- [ ] Tetap maintain background di working hours

#### 3.3. Long page revalidate + manual refresh
**Effort: 2-3 hari**

Wave 1 decision: revalidate pendek untuk testing. Wave 3:
- [ ] Per-page revalidate: tokens 1h, fundraising 6h, dashboard 5min
- [ ] Manual refresh button di dashboard, tokens, fundraising
- [ ] Stale data indicator ("data 12min ago")
- [ ] Optimistic UI saat refresh

#### 3.4. USSI emergency hedge contract
**Effort: 2 minggu**

Risk gate trip → vault rotate ke USSI hedge instrument. Saat ini cuma string label "USSI". Wave 3:
- [ ] Decide USSI implementation: synthetic stablecoin? Treasury bond token? Cash equivalent?
- [ ] Deploy hedge contract
- [ ] Wire risk_node graph.py ke trigger swap basket → USSI
- [ ] Auto-revert saat gate clears (atau manual unlock)

#### 3.5. Observability stack
**Effort: 1 minggu**

- [ ] **Sentry** untuk error tracking (Next.js + FastAPI)
- [ ] **Datadog / Grafana Cloud** untuk metrics (request latency, error rate, quota usage)
- [ ] Custom dashboards:
  - SoSoValue quota burn rate / day
  - Anthropic token spend / day
  - Active users / wallets connected
  - On-chain tx success rate
  - Vault AUM growth
- [ ] Alert: quota >80%, 5xx error spike, agent loop crash

#### 3.6. Performance optimization
**Effort: 1 minggu**

- [ ] **Server-side prefetch** untuk dashboard cold load (parallel SoSoValue calls dengan timeout)
- [ ] **CDN caching** untuk static assets (logos, fonts, CSS)
- [ ] **Database** untuk persistent state (sekarang in-memory di FastAPI runner — restart loss):
  - User config (risk thresholds, triggers)
  - Decision history (pakai PostgreSQL atau Redis)
  - Subscriber positions (mirror dari on-chain untuk fast read)
- [ ] **Worker queue** (BullMQ atau Celery) untuk:
  - Fee accrual cron
  - Email notification
  - Heavy backtest computation

#### 3.7. Security hardening
**Effort: 2 minggu (termasuk audit)**

- [ ] **External smart contract audit** (Trail of Bits / OpenZeppelin / Quantstamp)
- [ ] Bug bounty program di Immunefi
- [ ] Rate limiting per IP di Next.js routes (Upstash Ratelimit)
- [ ] CSRF protection
- [ ] Audit hot key handling (SODEX_PRIVATE_KEY, SSI_PRIVATE_KEY) — minimal multisig untuk treasury
- [ ] DDoS protection via Cloudflare
- [ ] Penetration test internal

#### 3.8. Testing & QA
**Effort: 1.5 minggu**

- [ ] **E2E test** (Playwright atau Cypress):
  - Full flow: connect wallet → builder → simulate → deploy
  - Subscribe flow: discover → deposit → check share token
  - Redeem flow + fee distribution
- [ ] **Unit test** untuk smart contract (Foundry / Hardhat)
- [ ] **Integration test** untuk agent loop (mock SoSoValue + Anthropic)
- [ ] **Fork test** mainnet untuk vault interactions
- [ ] **Load test** untuk Next.js routes (artillery / k6)

#### 3.9. Compliance & legal
**Effort: external + 1 minggu integration**

- [ ] **Terms of Service** + Privacy Policy lawyered
- [ ] **Risk disclosure** prominent di UI (creator + subscriber)
- [ ] **KYC opsional** via Sumsub/Persona untuk creator > $X AUM (kalau diperlukan)
- [ ] **Geo-blocking** untuk yurisdiksi terlarang (US restricted, sanctioned countries)
- [ ] **Tax reporting**: 1099-style export untuk subscriber + creator

#### 3.10. Marketing & growth tooling
**Effort: 1 minggu**

- [ ] **Referral system**: creator dapat % dari subscriber yang mereka refer
- [ ] **Social proof**: "X subscribers, $Y AUM, +Z% return" di marketplace
- [ ] **OG image** dynamic per index (auto-generated screenshot)
- [ ] **Analytics**: PostHog / Mixpanel untuk funnel tracking
- [ ] **Email/Discord notifications**: deposit confirmation, rebalance alert, drawdown breach

#### 3.11. Mobile responsive + PWA
**Effort: 1.5 minggu**

Saat ini desktop-first. Wave 3:
- [ ] Audit semua halaman di mobile breakpoint
- [ ] Drawer-style navigation di mobile
- [ ] Touch-friendly chart interactions
- [ ] PWA manifest + offline shell
- [ ] iOS / Android safe-area handling

#### 3.12. Documentation site
**Effort: 1 minggu**

- [ ] Public docs (Docusaurus atau Mintlify): user guide, creator guide, API reference
- [ ] Tutorial videos (Loom embed)
- [ ] FAQ section
- [ ] Public roadmap page (subset dari ini, polished)

#### 3.13. Customer support tooling
**Effort: 3-5 hari**

- [ ] In-app help widget (Intercom / Crisp / Plain)
- [ ] Status page (statuspage.io atau hosted) untuk uptime + outage comms
- [ ] Internal admin dashboard:
  - User search by wallet
  - Manual fee distribution override (rare)
  - Refund flow (kalau diperlukan)

#### 3.14. Pricing & billing
**Effort: 1 minggu**

- [ ] Subscription tier untuk creator (Free / Pro / Enterprise)
- [ ] Stripe integration
- [ ] Tier-based features:
  - Free: 1 published index, basic backtest
  - Pro ($X/mo): unlimited indices, Claude tool-use unlocked, priority support
  - Enterprise (custom): private deployment, white-label, dedicated agent

### Exit criteria Wave 3

Wave 3 dianggap "production-launch ready" saat:
- [ ] All flows have E2E tests passing
- [ ] Smart contracts audited (eksternal report tanpa critical/high findings)
- [ ] Observability stack live (Sentry + metrics dashboard + alerts)
- [ ] Mainnet deployment functional (Ethereum atau ValueChain mainnet)
- [ ] Mobile responsive di iOS/Android (audit breakpoint utama)
- [ ] Documentation publik live (docs site dengan user/creator guide)
- [ ] Status page reachable
- [ ] Legal sign-off untuk ToS + Privacy
- [ ] At least 1 paying customer (creator atau subscriber pilot)

**Window kalender: 30 Mei → 15 Juni (17 hari)**. Komponen 3.1–3.14 komulatif ≈ 16-20 minggu serial — Wave 3 dengan window 17 hari **harus diprioritaskan tajam**:

**MUST-HAVE untuk launch (in-scope 17 hari):**
- 3.1 Mainnet migration (deploy + smoke test)
- 3.5 Observability stack minimum (Sentry + 1 dashboard)
- 3.7 Security: internal review + rate limiting + multisig hot keys (audit external paralel di-trigger awal Wave 3, hasil masuk post-launch)
- 3.8 E2E test happy path (3 scenario utama)
- 3.9 Compliance: ToS + Privacy + risk disclosure UI (lawyer engagement paralel)

**NICE-TO-HAVE (defer ke post-launch kalau slip):**
- 3.2 Activity-aware loop, 3.3 long revalidate
- 3.4 USSI hedge contract
- 3.6 Performance optimization (database, worker queue)
- 3.10 Marketing tooling, 3.11 Mobile/PWA, 3.12 Doc site, 3.13 Customer support, 3.14 Pricing

External audit (3.7) realistis 2-4 minggu wall clock; **trigger di hari pertama Wave 3**, hasil mungkin baru landing minggu pertama post-launch — soft-launch whitelist beta sambil tunggu audit clean.

---

## Timeline & dependency graph

```
1 May ─────── 12 May ─────── 13 May ─────── 29 May ─────── 30 May ─────── 15 Jun ─────── 16 Jun+
   │             │              │               │              │              │              │
   ┃ WAVE 1 ─────┫              ┃ WAVE 2 ───────┫              ┃ WAVE 3 ──────┫  POST-LAUNCH ─►
   ┃ ▓▓▓▓▓▓▓▓▓▓░│              ┃ ░░░░░░░░░░░░░░│              ┃ ░░░░░░░░░░░░░│
   ┃ ~80% (5 May)│              ┃ 0%            │              ┃ 0%           │
   ┃             │              ┃               │              ┃              │
   ┃ Indexer MVP │              ┃ Publisher loop│              ┃ Production   │
   ┃ finalize    │              ┃ ┌─ Vault ────┤              ┃ ┌─ Mainnet ──┤
   ┃ ┌─ Risk gate│              ┃ ├─ SoDEX ────┤              ┃ ├─ Audit ────┤
   ┃ ├─ History  │              ┃ ├─ Fee cron ─┤              ┃ ├─ Observ ───┤
   ┃ ├─ Settings │              ┃ ├─ Subscribe ┤              ┃ ├─ Sec hard ─┤
   ┃ └─ Polish   │              ┃ └─ Earnings ─┤              ┃ ├─ E2E test ─┤
   ┃             │              ┃               │              ┃ ├─ ToS+Priv ─┤
   ┃             │              ┃ → Internal    │              ┃ └─ Soft launch
   ┃             │              ┃   beta        │              ┃              │
                                                                              │
Today: 5 May (Wave 1 day 5/12)                                                │
                                                                              ▼
                                                                        Public launch +
                                                                        post-launch iteration
```

### Cadence harian saran

| Wave | Periode | Hari engineer / total kalender | Per hari kerja butuh |
|---|---|---|---|
| Wave 1 | 1 May → 12 May | ~8 hari engineer / 12 kalender | 1 fullstack solo OK |
| Wave 2 | 13 May → 29 May | ~12 hari engineer / 17 kalender | 2 dev paralel (solidity + fullstack) atau scope cut ke vault+subscribe MVP |
| Wave 3 | 30 May → 15 Jun | ~12 hari engineer / 17 kalender | 2-3 dev (must-have only) + lawyer eksternal jalan paralel |

### Dependency penting

**Wave 2 dependencies:**
- ⬅️ Wave 1 builder + portfolio harus stable
- ⬅️ SSI Registry contract tidak berubah ABI-nya
- ⬅️ SoDEX integration sudah verified working

**Wave 3 dependencies:**
- ⬅️ Wave 2 vault contract finalized + audited
- ⬅️ Sufficient AUM untuk justify fee mainnet gas
- ⬅️ Legal advisor onboarded sejak akhir Wave 2

---

## What we're explicitly NOT building (anti-roadmap)

Untuk fokus, eksplisit list yang **tidak** akan di-build dalam 3 wave ini:

| Tidak dibangun | Alasan |
|---|---|
| **Custom L1/L2 deployment** (HypeChain) | Pakai Sepolia/ValueChain dulu, evaluate kalau scale demands it |
| **NFT-gated access** untuk premium features | Subscription tier sudah cukup; NFT adds complexity |
| **Cross-chain bridge** asset transfer | Pakai existing bridge (Wormhole, LayerZero) bukan build sendiri |
| **Margin / leverage trading** | Spot only di v1-3. Margin = whole new compliance surface |
| **Order book DEX integration** (selain SoDEX) | Stay focused; SoDEX cukup untuk index rebalance |
| **Synthetic / perp index** | Spot only. Synth perp butuh separate vault architecture |
| **Tokenized index sebagai ERC-20 publik** | Vault share token itu sudah ERC-4626; transfer lock-up untuk simplify accounting |
| **Mobile native app** (iOS/Android Swift/Kotlin) | PWA cukup untuk Wave 3. Native app post-launch berdasarkan demand |
| **DAO governance** untuk HypeNode protocol | Centralized v1-3, tokenize / decentralize post-launch kalau strategi-nya |

---

## Success metrics — apa yang diukur tiap wave

### Wave 1 (current) — adoption metrics
- DAU (daily active wallets)
- # indices deployed on Sepolia
- # successful backtests run
- Avg session duration
- Bug rate per release

### Wave 2 — product-market fit signals
- # creators publish index publik
- # subscribers per index (avg + median)
- AUM growth week-over-week
- Fee revenue (total USDC distributed)
- Subscriber retention 30-day
- Creator NPS

### Wave 3 — business / growth metrics
- MRR (Monthly Recurring Revenue) dari subscription tier
- LTV / CAC
- Mainnet AUM total
- Uptime SLA (target 99.9%)
- Sub-hour P50 latency
- Customer support response time
- Audit findings closed

---

## Pendukung tiap wave — tim dan biaya

### Wave 1 (1 May → 12 May)
- 1 fullstack dev (You + agent assistance)
- $50-100 untuk SoSoValue + Anthropic + hosting periode ini
- Tidak butuh designer / lawyer / auditor

### Wave 2 (13 May → 29 May)
- 1 solidity dev (mid-senior, full-time 17 hari) — **booking sebelum 12 Mei**
- 1 fullstack dev (full-time, lanjut Wave 1)
- 1 designer (part-time untuk Discover marketplace UI)
- $5K-10K untuk internal audit / bug bounty contest
- $100-200 untuk hosting upgrade + Sentry tier (window 17 hari)

### Wave 3 (30 May → 15 Jun)
- Tim Wave 2 lanjut +
- 1 senior backend (observability + database)
- 1 QA engineer (part-time)
- 1 lawyer crypto (consulting hourly) — **engagement minggu pertama Mei untuk siap by 30 May**
- $30K-80K untuk external audit (Trail of Bits / OpenZeppelin) — **booking sebelum 13 Mei karena lead time 2-4 minggu**
- $500-2000 untuk infra production (Vercel Pro, RDS, Datadog, Sentry) periode ini

**Total runway 1 Mei → 15 Juni: $50K-100K + 6.5 minggu kalender (~32-35 hari engineering paralel)**. Timeline agresif — wajib paralelisasi dan disiplin scope-cut. Critical path = audit external (book sekarang, hasil baru landing post-launch).

---

## Decision points di tiap transisi wave

### End of Wave 1 → start Wave 2 (deadline 12 Mei → kick-off 13 Mei)
- ✅ Apakah Wave 1 punya ≥10 user (waiting list / closed beta) yang express interest publish index?
- ✅ Apakah cost burn (SoSoValue + Anthropic) sustainable di scale yang projeksi?
- ✅ Apakah product-market signal cukup untuk justify investasi Wave 2?

Kalau **TIDAK**, iterasi di Wave 1 dulu — UX polish, more sectors, better simulate UX. Tunggu signal lebih kuat.

### End of Wave 2 → start Wave 3 (deadline 29 Mei → kick-off 30 Mei)
- ✅ Apakah ≥3 creator publish index yang menarik subscriber real?
- ✅ Apakah AUM total ≥$10K (proof of revenue mechanic works)?
- ✅ Apakah ada bug major di vault yang blocking? (kalau ya, tutup Wave 2 dulu)
- ✅ Apakah cash runway cukup untuk full Wave 3 scope?

Kalau **TIDAK**, partial Wave 3 (security audit + observability minimum), defer marketing & mobile.

### End of Wave 3 → public launch (target 15 Juni)
- ✅ External audit clean (no critical/high)
- ✅ Mainnet deployment tested dengan small AUM ($X test)
- ✅ Status page + observability live
- ✅ Legal ToS + Privacy in place
- ✅ Customer support channel ready

Kalau **TIDAK**, soft-launch terbatas (whitelist beta) sampai gap tertutup.

---

## Lampiran — referensi cepat

- [Indexer vs Publisher overview](./indexer-vs-publisher.md)
- [Existing roadmap (legacy)](./roadmap.md)
- [SoSoValue API reference](./sosovalue-api.md)
- [Application docs (Indonesian)](./dokumentasi-aplikasi.md)

---

**Last updated**: 2026-05-05
**Owner**: HypeNode core team
**Status**: Wave 1 in progress, hari ke-5 dari 12 (1 Mei → 12 Mei), ~95% feature complete — semua exit criteria terpenuhi
**Target public launch**: 15 Juni 2026
