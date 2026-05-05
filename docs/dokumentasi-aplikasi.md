# HypeNode — Dokumentasi Aplikasi

> Autonomous on-chain index research → execution.
> Dibangun di atas SoSoValue Terminal, SSI Protocol, SoDEX, dan ValueChain L1.

---

## 1. Apa Itu HypeNode?

**HypeNode** adalah platform agentic-AI yang menjalankan siklus penuh **riset → drafting → eksekusi → proteksi** untuk *crypto index fund* secara otonom di on-chain.

Bayangkan seperti ini: di dunia tradisional, ada manajer hedge fund yang setiap hari membaca berita, memantau aliran dana ETF, lalu menyusun keranjang aset (basket) untuk klien. HypeNode menggantikan peran itu dengan **agen AI berbasis LangGraph + Claude 4.5** yang:

1. Memantau **11 sektor crypto** secara terus-menerus (DePIN, RWA, AI Agents, Restaking, GameFi, dll).
2. Menarik data sentimen + fund-flow ETF dari **SoSoValue Terminal**.
3. Mendeteksi *hype cluster* (lonjakan minat pasar) di atas threshold yang ditentukan user.
4. Menyusun draft index basket, melakukan backtest, lalu — setelah disetujui user — mempublikasikannya ke **SSI Protocol** dan mengeksekusi trade lewat **SoDEX** di **ValueChain L1**.
5. Memasang *risk gates* otomatis (volatilitas σ + drawdown) yang akan memicu *emergency hedge* ke USSI bila pasar memburuk.

Aplikasi ini hadir sebagai dua produk dalam satu platform — keduanya berbagi engine agen AI yang sama:

| Produk | Untuk Siapa | Halaman |
|--------|-------------|---------|
| **Indexer** | Trader/investor yang ingin mengelola index portofolio sendiri | 10 halaman (`/dashboard`, `/research`, `/builder`, `/agent`, `/portfolio`, `/risk`, `/history`, `/chat`, `/backtest`, `/settings`) |
| **Publisher** | Creator yang ingin **menerbitkan index** untuk diikuti orang lain dan mendapat fee | 6 halaman (`/publisher/radar`, `/proposals`, `/published`, `/earnings`, `/config`) |

---

## 2. Indexer — "Kelola Index Sendiri"

### Apa Itu Indexer?

**Indexer** adalah surface untuk pengguna yang ingin **menjalankan index portofolio milik sendiri** secara end-to-end. Targetnya: *active trader*, *crypto-native fund manager*, atau *power user* yang ingin algoritma trading otonom dengan kontrol penuh.

### Kapabilitas Utama

- **LangGraph Agent Console** — Visualisasi *state machine* 10-node (`signal → research → draft → backtest → review → execute → monitor → risk → hedge → settle`) dengan reasoning trace live yang di-stream tiap 5 detik.
- **MCP Chat** — Berkomunikasi dengan agen menggunakan bahasa natural. Misalnya: *"Buatkan basket DePIN dengan bobot likuiditas, kecualikan token dengan mcap < $50M"*. Agen menerjemahkan ke pemanggilan tool MCP.
- **Backtesting Lab** — Uji strategi terhadap benchmark BTC, ETH, atau sektor lain dengan rentang historis 90 hari, 1 tahun, atau custom.
- **Risk Control Panel** — Atur σ threshold dan drawdown gate per index. Saat tertabrak, agen otomatis me-rotate aset ke USSI (stable hedge instrument di ValueChain) dalam satu transaksi (~$0.04).
- **Panic Button** — Unwind seluruh basket dalam satu klik bila market crash.

### Workflow Pengguna Indexer

```
1. Login dengan wallet (RainbowKit/viem)
2. Pilih sektor target di /research
3. Agent draft basket di /builder
4. Review reasoning + backtest di /agent + /backtest
5. Sign transaksi → publish ke SSI Protocol
6. Monitor di /portfolio · agent rebalance harian otomatis
```

---

## 3. Publisher — "Terbitkan Index, Dapatkan Fee"

### Apa Itu Publisher?

