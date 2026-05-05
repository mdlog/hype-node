# Indexer vs Publisher — Dua Produk HypeNode

> **Ringkasan satu kalimat**
> **Indexer** adalah cockpit untuk **mengelola portfolio index sendiri**. **Publisher** adalah toko untuk **menerbitkan index agar dipakai investor lain**, dengan fee management + performance yang stream ke wallet creator.

Keduanya berbagi infrastruktur yang sama (autonomous agent, SoSoValue data layer, SSI Registry on-chain, SoDEX execution) tapi audiens, value prop, dan revenue model-nya berbeda.

---

## 1. Visi tinggi — kenapa ada dua produk?

HypeNode dibangun di atas premise: **"autonomous agent yang bisa research → execute crypto strategy"**. Use case yang sama bisa di-frame untuk dua audience:

| Audience | Pertanyaan utama | Produk |
|---|---|---|
| **Trader / fund manager pribadi** | "Bisakah agent ini kelola dana saya tanpa saya perlu watch market 24/7?" | **Indexer** |
| **Crypto research creator / KOL** | "Bisakah saya buat index yang followers saya bisa subscribe + saya dapat fee?" | **Publisher** |

Bedakan dari analogi tradisional finance:
- Indexer ≈ **personal hedge fund** (kelola dana sendiri)
- Publisher ≈ **ETF issuer + fund manager** (creator menerbitkan instrumen, dipakai banyak investor)

---

## 2. Indexer — Detail lengkap

### 2.1. Tujuan

> Indexer membantu **satu user** (Anda) **mengelola portfolio index sendiri** dengan bantuan autonomous AI agent. Anda tetap pemilik strategi, agent jadi engine yang mengeksekusi.

Tidak ada "subscriber" di Indexer — ini full personal use. Tidak ada fee distribution. Tidak ada marketplace.

### 2.2. Halaman & route Indexer

Semua di route group `app/(indexer)/*`:

```
/dashboard      — Command Center: ringkasan portfolio, sentiment by sector,
                   SSI indices reference, news, smart money signals
/agent          — Live observability LangGraph state machine + reasoning
                   stream + 4 control button (pause/step/reset/halt)
/research       — Sector spotlight, sentiment data, fund flows
/tokens         — Universe explorer, drill down per token (economics,
                   supply, pairs, fundraising)
/builder        — 5-step pipeline untuk compose index sendiri:
                   Signal → Constituents → Weights & rules → Simulate → Deploy
/portfolio      — Posisi user real-time: published indices + spot balances
                   on SoDEX, plus reference benchmark
/risk           — Risk gate config, USSI emergency hedge, drawdown thresholds
/backtest       — Backtest lab, compare strategies vs benchmarks
/history        — Transaction history, agent decisions log
/chat           — MCP chat ke Claude agent untuk natural-language control
/analyses       — Saved analyses, deep-dive reports
/stocks         — Crypto-stock proxy data (MSTR, MARA, etc.)
/fundraising    — VC funding tracker per project
/settings       — Wallet, API keys, agent config
```

### 2.3. Workflow user — typical flow

```
1. Connect wallet (SIWE sign-in dengan MetaMask)
   ↓
2. Buka /dashboard — lihat sector momentum, SSI indices reference
   ↓
3. Buka /research — drill down ke sektor yang menarik (mis. DePIN +340%)
   ↓
4. /builder — compose basket:
   - Pick sector → fetch konstituen dari SoSoValue
   - Pilih weighting rule (score / equal / mcap / ssi reference)
   - Add/remove asset manual kalau perlu
   - Set name, symbol, base currency
   - Simulate 90d backtest pakai real klines → review Sharpe/drawdown/win rate
   - Sign & Deploy ke SSI Registry on-chain (Sepolia testnet)
   ↓
5. /portfolio — lihat index yang baru di-publish + posisi spot SoDEX
   ↓
6. /agent — biarkan autonomous loop monitor + propose rebalance
   - Ada Pause/Halt button kalau perlu intervene
   ↓
7. /risk — set USSI emergency hedge: drawdown >5% → auto-flip ke USSI
   ↓
8. /history — audit semua keputusan agent (THINK/TOOL/OBS/ACT logs)
```

### 2.4. Komponen utama Indexer

#### 2.4.1. Autonomous LangGraph agent ([agent-service/src/graph.py](../agent-service/src/graph.py))

10 node state machine yang berjalan setiap N detik (`AGENT_LOOP_SEC`, default 120):

```
signal → sentiment → flow → strategy → backtest → risk → wrap → exec → loop
                                                  └─ emergency_exit (USSI)
```

