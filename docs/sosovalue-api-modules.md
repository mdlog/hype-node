# SoSoValue OpenAPI v1 — Referensi 9 Modul Lengkap

> Catatan komprehensif seluruh 33 endpoint dari [sosovalue-1.gitbook.io/sosovalue-api-doc](https://sosovalue-1.gitbook.io/sosovalue-api-doc), dengan cross-reference ke implementasi HypeNode di [lib/api/sosovalue.ts](../lib/api/sosovalue.ts) dan [agent-service/src/tools/terminal.py](../agent-service/src/tools/terminal.py).
>
> Disusun: 2026-05-02 · Base URL: `https://openapi.sosovalue.com/openapi/v1`

---

## 1. Ringkasan Akses

### Authentication

Header tunggal:

```
x-soso-api-key: <YOUR_API_KEY>
```

API key didapat dari [https://sosovalue.com/developer/dashboard](https://sosovalue.com/developer/dashboard) — klik **"Apply your Key"** → isi form → tunggu approval.

### Rate Limit

| Tier | per Menit | per Jam | per Hari | Bulanan |
|------|-----------|---------|----------|---------|
| **Standard** | 20 | 1,200 | 28,800 | 100,000 |

> Demo tier (1 req/menit) terlihat di codebase (`SOSOVALUE_MIN_GAP_MS=65000`) — itu adaptasi internal HypeNode untuk free tier yang dilonggarkan ke 0.7 detik di [.env](../agent-service/.env) untuk Standard tier.

### Response Envelope

Semua endpoint membungkus dalam wrapper:

```json
{ "code": 0, "message": "success", "data": <payload> }
```

`code: 0` = sukses. `code: <non-zero>` = error.

### Query Modes

**Pagination** (untuk list non-time-series):
- `page` (int, default 1)
- `page_size` (int, default 20, max 100)

**Time Window** (untuk time-series — klines / ETF history / news):
- `start_time` / `end_time` (long, Unix ms)
- `limit` (int)

**Time-range constraints:**
| Data Type | Range |
|-----------|-------|
| Klines | 3 bulan terakhir (interval `1d` only) |
| ETF history | 1 bulan terakhir |
| Feeds | 7 hari terakhir |

### Error Codes

| Code | HTTP | Arti |
|------|------|------|
| 400001 | 400 | Invalid parameter format |
| 400002 | 400 | Missing required parameter |
| 400003 | 400 | Invalid parameter value |
| 400101 | 401 | Invalid API key |
| 400102 | 401 | API key expired |
| 400301 | 403 | Insufficient permissions |
| 400401 | 404 | Resource not found |
| 400402 | 404 | Endpoint not found |
| 402901 | 429 | Rate limit triggered |
| 500001 | 500 | Internal server error |
| 500301 | 503 | Service maintenance |

---

## 2. Modul 1 — Currency & Pairs

| # | Method | Path | Status di HypeNode |
|---|--------|------|--------------------|
| 1.1 | GET | `/currencies` | ❌ belum dipakai |
| 1.2 | GET | `/currencies/{currency_id}` | ⚠️ tidak via fetch eksplisit |
| 1.3 | GET | `/currencies/{currency_id}/market-snapshot` | ✅ dipakai |
| 1.4 | GET | `/currencies/{currency_id}/token-economics` | ❌ belum (hanya cache regex) |
| 1.5 | GET | `/currencies/{currency_id}/klines` | ✅ dipakai |
| 1.6 | GET | `/currencies/{currency_id}/supply` | ❌ belum |
| 1.7 | GET | `/currencies/{currency_id}/pairs` | ❌ belum (hanya cache regex) |
| 1.8 | GET | `/currencies/sector-spotlight` | ✅ dipakai |
| 1.9 | GET | `/currencies/{currency_id}/fundraising` | ❌ belum |

### 1.1 List Currencies — `GET /currencies`

Tanpa parameter. Return array `{ currency_id, symbol, name }`.

### 1.2 Currency Info — `GET /currencies/{currency_id}`

Profil lengkap aset: `name`, `symbol`, `introduction`, `sector[]`, `icon`, `contracts[]`, `white_paper`, `first_issue_time`, `explorers[]`, `community.{twitter, reddit}`, `significant_events[]`.

### 1.3 Market Snapshot — `GET /currencies/{currency_id}/market-snapshot`

Snapshot 24 jam: `price`, `change_pct_24h`, `turnover_24h`, `turnover_rate`, `high_24h`, `low_24h`, `marketcap`, `fdv`, `max_supply`, `total_supply`, `circulating_supply`, `ath`, `ath_date`, `down_from_ath`, `cycle_low`, `cycle_low_date`, `up_from_cycle_low`, `marketcap_rank`.

### 1.4 Token Economics — `GET /currencies/{currency_id}/token-economics`

Token allocation + unlock schedule:
- `token_allocation[].{holder, percentage}`
- `token_unlock.{unlocked, total_locked}`
- `unlock_timeline[].{vestings[].{label, amount}, timestamp}`

### 1.5 Klines — `GET /currencies/{currency_id}/klines`

Query: `interval` (wajib, only `1d`), `start_time`, `end_time`, `limit` (default 100, max 500). Return array `{ timestamp, open, high, low, close, volume }`. **Window: 3 bulan max.**

### 1.6 Supply History — `GET /currencies/{currency_id}/supply`

Query: `start_date`, `end_date`, `page`, `page_size`. Return `{ date, max_supply, total_supply, circulating_supply }`.

### 1.7 Trading Pairs — `GET /currencies/{currency_id}/pairs`

Query: `page`, `page_size`, `order_by` (default 24h volume desc), `exchange` (filter). Return `{ list[{base, target, market, price, turnover_24h, cost_to_move_up_usd, cost_to_move_down_usd}], page, page_size, total }`.

### 1.8 Sector Spotlight — `GET /currencies/sector-spotlight`

Tanpa param. Return `{ sector[{name, 24h_change_pct, marketcap_dom}], spotlight[{name, 24h_change_pct}] }`.

### 1.9 Currency Fundraising — `GET /currencies/{currency_id}/fundraising`

Detail funding aset spesifik: `fundraising_rounds[]`, `investors[]`, `team[]`, `investment_stats`, `portfolio[]`.

---

## 3. Modul 2 — ETF

| # | Method | Path | Status |
|---|--------|------|--------|
| 2.1 | GET | `/etfs` | ✅ dipakai |
| 2.2 | GET | `/etfs/summary-history` | ✅ dipakai |
| 2.3 | GET | `/etfs/{ticker}/market-snapshot` | ❌ belum |
| 2.4 | GET | `/etfs/{ticker}/history` | ✅ dipakai |

### 2.1 ETF List — `GET /etfs`

Query **wajib**: `symbol` (BTC, ETH, SOL, LTC, HBAR, XRP, DOGE, LINK, AVAX, DOT) + `country_code` (US, HK). Return `[{ ticker, name, exchange }]`.

### 2.2 Summary History — `GET /etfs/summary-history`

Query: `symbol` (wajib), `country_code` (wajib), `start_date`, `end_date`, `limit` (default 50, max 300). Return `{ date, total_net_inflow, total_value_traded, total_net_assets, cum_net_inflow }`. **Window: 1 bulan.**

### 2.3 ETF Market Snapshot — `GET /etfs/{ticker}/market-snapshot`

Snapshot single ETF saat ini: `date`, `ticker`, `sponsor_fee`, `net_inflow`, `cum_inflow`, `net_assets`, `mkt_price`, `prem_dsc`, `value_traded`, `volume`.

### 2.4 ETF History — `GET /etfs/{ticker}/history`

Query: `start_date`, `end_date`, `limit` (default 50, max 300). Return `{ date, ticker, net_inflow, cum_inflow, net_assets, currency_share, prem_dsc, value_traded, volume }`. **Window: 1 bulan.**

---

## 4. Modul 3 — SoSoValue Index

| # | Method | Path | Status |
|---|--------|------|--------|
| 3.1 | GET | `/indices` | ✅ dipakai |
| 3.2 | GET | `/indices/{index_ticker}/constituents` | ✅ dipakai |
| 3.3 | GET | `/indices/{index_ticker}/market-snapshot` | ✅ dipakai |
| 3.4 | GET | `/indices/{index_ticker}/klines` | ✅ dipakai |

### 3.1 Index List — `GET /indices`

Tanpa param. Return array string ticker: `["ssimag7", "ssilayer1", ...]`.

### 3.2 Constituents — `GET /indices/{index_ticker}/constituents`

Return `[{ currency_id, symbol, weight }]`. Weight 0–1.

> Note: HypeNode memperkaya output ini dengan `marketcap`, `change_pct_24h`, `marketcap_rank` lewat join client-side ke `market-snapshot`.

### 3.3 Index Market Snapshot — `GET /indices/{index_ticker}/market-snapshot`

`{ price, 24h_change_pct, 7day_roi, 1month_roi, 3month_roi, 1year_roi, ytd }`.

### 3.4 Index Klines — `GET /indices/{index_ticker}/klines`

Query: `interval` (only `1d`), `start_time`, `end_time`, `limit` (default 100, max 500). Return `{ timestamp, open, high, low, close }`. **Window: 3 bulan.**

---

## 5. Modul 4 — Crypto Stocks  ❌ *belum ada di codebase*

| # | Method | Path | Status |
|---|--------|------|--------|
| 4.1 | GET | `/crypto-stocks` | ❌ |
| 4.2 | GET | `/crypto-stocks/{stock_ticker}/market-snapshot` | ❌ |
| 4.3 | GET | `/crypto-stocks/{stock_ticker}/market-cap` | ❌ |
| 4.4 | GET | `/crypto-stocks/{stock_ticker}/klines` | ❌ (cache regex saja) |
| 4.5 | GET | `/crypto-stocks/sector` | ❌ |
| 4.6 | GET | `/crypto-stocks/sector/{sector_name}/index` | ❌ |

### 4.1 Crypto Stocks List — `GET /crypto-stocks`

Tanpa param. Return `[{ ticker, name, exchange, sector, introduction, social_media{website, twitter}, listing_time }]`. Contoh: TSLA, MSTR.

### 4.2 Stock Market Snapshot — `GET /crypto-stocks/{stock_ticker}/market-snapshot`

`{ timestamp, ticker, mkt_price, mkt_status, volume, turnover, circulating_marketcap, total_marketcap, total_shares, circulating_shares, pe_ttm, pb }`.

### 4.3 Market Cap History — `GET /crypto-stocks/{stock_ticker}/market-cap`

Query: `start_date`, `end_date`, `limit` (default 50, max 100). Return `{ date, market-cap }`.

### 4.4 Stock Klines — `GET /crypto-stocks/{stock_ticker}/klines`

Query: `interval` (only `1d`), `start_time`, `end_time`, `limit` (default 100, max 500). Return `{ timestamp, open, high, low, close, volume }`. **Window: 3 bulan.**

### 4.5 Sector List — `GET /crypto-stocks/sector`

Return `[{ sector_name, total_marketcap, change_pct_24h }]`. Contoh: "btc treasury", "all".

### 4.6 Sector Index History — `GET /crypto-stocks/sector/{sector_name}/index`

Query: `start_date`, `end_date`, `limit` (default 100, max 200). Return `{ date, price, btc_price, nasdaq100_index }`.

---

## 6. Modul 5 — BTC Treasuries  ❌ *belum ada di codebase*

| # | Method | Path | Status |
|---|--------|------|--------|
| 5.1 | GET | `/btc-treasuries` | ❌ |
| 5.2 | GET | `/btc-treasuries/{ticker}/purchase-history` | ❌ |

### 5.1 Treasury List — `GET /btc-treasuries`

Tanpa param. Return `[{ ticker, name, list_location }]`. Perusahaan publik yang hold BTC di treasury (TSLA, MSTR, dll).

### 5.2 Purchase History — `GET /btc-treasuries/{ticker}/purchase-history`

Query: `start_date`, `end_date`, `limit` (default 50, max 100). Return `[{ date, ticker, btc_holding, btc_acq, acq_cost, avg_btc_cost }]`. Track akumulasi BTC corporate.

---

## 7. Modul 6 — Feeds (News)

| # | Method | Path | Status |
|---|--------|------|--------|
| 6.1 | GET | `/news` | ✅ dipakai |
| 6.2 | GET | `/news/hot` | ❌ belum |
| 6.3 | GET | `/news/featured` | ❌ belum |
| 6.4 | GET | `/news/search` | ❌ belum |

### 6.1 News Feed — `GET /news`

Query: `category` (1=news, 2=research, 3=institution, 4=insights/KOL, 7=announcement, 13=crypto stock), `language` (en, zh, tc, ja, vi, es, pt, ru, tr, fr), `currency_id`, `project_id`, `page`, `page_size` (max 100), `start_time`, `end_time`. **Window: 7 hari.**

Response item: `{ id, title, content (HTML), release_time, author, impressions, likes, replies, retweets, matched_currencies[], tags[], media_info[], quote_info? }`.

### 6.2 Hot News — `GET /news/hot`

Trending clusters. Query: `page`, `page_size` (max 100), `language`, `start_time`, `end_time`. Return `{ id, source_link, create_time, title, content }`.

### 6.3 Featured News — `GET /news/featured`

Editorially curated, no engagement metrics. Query: `page` (wajib), `page_size` (wajib, 20-100), `language`, `category[]`. Return item dengan `feature_image`, `is_blue_verified`, `nick_name` extra.

### 6.4 News Search — `GET /news/search`

Query: `keyword` (wajib), `page`, `page_size` (max 50), `category`, `sort` (`relevance` default atau `publish_time`). Return item dengan `highlight.{title, content}` (HTML highlighting).

---

## 8. Modul 7 — Fundraising  ❌ *belum ada di codebase*

| # | Method | Path | Status |
|---|--------|------|--------|
| 7.1 | GET | `/fundraising/projects` | ❌ |
| 7.2 | GET | `/fundraising/projects/{project_id}` | ❌ |

### 7.1 Project List — `GET /fundraising/projects`

Tanpa param. Return `[{ project_id, project_name }]`.

### 7.2 Project Detail — `GET /fundraising/projects/{project_id}`

Profil lengkap project + investor: `fundraising_rounds[]`, `investors[]`, `team[]`, `investment_stats`, `portfolio[]` (dengan `is_lead_investor` flag).

---

## 9. Modul 8 — Macro  ❌ *belum ada di codebase*

| # | Method | Path | Status |
|---|--------|------|--------|
| 8.1 | GET | `/macro/events` | ❌ |
| 8.2 | GET | `/macro/events/{event}/history` | ❌ |

### 8.1 Macro Events — `GET /macro/events`

Tanpa param. Return `[{ date, events[] }]`. Contoh: `{ date: "2026-03-03", events: ["Nonfarm Payrolls", "CPI"] }`.

### 8.2 Event History — `GET /macro/events/{event}/history`

Query: `start_date`, `end_date`, `limit` (default 50, max 100). Return `[{ date, actual, forecast, previous }]`. Track performa indikator vs forecast.

---

## 10. Modul 9 — Analysis Charts  ❌ *belum ada di codebase*

| # | Method | Path | Status |
|---|--------|------|--------|
| 9.1 | GET | `/analyses` | ❌ |
| 9.2 | GET | `/analyses/{chart_name}` | ❌ |

### 9.1 Chart List — `GET /analyses`

Tanpa param. Return metadata chart: `{ chart_name, time_field, fields[{name, type}] }`. Contoh chart: `stablecoin_total_market_cap` (fields: mcap, usdt, usdc, usds, usde, pyusd, usdd).

### 9.2 Chart Data — `GET /analyses/{chart_name}`

Query: `start_time`, `end_time`, `limit` (default 100, max 500). Return time-series dengan field dynamic per chart.

---

## 11. Ringkasan Pemakaian di HypeNode

### ✅ Sudah dipakai (12 endpoint, 36% dari total)

| Endpoint | Lokasi |
|----------|--------|
| `/currencies/{id}` | [terminal.py](../agent-service/src/tools/terminal.py) |
| `/currencies/{id}/market-snapshot` | [sosovalue.ts](../lib/api/sosovalue.ts) + terminal.py |
| `/currencies/{id}/klines` | sosovalue.ts + terminal.py |
| `/currencies/sector-spotlight` | sosovalue.ts + terminal.py |
| `/etfs` | sosovalue.ts |
| `/etfs/summary-history` | sosovalue.ts (history page) |
| `/etfs/{ticker}/history` | sosovalue.ts |
| `/indices` | sosovalue.ts + terminal.py |
| `/indices/{ticker}/constituents` | sosovalue.ts + terminal.py |
| `/indices/{ticker}/market-snapshot` | sosovalue.ts |
| `/indices/{ticker}/klines` | sosovalue.ts |
| `/news` | sosovalue.ts + terminal.py |

### ❌ Belum dipakai (21 endpoint, 64% dari total)

**Currency module (4):**
- `/currencies` — list semua aset
- `/currencies/{id}/token-economics` — vesting + allocation
- `/currencies/{id}/supply` — historical supply
- `/currencies/{id}/pairs` — exchange + cost-to-move
- `/currencies/{id}/fundraising` — investor profile per token

**ETF module (1):**
- `/etfs/{ticker}/market-snapshot` — snapshot single ETF

**Crypto Stocks module (6):**
- `/crypto-stocks` (list, snapshot, market-cap, klines, sector, sector-index)

**BTC Treasuries module (2):**
- `/btc-treasuries` + purchase-history

**News module (3):**
- `/news/hot`, `/news/featured`, `/news/search`

**Fundraising module (2):**
- `/fundraising/projects` + detail

**Macro module (2):**
- `/macro/events` + history

**Analysis module (2):**
- `/analyses` + data

---

## 12. Peluang Fitur Baru dari Endpoint yang Belum Dipakai

### 🔥 High-Value (mudah implementasi, dampak besar)

| Endpoint | Fitur Potensial | Halaman Target |
|----------|-----------------|----------------|
| `/news/featured` + `/news/hot` | "Trending today" panel di Hype Radar (Publisher) | `/publisher/radar` |
| `/news/search` | Search box di research page untuk filter berita per keyword | `/research` |
| `/macro/events` + history | Macro calendar widget (FOMC, CPI, NFP) — agen bisa avoid execution di ±24h sekitar event | `/dashboard`, agent risk gate |
| `/btc-treasuries/{ticker}/purchase-history` | "Smart money" tracker — alert saat MSTR/TSLA akumulasi BTC | `/dashboard` widget |
| `/crypto-stocks/sector/{name}/index` | Cross-asset benchmark — bandingkan basket vs NASDAQ100 / sektor BTC treasury stocks | `/backtest` |

### 📈 Medium-Value (research feature baru)

| Endpoint | Fitur Potensial |
|----------|-----------------|
| `/currencies/{id}/token-economics` | Vesting unlock alert — agen warning kalau ada major unlock dalam 7 hari |
| `/currencies/{id}/pairs` | Liquidity check — `cost_to_move_up_usd` jadi input risk gate konkret (slippage estimation) |
| `/currencies/{id}/fundraising` | Tag aset "VC-backed by Paradigm/a16z" untuk filter basket |
| `/fundraising/projects` | Pre-launch tracker — daftar token yang sedang/baru fundraising |
| `/analyses/stablecoin_total_market_cap` | Stablecoin flow widget — proxy untuk risk-on/off sentiment |

### 🛡️ Risk & Compliance

| Endpoint | Use Case |
|----------|----------|
| `/macro/events/CPI/history` | Backtest correlation antara CPI surprise dan crypto drawdown |
| `/etfs/{ticker}/market-snapshot` | Real-time ETF premium/discount alert (`prem_dsc` field) — stress signal |

---

## 13. Konfigurasi di HypeNode

### Next.js side ([lib/api/sosovalue.ts](../lib/api/sosovalue.ts))

```bash
SOSOVALUE_API_KEY=<key>
SOSOVALUE_API_BASE=https://openapi.sosovalue.com/openapi/v1
SOSOVALUE_MIN_GAP_MS=65000     # Demo tier (1/min)
SOSOVALUE_CACHE_TTL_MS=900000  # 15 menit
SOSOVALUE_FETCH_TIMEOUT_MS=5000
```

Untuk paid Standard tier, turunkan ke:
```bash
SOSOVALUE_MIN_GAP_MS=3000      # 20/min → 1 req per 3s
SOSOVALUE_CACHE_TTL_MS=60000   # 60s
```

### Python side ([agent-service/.env](../agent-service/.env))

```bash
SOSOVALUE_API_KEY=<key>
SOSOVALUE_MIN_GAP_SEC=0.7      # Standard tier (~85/min margin)
SOSOVALUE_CACHE_TTL_SEC=60
SOSOVALUE_QUOTA_BACKOFF_SEC=1800
```

### Pola fallback otomatis

Di [request() helper](../lib/api/sosovalue.ts#L359):
- Tanpa `SOSOVALUE_API_KEY` → langsung synthetic.
- Cache fresh → serve cached.
- Rate-limited / quota exhausted / 401 / 403 → cache → synthetic fallback.
- Real fetch dilakukan saat tidak ada satupun kondisi di atas.

---

*Dokumen ini disusun otomatis dari [sosovalue-1.gitbook.io/sosovalue-api-doc](https://sosovalue-1.gitbook.io/sosovalue-api-doc) sitemap (50+ halaman). Update saat SoSoValue rilis endpoint baru atau v2 API.*