**Publisher** adalah *creator product* — mirip "Substack untuk crypto index". Creator membuat index yang menarik (memanfaatkan agen AI untuk drafting), lalu **subscriber** lain bisa berlangganan index tersebut. Setiap subscriber yang mengikuti index akan otomatis membayar **fee** ke wallet creator.

### Kapabilitas Utama

- **Hype Radar** (`/publisher/radar`) — Dashboard live yang menampilkan sektor mana sedang spike. Misalnya: "DePIN +340% sentiment dalam 1 jam" — sinyal untuk creator agar segera draft index DePIN baru.
- **Agent-Drafted Proposals** (`/publisher/proposals`) — Agen AI otomatis menyusun proposal index berdasarkan radar. Creator tinggal **approve / reject / edit** — tidak perlu riset manual lama.
- **Published Indices** (`/publisher/published`) — Daftar semua index yang sudah live, jumlah subscriber, AUM (Asset Under Management), dan performance.
- **Earnings Dashboard** (`/publisher/earnings`) — Real-time tracking management fee + performance fee yang masuk ke wallet (dalam USDC), beserta tax report.
- **Creator Rank** — Sistem reputasi: makin tinggi Sharpe ratio dan jumlah subscriber, makin tinggi rank → makin mudah menarik subscriber baru.

### Workflow Creator

```
1. Daftar sebagai publisher · connect wallet
2. Pantau /radar saat ada hype spike
3. Agent draft proposal otomatis di /proposals
4. Review · approve · publish ke SSI Protocol
5. Subscriber datang dengan sendirinya (browse SSI registry)
6. Fee streaming harian ke wallet · withdraw kapanpun
```

---

## 4. Apa yang Membuat HypeNode Menarik?

### a. **Agen AI Bukan Sekadar Chatbot**

Banyak produk AI di crypto cuma "chat untuk lihat harga". HypeNode menjalankan **state-machine multi-step** dengan 10 node + reasoning trace yang transparan. User bisa **melihat alasan** di balik setiap keputusan agen — bukan black-box.

### b. **Research-to-Execution dalam Satu Loop**

Biasanya alur trading itu: pakai TradingView untuk analisis → pindah ke spreadsheet untuk basket allocation → pindah lagi ke DEX untuk eksekusi. HypeNode **menyatukan semuanya dalam satu agen**: dari sentimen mentah sampai trade settled, rata-rata < 4 jam.

### c. **Risk Gates yang Bisa Ditangani Otomatis**

Sebagian besar trader retail kena *liquidation* karena tidak ada hedging otomatis. HypeNode pasang **USSI emergency hedge** yang trigger dalam satu transaksi tanpa intervensi manusia — penting saat user sedang tidur atau sibuk.

### d. **Dual Product di Satu Stack**

- **Indexer**: untuk mereka yang trading untuk diri sendiri.
- **Publisher**: untuk mereka yang ingin **monetisasi keahlian** ke pasar.

Satu engine, dua persona — strategi go-to-market yang efisien.

### e. **Built on Production-Grade Infrastructure**

| Layer | Tech |
|-------|------|
| Frontend | Next.js 14/15 RSC · React 18 · Tailwind |
| Backend | Node.js + Python FastAPI |
| Agent | LangGraph · Claude 4.5 · MCP server (7 tools) |
| Data | SoSoValue Terminal · CoinGecko · Pyth |
| On-chain | SSI Protocol · SoDEX · ValueChain L1 · USSI hedge |
| Wallet | RainbowKit · viem (signing tetap di sisi user) |

User mendapatkan keamanan: **private key tidak pernah disentuh agen** — semua signature lewat wallet user (EIP-712 typed data).

### f. **Fallback Synthetic Data**

Untuk demo / onboarding tanpa API key, semua endpoint sudah punya synthetic data yang berbentuk identik dengan response asli. UI testable end-to-end **tanpa biaya API**.

---

## 5. Problem yang Diselesaikan

### Problem #1: **Information Overload**
Crypto bergerak 24/7, ribuan token, ratusan narasi. Trader retail tidak punya waktu/tenaga membaca semua.
→ **Solusi:** Agen AI ingest SoSoValue Terminal news + fund flows otomatis, lalu *cluster* jadi sektor yang actionable.