- **signal** : poll SoSoValue Terminal untuk hype cluster baru
- **sentiment** : score 0-100 per sector (kepekatan momentum)
- **flow** : fund flow + top-asset-by-inflow per sector
- **strategy** : compose basket (Claude tool-use kalau Opsi C aktif, atau rule-based)
- **backtest** : replay 90d klines, Sharpe / drawdown / win rate
- **risk** : 5 threshold (vol, dd, sentiment delta, weights concentration, net outflow)
- **wrap** : `SSIRegistry.registerIndex` on-chain
- **exec** : SoDEX execute trade
- **emergency_exit** : kalau risk gate trip → swap ke USSI hedge
- **loop** : sleep + re-enter

#### 2.4.2. Builder — index composition tool

5 langkah pipeline yang dijelaskan di [`builder/page.tsx`](../app/(indexer)/builder/page.tsx). Output: index spec yang ter-publish on-chain di SSIRegistry.

#### 2.4.3. Portfolio — user identity-aware

Read [`SSIRegistry`](../contracts/SSIRegistry.sol) on-chain (`creator == userAddress`) + SoDEX `/accounts/{addr}/balances` untuk gabungkan:
- Indices yang user publish
- Spot positions di exchange
- Total NAV (kalau price aggregation enabled)

### 2.5. Revenue model untuk Indexer

**Indexer adalah cost center untuk user, bukan revenue center.**

User bayar:
- Subscription HypeNode (tier-based, future)
- API usage SoSoValue (kalau pakai own key, atau termasuk subscription)
- Anthropic token cost (kalau Claude tool-use aktif)
- Gas on-chain saat deploy / rebalance

User dapat:
- Alpha dari agent yang research 24/7
- Time saving (tidak perlu manual watch market)
- Audit trail untuk decision-making

### 2.6. Siapa pakai Indexer?

- **Trader pribadi** yang ingin diversifikasi tanpa manual research
- **Family office / small fund** yang butuh systematic strategy
- **Quant developer** yang mau eksperimen index strategy
- **Researcher** yang butuh tooling backtesting

---

## 3. Publisher — Detail lengkap

### 3.1. Tujuan

> Publisher membantu **creator (KOL, researcher, analis crypto)** menerbitkan index publik yang **dapat di-subscribe oleh investor lain**. Creator dapat fee management + fee performance dalam USDC yang stream daily ke wallet mereka.

Beda fundamental: Indexer = personal use; Publisher = creator economy.

### 3.2. Halaman & route Publisher

Semua di `app/publisher/*`:

```
/publisher/radar         — Hype Radar: live sector momentum dashboard
                            (sentiment burst detection — yang bikin
                            user "ada signal nih, bikin index")
/publisher/proposals     — Daftar proposal yang agent bantu draft;
                            creator review & approve sebelum publish
/publisher/proposals/[id] — Detail proposal: composition + backtest
                            + Sign & Publish ke SSI Registry
/publisher/published     — Daftar index yang sudah live
                            (subscriber count, AUM, fee accrued, dll)
/publisher/earnings      — Revenue dashboard:
                            management fee + performance fee per index,
                            stream USDC ke wallet harian
/publisher/config        — Default fee bps, rebalance cadence,
                            visibility settings (public/private)
```

### 3.3. Workflow user (creator) — typical flow

```
1. Connect wallet — sama seperti Indexer
   ↓
2. /publisher/radar — pantau sektor yang sedang spike
   - Kalau ada cluster (mis. AI sentiment +180%)
   - Klik "Draft proposal" → agent susun basket
   ↓
3. /publisher/proposals — review draft yang disusun agent:
   - Composition (8-12 token)
   - Suggested weights
   - Pre-baked backtest (Sharpe, drawdown, vs BTC/ETH)
   - Reasoning trail dari agent
   ↓
4. Creator edit kalau perlu (swap token, adjust weight)
   ↓
5. /publisher/proposals/[id] → Sign & Publish:
   - Set fee structure: mgmt 1%/year + perf 10% (high water mark)
   - Sign → SSIRegistry.registerIndex on-chain
   ↓
6. Index sekarang public di /publisher/published
   - Subscriber bisa discover + subscribe
   - Setiap subscriber deposit, fee dipotong daily
   - Stream USDC ke creator wallet
   ↓
7. /publisher/earnings — track:
   - AUM (total deposit)
   - Fee revenue daily/monthly
   - Subscriber count + churn
   - Tax report
```

### 3.4. Komponen utama Publisher

#### 3.4.1. Hype Radar — sektor momentum detection

