# SoSoValue API Endpoints — Live vs Synthesized Matrix

**Total distinct endpoint patterns wired: 32**

This count is the canonical source of truth for the dashboard badge
(`SOSOVALUE_ENDPOINT_COUNT` in `lib/api/endpoints-meta.ts`). Update both
whenever a new endpoint is added or removed.

---

## Endpoint Matrix

| # | Pattern | Method | Live | Synthesized fallback? | Notes |
|---|---------|--------|------|-----------------------|-------|
| 1 | `/etfs?symbol=...&country_code=...` | GET | Yes | Yes — static IBIT/FBTC/ARKB list | ETF universe filter |
| 2 | `/etfs/{ticker}/history?...` | GET | Yes | Yes — 30d sine-wave inflow series | Daily ETF flow history |
| 3 | `/etfs/{ticker}/market-snapshot` | GET | Yes | Yes — hardcoded IBIT snapshot | Single ETF snapshot |
| 4 | `/etfs/summary-history?...` | GET | Yes | Yes — 30d cumulative series | Aggregate ETF market history |
| 5 | `/news?...` | GET | Yes | No — returns empty list `total:0` | Main news feed |
| 6 | `/news/hot?...` | GET | Yes | No — returns empty list | Last-7-day hot articles |
| 7 | `/news/featured?...` | GET | Yes | No — returns empty list | Curator-tagged featured news |
| 8 | `/news/search?...` | GET | Yes | No — returns empty page | Full-text news search |
| 9 | `/currencies/sector-spotlight` | GET | Yes | Yes — 7 sector structs | Sector momentum + spotlight |
| 10 | `/currencies` | GET | Yes | No — returns empty array | Full currency catalog |
| 11 | `/currencies/{id}/market-snapshot` | GET | Yes | Yes — all-zero snapshot | Single asset snapshot |
| 12 | `/currencies/{id}/klines?...` | GET | Yes | Yes — 90d synthetic OHLCV | **Real klines power backtests** |
| 13 | `/currencies/{id}/token-economics` | GET | Yes | No — returns null/empty | Allocation + unlock + vesting |
| 14 | `/currencies/{id}/supply?...` | GET | Yes | No — returns empty array | Daily supply rows |
| 15 | `/currencies/{id}/pairs?...` | GET | Yes | No — returns empty list | Top trading pairs |
| 16 | `/currencies/{id}/fundraising` | GET | Yes | No — returns null | Rounds, investors, team |
| 17 | `/indices` | GET | Yes | Yes — 4 ticker strings | SSI index ticker list |
| 18 | `/indices/{ticker}/constituents` | GET | Yes | Yes — 3 synthetic items | Index constituents (weight) |
| 19 | `/indices/{ticker}/market-snapshot` | GET | Yes | Yes — synthetic price/roi | SSI index snapshot |
| 20 | `/indices/{ticker}/klines?...` | GET | **Returns `[]`** | Yes — **reconstructed from constituent klines** | ⚠️ See note below |
| 21 | `/analyses` | GET | Yes | No — returns empty array | Chart metadata catalog |
| 22 | `/analyses/{chart_name}?...` | GET | Yes | No — returns empty array | Time-series data by chart name |
| 23 | `/crypto-stocks` | GET | Yes | No — returns empty array | Crypto-exposed stock list |
| 24 | `/crypto-stocks/{ticker}/market-snapshot` | GET | Yes | No — returns null | Single stock snapshot |
| 25 | `/crypto-stocks/{ticker}/market-cap?...` | GET | Yes | No — returns empty array | Historical market cap rows |
| 26 | `/crypto-stocks/{ticker}/klines?...` | GET | Yes | No — returns empty array | Stock OHLCV klines (1d only) |
| 27 | `/crypto-stocks/sectors` | GET | Yes | No — returns empty array | Crypto-stock sector list |
| 28 | `/crypto-stocks/sectors/{slug}/index?...` | GET | Yes | No — returns empty array | Sector index vs BTC/NASDAQ |
| 29 | `/macro/events` | GET | Yes | No — returns empty array | Macro calendar events |
| 30 | `/macro/events/{event}/history?...` | GET | Yes | No — returns empty array | Historical actual/forecast |
| 31 | `/btc-treasuries` | GET | Yes | No — returns empty array | BTC treasury company list |
| 32 | `/btc-treasuries/{ticker}/purchase-history?...` | GET | Yes | No — returns empty array | Daily holdings ladder |

---

## ⚠️ Honesty Notes

### Endpoint 20 — `/indices/{ticker}/klines` returns empty

Verified 2026-05-01: the live SoSoValue API returns `[]` for all SSI index
kline requests. The frontend does **not** display raw SSI klines. Instead,
`synthesizeNavKlinesFromConstituents()` (`lib/api/sosovalue.ts`) reconstructs
a weighted NAV curve from **constituent currency klines** (endpoint 12), then
rebases it to the live snapshot price (endpoint 19).

- The **shape** of the chart is real (driven by actual per-asset price moves).
- The **y-axis** is rebased to match the live SSI snapshot price.
- It is **not** raw SSI index data — it is a reconstruction.

### Per-asset backtest klines are real

The backtest engine (`agent-service/src/tools/real_backtest.py`) fetches
real daily OHLCV from `/currencies/{id}/klines` (endpoint 12) for every
constituent. Returns and portfolio metrics are computed from these real
prices — no synthetic curve is used on the `ok: True` path.

---

## What's real vs reconstructed

| Surface | Data | Source |
|---------|------|--------|
| Per-asset backtest returns | **Real** | `/currencies/{id}/klines` (endpoint 12) |
| Backtest purity seal | **Real** | Derived from actual kline timestamps |
| SSI index NAV chart | **Reconstructed** | Constituent klines → weighted NAV (endpoint 20 returns `[]`) |
| ETF fund flow (BTC) | **Real** | `/etfs/{ticker}/history` (endpoint 2) |
| Sector momentum | **Real** | `/currencies/sector-spotlight` (endpoint 9) |
| Billing top-up | **DEMO MODE** | Payment is mocked — no real money moves |

---

## Python agent-service subset

`agent-service/src/tools/terminal.py` wires a subset of these endpoints
directly (using httpx). Covered: endpoints 1, 2, 5, 9, 10, 11, 12, 17, 18,
19, 20, 16 (fundraising). All route through the same rate-limiter / cache.