### Problem #2: **Lambatnya "Signal-to-Trade"**
Antara membaca berita "DePIN sektor pump" sampai benar-benar punya posisi DePIN basket — bisa 1–2 hari (riset, susun basket, beli satu per satu di DEX).
→ **Solusi:** HypeNode kompres ke **< 4 jam** dari signal sampai live index.

### Problem #3: **Risiko Tanpa Hedging Otomatis**
Volatilitas tinggi tanpa stop-loss otomatis = liquidation. Hedging manual butuh selalu *online*.
→ **Solusi:** Risk gates (σ + drawdown) + USSI auto-hedge → posisi diproteksi otomatis.

### Problem #4: **Sulitnya Monetisasi Keahlian Trader**
Trader bagus seringkali cuma share signal di Telegram gratis. Tidak ada infrastruktur on-chain untuk **menerbitkan strategi** dengan fee streaming.
→ **Solusi:** Publisher product → setiap creator bisa publish index ke SSI Protocol dan dapat fee streaming USDC harian.

### Problem #5: **Black-box AI Trading**
Robo-trading lain seringkali tidak transparan keputusannya.
→ **Solusi:** LangGraph reasoning trace tampil live + setiap publish/rebalance tetap butuh **signature user** (kecuali di-toggle auto-publish).

### Problem #6: **Onboarding Berat untuk Index Investing**
Membuat index fund crypto yang real biasanya butuh tim hukum + smart contract custom.
→ **Solusi:** SSI Protocol sebagai standar wrap → satu form, langsung live di on-chain.

---

## 6. Bagaimana HypeNode Menarik User?

### Strategi Akuisisi

#### a. **Free Trial 14 Hari Tanpa Kartu Kredit**
Hero CTA: *"Start free trial · no card · 14 days"*. Friction onboarding minimal — user bisa langsung *test drive* dengan wallet sendiri.

#### b. **Live Preview di Landing Page**
Halaman utama menampilkan **panel dashboard live** dengan portfolio NAV, sektor hype gauges, dan agent activity feed yang seolah berjalan real-time. User tidak perlu signup untuk merasakan UX produk.

#### c. **Synthetic Data Mode**
Tanpa API key apapun, full app tetap jalan. Onboarding "lihat dulu, bayar nanti" — sangat mengurangi *cognitive friction* bagi crypto-native user.

#### d. **Two Persona Funnel**
- Trader retail → masuk lewat **Indexer**.
- Influencer/analyst → masuk lewat **Publisher** (potential supply-side).
- Subscriber → masuk lewat marketplace SSI (browse index publisher).

Tiga sumber traffic mengisi marketplace yang sama → *flywheel network effect*.

#### e. **Creator Economy Hook**
Publisher → creator yang sukses akan promosi sendiri (Twitter, Discord) untuk menarik subscriber. **Marketing distribusi gratis** lewat creator.

#### f. **Built on Recognized Brands**
Logo SoSoValue, SSI Protocol, SoDEX, ValueChain di hero — instant credibility untuk crypto-native audience yang sudah familiar dengan brand-brand ini.

#### g. **Numbers Marketing**
- 11 sectors monitored continuously
- 7 MCP tools agen dipakai
- 2.14 avg Sharpe
- < 4h dari signal ke live index

Angka konkret = trust signal.

#### h. **Konten Educational**
Reasoning trace terbuka → user bisa **belajar** strategi agen → user merasa lebih pintar setelah pakai produk → loyalty meningkat.

---

## 7. Bagaimana HypeNode Menghasilkan Pendapatan?

HypeNode punya **multiple revenue streams** — kombinasi SaaS subscription + on-chain fee.

### Stream #1: **Subscription Tiers (SaaS)**

| Tier | Cakupan | Target |
|------|---------|--------|
| **Free** | Indexer + 1 published index, rate-limit basic | Onboarding + trader retail |
| **Pro** | 10× rate-limit Terminal API, unlimited published indices | Active trader + creator serius |
| **Enterprise** | Metered + private agent deployment | Funds, family office, institusional |

Revenue: **MRR berulang per akun**, rate-limit di-enforce di [lib/api/sosovalue.ts](lib/api/sosovalue.ts) (Demo tier 1 req/min, Pro 1 req/sec, dst).