[`/publisher/radar`](../app/publisher/radar) — surface sektor yang sedang hot:
- Sentiment delta + threshold breach
- Fund flow positive
- News velocity tinggi
- Catalyst events

Tujuan: **creator tahu kapan timing tepat untuk publish proposal**, tidak miss momen.

#### 3.4.2. Agent-drafted proposals

Berbeda dengan Indexer Builder yang **on-demand user trigger**, Publisher pakai **agent yang proactively draft proposal**:
- Setiap kali sentiment >threshold → agent compose basket
- Creator dapat notification (future)
- Klik approve untuk publish ke chain

Engine sama dengan basket.py / strategy_agent.py yang dipakai Indexer, tapi UX berbeda.

#### 3.4.3. PublishActions — wagmi flow

[`PublishActions.tsx`](../app/publisher/proposals/[id]/PublishActions.tsx) — komponen yang sama dengan Indexer Builder Deploy button. Wagmi `useWriteContract` ke `SSIRegistry.registerIndex(...)`.

Bedanya: di Publisher konteksnya creator publishing, di Indexer konteksnya user buat index pribadi. Kontrak yang dipanggil sama persis.

#### 3.4.4. Fee distribution layer (BELUM diimplementasi)

Untuk fee benar-benar ter-stream, butuh:
- **HypeIndexVault** contract yang track AUM per index + per subscriber
- **Fee accrual logic**: mgmt = AUM × bps × time_elapsed; perf = max(0, NAV - HWM) × bps
- **Daily distribution**: cron yang transfer USDC dari vault ke creator wallet
- **Performance high-water mark tracking** per subscriber

Saat ini SSI Registry **hanya catat metadata** termasuk `mgmtFeeBps` dan `perfFeeBps` sebagai spec. **Tidak ada vault yang actually accept deposit dan distribute fee.** Ini gap yang harus di-fill untuk Publisher jadi product yang revenue-generating.

### 3.5. Revenue model untuk Publisher

**Publisher adalah revenue center untuk creator + HypeNode.**

Creator dapat:
- **Management fee** — biasanya 1%/year × AUM, accrue daily
- **Performance fee** — biasanya 10% × profit di atas high-water mark, vest periodically
- **Volume kickback** (opsional) — share dari trading fee SoDEX kalau index aktif rebalance

HypeNode dapat:
- **Subscription tier** dari creator (Pro tier untuk unlock advanced features)
- **Rev-share** dari fee creator (mis. 20% of mgmt + 10% of perf)
- **Protocol fee** dari trade volume yang diinduce (kalau wired di SoDEX)

Subscriber bayar:
- Mgmt fee → creator + HypeNode
- Perf fee saat above HWM → creator + HypeNode
- Gas (Gas-Free Trading kalau di SoDEX testnet)
- Trading slippage di SoDEX

### 3.6. Siapa pakai Publisher?

- **Crypto researcher / analyst** dengan audience besar (Twitter, YouTube)
- **KOL** yang ingin monetize signal-mereka secara terprogram
- **Quant team** yang punya alpha dan ingin sell access
- **VCs / institutional desk** yang publish thematic basket untuk klien LPs
- **DAO** yang publish treasury-allocation strategy

---

## 4. Perbandingan Indexer vs Publisher

| Dimensi | Indexer | Publisher |
|---|---|---|
| **Audience** | Trader pribadi, fund manager | Creator, KOL, research team |
| **Tujuan** | Kelola dana sendiri | Publish index untuk dipakai investor lain |
| **Persona** | "Saya butuh agent kelola portfolio saya" | "Saya punya alpha, ingin sell access" |
| **Wallet** | Personal wallet | Creator wallet (untuk sign + receive fee) |
| **Konsumen index** | Hanya user itu sendiri | Banyak subscriber |
| **Data sumber** | Sama (SoSoValue, agent service) | Sama |
| **On-chain target** | SSI Registry (creator = user) | SSI Registry (creator = creator) |
| **Revenue** | None — cost center | Mgmt fee + Perf fee (USDC stream) |
| **Subscriber concept** | ❌ tidak ada | ✅ ada (kalau vault diimplementasi) |
| **Fee tracking UI** | ❌ tidak relevan | ✅ /publisher/earnings |
| **Active discovery UI** | Dashboard (passive) | Hype Radar (alert-driven) |
| **Index visibility** | Private (creator-only) | Public (default) |
| **Status saat ini** | ✅ Functional v1 | ⚠️ Functional sebagian — vault belum |

---

## 5. Hubungan dua produk — shared infrastructure

Walau audience beda, banyak yang shared:

```
┌─ Shared infrastructure ────────────────────────────────────┐
│                                                            │
│  SoSoValue API (data layer)                                │
│   ├─ Sentiment, flow, news, klines, snapshots              │
│   └─ SSI Indices (curated baskets)                         │
│                                                            │
│  Agent service (Python LangGraph)                          │
│   ├─ propose_basket() — composition logic                   │
│   ├─ run_real_backtest() — historical replay                │
│   ├─ strategy_agent — Claude tool-use (opt-in)              │
│   └─ risk module — threshold gates                         │
│                                                            │
│  SSI Registry (Sepolia smart contract)                     │
│   └─ registerIndex(symbol, name, tokens, weights, fees)    │
│                                                            │
│  SoDEX (ValueChain L1)                                     │
│   ├─ Read-only: balances, prices, klines                    │
│   └─ Write: trade execution (signed actions)                │
│                                                            │
│  Wallet auth (SIWE + iron-session)                          │
│   └─ Same flow untuk Indexer & Publisher                    │
│                                                            │
└────────────────────────────────────────────────────────────┘
       ↓                              ↓
┌─ INDEXER UI ──────┐    ┌─ PUBLISHER UI ──────┐
│ /dashboard        │    │ /publisher/radar    │
│ /builder          │    │ /publisher/proposals│
│ /portfolio        │    │ /publisher/published│
│ /agent            │    │ /publisher/earnings │
│ /risk             │    │ /publisher/config   │
│ ... (10 halaman)  │    │ ... (5 halaman)     │
└───────────────────┘    └─────────────────────┘
```

### Saling melengkapi, bukan saling menggantikan

User bisa pakai **keduanya bersamaan**:
1. Sebagai Indexer: kelola portfolio personal mereka
2. Sebagai Publisher: publish strategi terbaik mereka untuk subscriber

Sama wallet, sama session, sama agent infrastructure. Cuma UX & framing yang berbeda.

---

## 6. User journey lengkap — contoh real

### Skenario A: User adalah trader independen

```
Day 1:
  Sign up → connect MetaMask → Indexer
  /dashboard: lihat momentum sector
  /builder: compose DePIN basket → simulate → deploy ke chain
  /portfolio: punya 1 index (HDP8)
  /agent: aktifkan autonomous loop
  
Day 7:
  Agent suggest rebalance via /chat
  User review reasoning, approve
  /history: audit semua decisions
  /risk: trigger USSI hedge saat drawdown >5%
  
Status: Indexer user, no Publisher activity
```

### Skenario B: User adalah crypto KOL

```
Day 1:
  Sign up → connect MetaMask → Indexer (test internal)
  /builder: prototype index strategy
  Test backtest, refine
  Confidence: bagus, mau publish
  
Day 2:
  Switch ke Publisher mode (klik link "→ Publisher" di topbar)
  /publisher/radar: monitor sektor untuk timing publish
  
Day 5:
  AI sektor breach → agent draft proposal
  /publisher/proposals/[id]: review + edit weights
  Set mgmtFeeBps=100 (1%) + perfFeeBps=1000 (10%)
  Sign & Publish → live di /publisher/published
  
Day 30:
  Promo di Twitter/Discord → subscribers join
  /publisher/earnings: track AUM growing
  Fee USDC stream daily ke wallet
  
Status: Publisher (primary) + Indexer (secondary, untuk testing)
```

---

## 7. Status implementasi (per tanggal dokumen ini ditulis)

| Komponen | Indexer | Publisher |
|---|---|---|
| UI / route group | ✅ Lengkap | ✅ Lengkap |
| Wallet auth (SIWE) | ✅ | ✅ |
| Builder + simulate | ✅ Real | ✅ (via PublishActions) |
| Deploy on-chain | ✅ Real (Sepolia) | ✅ Real |
| Portfolio view | ✅ Real (SSI Registry + SoDEX) | — (creator perspective belum) |
| Agent autonomous loop | ✅ Functional | — (pakai sama, tidak khusus Publisher) |
| Hype Radar | ✅ UI | ⚠️ Belum auto-alert ke creator |
| Proposal drafting | ✅ Lewat builder | ⚠️ Belum auto-draft saat radar trigger |
| **Vault for deposits** | ❌ Tidak applicable | ❌ **Belum diimplementasi** |
| **Fee distribution** | ❌ Tidak applicable | ❌ **Belum diimplementasi** |
| Subscriber discovery | ❌ Tidak applicable | ❌ Belum (perlu marketplace UI) |
| Earnings dashboard | — | ⚠️ UI ada tapi data placeholder |