### Stream #2: **Management Fee dari Publisher Indices**

Default **1%/tahun** dari Asset Under Management (AUM) tiap index. Sebagian besar streaming ke creator, **HypeNode platform fee mengambil persentase** (mis. 20% dari fee tersebut sebagai *platform cut*).

Contoh hitungan:
- Index dengan AUM $10M, management fee 1%/yr = $100,000/yr
- Platform cut 20% = **$20,000/yr per index**
- 100 index aktif × rata-rata AUM $5M = $1M/yr revenue passive

### Stream #3: **Performance Fee dari Publisher Indices**

Default **10% high-water mark**. Saat index outperform, fee dipotong. Sama seperti management fee, platform mengambil cut.

Contoh:
- Index NAV naik dari $1M ke $1.2M (gain $200K)
- Performance fee 10% = $20K
- Platform cut 20% = **$4K per realisasi gain**

### Stream #4: **Trading Fee Margin (SoDEX Routing)**

Setiap trade yang dieksekusi via SoDEX router potensial mengambil **rebate** atau **routing fee margin** (~0.05% – 0.1% per execution). Dengan volume eksekusi tinggi (tiap rebalance = puluhan trade), ini agregasi-nya signifikan.

### Stream #5: **API & MCP Server Lisensi (Future)**

MCP server yang expose 7 tools agen bisa dijual sebagai **standalone API** untuk developer lain yang ingin membangun produk turunan. Roadmap: `mcp.hypenode.ai` sebagai public endpoint berbayar.

### Stream #6: **Private Agent Deployment (Enterprise)**

Hedge fund / family office yang butuh agen ter-deploy di infrastruktur sendiri (compliance, custody) bayar **lisensi enterprise** + ongoing support contract.

### Stream #7: **Data Feed Premium**

Dengan data sentimen + fund flow yang sudah ter-aggregate, HypeNode bisa **resell processed signals** sebagai data feed premium ke quant funds di luar platform.

---

## 8. Kesimpulan: Mengapa HypeNode Menarik secara Bisnis

### Defensible Moat
1. **Data lock-in**: integrasi dalam dengan SoSoValue Terminal — kompetitor harus rebuild ingest pipeline.
2. **Network effect**: makin banyak publisher → makin banyak index → makin banyak subscriber → menarik lebih banyak publisher.
3. **Workflow lock-in**: setelah user setup risk gates + automation, switching cost tinggi.

### Skalabilitas
- **Cost agen**: dominan biaya LLM + MCP. Bisa di-cache (lihat 15-menit in-memory cache di kode) → cost per user turun seiring volume.
- **Cost on-chain**: ValueChain L1 punya fee rendah (~$0.04 per hedge tx) → marjin terjaga.
- **Skalabilitas horizontal**: tiap publisher = revenue node tanpa marginal CAC dari platform.

### Risiko & Mitigasi

| Risiko | Mitigasi |
|--------|----------|
| Ketergantungan pada SoSoValue API | Fallback synthetic + roadmap multi-source (CoinGecko, Pyth) |
| Anthropic API outage | `ANTHROPIC_API_KEY` empty → echo response, agent tetap operasional dengan rules-based fallback |
| Smart contract risk | Hedge ke USSI battle-tested; SSI Protocol audited |
| Regulasi (SEC/securities) | Trial 14 hari + KYC tier untuk Pro+ |

---

## 9. Referensi Cepat

- **Stack**: Next.js 14 · React 18 · Tailwind 3 · TypeScript · Python 3.11 · FastAPI · LangGraph · MCP SDK · viem · RainbowKit
- **API surface**: 13 Next.js route handlers di [app/api/](../app/api/)
- **Agent**: 10-node state machine di [agent-service/src/graph.py](../agent-service/src/graph.py)
- **MCP Tools (7)**: terminal · ssi · sodex · risk · backtest · — terdaftar di [agent-service/src/mcp_server.py](../agent-service/src/mcp_server.py)
- **Build output**: 30 routes (16 pages · 13 API handlers · landing · 404)

---

*Dokumen ini disusun berdasarkan kode aplikasi, README, dan landing page sebagaimana ada pada 2026-05-01.*