**Bottom line:**
- **Indexer hampir feature-complete** untuk personal portfolio management.
- **Publisher functional dari sisi publishing**, tapi **revenue loop belum tertutup** karena vault contract & subscriber flow belum diimplementasi.

Untuk membuat Publisher truly product-ready (creator earn fee real), butuh:

1. **HypeIndexVault.sol** — ERC-4626 atau custom vault per index, accept USDC deposit, allocate per weights via SoDEX
2. **Fee accrual logic** — mgmt fee accrue per second, perf fee with HWM
3. **Daily distribution cron** — transfer fee dari vault ke creator wallet
4. **Subscriber discovery marketplace** — UI untuk browse + subscribe ke published index
5. **Reporting & tax** — earnings dashboard dengan data real

Estimasi effort: 4-8 minggu engineering untuk full Publisher loop.

---

## 8. Glossary singkat

| Istilah | Arti |
|---|---|
| **SSI** | SoSoValue Indexes — narrative-themed token baskets (DePIN, RWA, AI, dll) curated by SoSoValue |
| **SSIRegistry** | Smart contract on Sepolia yang simpan metadata index publik |
| **HypeIndex** | Naming HypeNode untuk index yang di-publish (mis. HDP8, HRWA) |
| **AUM** | Assets Under Management — total deposit yang dikelola index |
| **NAV** | Net Asset Value — nilai per share, untuk track performance |
| **HWM** | High Water Mark — peak NAV historis, untuk hitung performance fee fairly |
| **bps** | Basis points (1 bps = 0.01%); fee 100 bps = 1% |
| **SoDEX** | Decentralized exchange di ValueChain L1, untuk eksekusi trade |
| **SIWE** | Sign-In With Ethereum, standar auth wallet |
| **USSI** | Hedge instrument untuk emergency exit saat drawdown breach |
| **Agent loop** | Background LangGraph state machine yang research + propose secara autonomous |
| **Indexer** | Produk untuk personal portfolio management |
| **Publisher** | Produk untuk creator yang publish index berbayar |

---

## 9. FAQ

### Q: Apakah satu wallet bisa pakai keduanya?
**A:** Ya, sama wallet bisa connect ke kedua mode. Topbar punya tombol `→ Publisher` di Indexer dan `→ Indexer` di Publisher (atau yang setara) untuk switch context.

### Q: Apakah index yang di-publish lewat Publisher juga muncul di Indexer Portfolio creator?
**A:** Ya. Karena `creator` di SSIRegistry sama, query `/api/portfolio?address=<creator>` akan return semua index dengan `creator == address`, terlepas di-publish lewat UI mana.

### Q: Apakah subscriber Publisher juga bisa pakai Indexer?
**A:** Iya, semua user bisa pakai Indexer. Subscriber tidak terikat ke creator — mereka bisa subscribe ke banyak Publisher's index sekaligus, plus kelola portfolio sendiri di Indexer.

### Q: Bagaimana subscriber bayar fee secara on-chain?
**A:** **Belum diimplementasi.** Saat ini SSIRegistry cuma simpan `mgmtFeeBps` dan `perfFeeBps` sebagai metadata. Vault contract yang actually collect fee dari deposit subscriber + distribute ke creator wallet adalah next major engineering work.

### Q: Apakah bisa pakai HypeNode untuk DAO treasury?
**A:** Bisa via Indexer untuk passive management. Untuk DAO yang ingin bikin sub-DAO lewat publishing index dengan fee → akan butuh Publisher + vault yang support multi-sig deposit. Saat ini single-sig user EOA flow.

### Q: Apa hubungan dengan SoSoValue secara komersial?
**A:** HypeNode pakai SoSoValue OpenAPI v1 sebagai data source dengan API key tier-based. SoSoValue adalah data provider, HypeNode adalah produk konsumen yang dibangun di atasnya. Tidak ada partnership eksplisit di kode — pure REST consumer pattern.

---

## 10. Referensi cepat

- Landing page produk: [`app/page.tsx`](../app/page.tsx) — section "Two products · one agent stack"
- Indexer routes: [`app/(indexer)/`](../app/(indexer)/)
- Publisher routes: [`app/publisher/`](../app/publisher/)
- Smart contract: [`contracts/SSIRegistry.sol`](../contracts/SSIRegistry.sol)
- Agent service: [`agent-service/`](../agent-service/)
- SoSoValue API client: [`lib/api/sosovalue.ts`](../lib/api/sosovalue.ts)
- Wagmi config: [`lib/auth/wagmi.ts`](../lib/auth/wagmi.ts)
