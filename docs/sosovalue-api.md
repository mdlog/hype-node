# SoSoValue OpenAPI v1 — Catalog

Reference for everything we know about the SoSoValue API.
Source: <https://sosovalue-1.gitbook.io/sosovalue-api-doc>

**Base URL**: `https://openapi.sosovalue.com/openapi/v1`
**Auth header**: `x-soso-api-key: <YOUR_KEY>` on every request.

---

## 0. Foundational

### Response envelope (every endpoint)

```json
{ "code": 0, "message": "success", "data": <object|array|null> }
```

- Success: `code = 0`.
- Pagination payload (`data`): `{ list: [], page, page_size, total }`.
- Time-series payload (`data`): bare array `[{...}]`.
- Empty: `data: null`.

### Query modes

- **Pagination**: `page` (default 1), `page_size` (default 20, max 100 — news max 200).
- **Time window**: `start_time`, `end_time` (long, **UTC ms**), `limit` (per-endpoint max). Returns ascending; cursor by `last.timestamp + 1`. With no times → most-recent `limit` records.
- **Window caps**: klines = recent **3 months**, ETF history = recent **1 month**, feeds time filters = recent **7 days**. Klines `interval` only supports `1d`.
- **Naming**: `snake_case`. Money in USD. Timestamps UTC ms.

### Rate limiting

- Per API key. Baseline documented: **20 req/min, 100,000 req/month**. Paid tiers (e.g. High Frequency = 100 req/min) are not documented in the open docs but are honored by the backend.
- Response headers: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset` (ms).
- 429 body: `{ code: 402901, message: "Too many requests" }` (note: news doc says `42901` but the error-code table is the source of truth → use `402901`).

### Error codes

Body shape: `{ code, message, details?: { field, value, issue|constraint|suggestion } }`.

| Code   | HTTP | Meaning                       |
| ------ | ---- | ----------------------------- |
| 400001 | 400  | Invalid parameter format      |
| 400002 | 400  | Missing required parameter    |
| 400003 | 400  | Invalid parameter value       |
| 400101 | 401  | Invalid API key               |
| 400102 | 401  | API key expired               |
| 400301 | 403  | Insufficient permissions      |
| 400401 | 404  | Resource not found            |
| 400402 | 404  | Endpoint not found            |
| 402901 | 429  | Too many requests             |
| 500001 | 500  | Internal server error         |
| 500301 | 503  | Service unavailable           |

Monthly-quota error → `{ code: 402901, message: "Monthly quota exceeded." }`.

---

## 1. Currency & Pairs

| Method | Path | Required | Optional | Response highlights |
| --- | --- | --- | --- | --- |
| GET | `/currencies` | — | — | Array `{currency_id, symbol, name}` |
| GET | `/currencies/{currency_id}` | `currency_id` | — | `{currency_id, name, symbol, introduction, sector[{id,name}], icon, contracts[{chain,contract}], white_paper, first_issue_time, explorers[], community{twitter,reddit}, significant_events[{time,content}]}` |
| GET | `/currencies/{currency_id}/market-snapshot` | `currency_id` | — | `{price, change_pct_24h, turnover_24h, turnover_rate, high_24h, low_24h, marketcap, fdv, max_supply, total_supply, circulating_supply, ath, ath_date, down_from_ath, cycle_low, cycle_low_date, up_from_cycle_low, marketcap_rank}` |
| GET | `/currencies/{currency_id}/token-economics` | `currency_id` | — | `{token_allocation[{holder,percentage}], token_unlock{unlocked,total_locked}, unlock_timeline[{vestings[{label,amount}],timestamp}]}` |
| GET | `/currencies/{currency_id}/klines` | `currency_id`, `interval=1d` | `start_time`, `end_time`, `limit` (def 100, max 500) | Array `{timestamp, open, high, low, close, volume}`. 3-month cap. |
| GET | `/currencies/{currency_id}/supply` | `currency_id` | `start_date`, `end_date`, `page`, `page_size` (max 100) | `{date, max_supply, total_supply, circulating_supply}` |
| GET | `/currencies/{currency_id}/pairs` | `currency_id` | `page`, `page_size` (max 100), `order_by`, `exchange` | Paginated `{base, target, market, price, turnover_24h, cost_to_move_up_usd, cost_to_move_down_usd}` |
| GET | `/currencies/sector-spotlight` | — | — | `{sector[{name, change_pct_24h, marketcap_dom}], spotlight[{name, change_pct_24h}]}` ⚠ field is `change_pct_24h` (not `24h_change_pct` as some docs say) |
| GET | `/currencies/{currency_id}/fundraising` | `currency_id` | — | `{project_id, twitter_username, create_time, update_time, fundraising_rounds[{round_id, round, amount, valuation, date, investors[{investor_id, name, logo_url, type, is_lead_investor}]}], investors[], team[], investment_stats{total_rounds, rounds_last_year, lead_invest_count, last_invest_date, portfolio_count}, portfolio[]}` |

## 2. ETF

`symbol` enum: BTC, ETH, SOL, LTC, HBAR, XRP, DOGE, LINK, AVAX, DOT.
`country_code` enum: US, HK.

| Method | Path | Required | Optional | Response highlights |
| --- | --- | --- | --- | --- |
| GET | `/etfs/summary-history` | `symbol`, `country_code` | `start_date`, `end_date`, `limit` (def 50, max 300) | Array `{date, total_net_inflow, total_value_traded, total_net_assets, cum_net_inflow}`. Reverse-chrono. 1-month cap. |
| GET | `/etfs` | `symbol`, `country_code` | — | Array `{ticker, name, exchange}` |
| GET | `/etfs/{ticker}/market-snapshot` | `ticker` | — | `{date, ticker, sponsor_fee, net_inflow, cum_inflow, net_assets, mkt_price, prem_dsc, value_traded, volume}` |
| GET | `/etfs/{ticker}/history` | `ticker` | `start_date`, `end_date`, `limit` (def 50, max 300) | Array `{date, ticker, net_inflow, cum_inflow, net_assets, currency_share, prem_dsc, value_traded, volume}`. ⚠ `volume` arrives as **string**. 1-month cap. |

## 3. SoSoValue Index (SSI)

Known tickers (verified live): `ssiRWA, ssiMeme, ssiDeFi, ssiAI, ssiDePIN, ssiNFT, ssiSocialFi, ssiMAG7, ssiGameFi, ssiLayer1, ssiPayFi, ssiCeFi, ssiLayer2`.

| Method | Path | Required | Optional | Response highlights |
| --- | --- | --- | --- | --- |
| GET | `/indices` | — | — | Bare array of index ticker strings |
| GET | `/indices/{index_ticker}/constituents` | `index_ticker` | — | Array `{currency_id, symbol, weight}` (weight 0–1) |
| GET | `/indices/{index_ticker}/market-snapshot` | `index_ticker` | — | `{price, 24h_change_pct, 7day_roi, 1month_roi, 3month_roi, 1year_roi, ytd}` ⚠ leading-digit keys |
| GET | `/indices/{index_ticker}/klines` | `index_ticker`, `interval=1d` | `start_time`, `end_time`, `limit` (def 100, max 500) | Array `{timestamp, open, high, low, close}` (no volume). 3-month cap. |

## 4. Crypto Stocks

| Method | Path | Required | Optional | Response highlights |
| --- | --- | --- | --- | --- |
| GET | `/crypto-stocks` | — | — | Array `{ticker, name, exchange, sector, introduction, social_media{website,twitter}, listing_time}` |
| GET | `/crypto-stocks/{stock_ticker}/market-snapshot` | `stock_ticker` | — | `{timestamp, ticker, mkt_price, mkt_status(open/close), volume, turnover, circulating_marketcap, total_marketcap, total_shares, circulating_shares, pe_ttm, pb}` |
| GET | `/crypto-stocks/{stock_ticker}/market-cap` | `stock_ticker` | `start_date`, `end_date`, `limit` (def 50, max 100) | `{date, "market-cap"}` ⚠ hyphenated key |
| GET | `/crypto-stocks/{stock_ticker}/klines` | `stock_ticker`, `interval=1d` | `start_time`, `end_time`, `limit` (def 100, max 500) | Array `{timestamp, open, high, low, close, volume}`. 3-month cap. |
| GET | `/crypto-stocks/sector` | — | — | Array `{sector_name, total_marketcap, change_pct_24h}` |
| GET | `/crypto-stocks/sector/{sector_name}/index` | `sector_name` | `start_date`, `end_date`, `limit` (def 100, max 200) | Array `{date, price, btc_price, nasdaq100_index}` |

## 5. BTC Treasuries

| Method | Path | Required | Optional | Response highlights |
| --- | --- | --- | --- | --- |
| GET | `/btc-treasuries` | — | — | Array `{ticker, name, list_location}` |
| GET | `/btc-treasuries/{ticker}/purchase-history` | `ticker` | `start_date`, `end_date`, `limit` (def 50, max 100) | Array `{date, ticker, btc_holding, btc_acq, acq_cost, avg_btc_cost}` |

## 6. Feeds

`category` enum: 1 news · 2 research · 3 institution · 4 insights/KOL · 7 announcement · 13 crypto-stock news.
`language` enum: en (default), zh, tc, ja, vi, es, pt, ru, tr, fr.
Allowed HTML in content: `div, p, span, h1-h6, li, ol, ul, figcaption, figure, font, img, picture, strong, b, a, blockquote, br`.

| Method | Path | Required | Optional | Response highlights |
| --- | --- | --- | --- | --- |
| GET | `/news` | — | `category`, `language`, `currency_id`, `project_id`, `page`, `page_size` (max 200), `start_time`, `end_time` (7-day cap) | Paginated. `{id, source_link, original_link, release_time, title, content, author, author_description, author_avatar_url, impression_count, like_count, reply_count, retweet_count, category, feature_image, nick_name, is_blue_verified, verified_type, matched_currencies[{id, full_name, name}], tags[], media_info[{soso_url, original_url, short_url, type}], quote_info \| null}`. ⚠ `title`, `content`, `matched_currencies`, `media_info` can be `null`. ⚠ `release_time` and counters arrive as numeric **strings**. |
| GET | `/news/hot` | — | `page`, `page_size` (max 100), `language`, `start_time`, `end_time` (7-day cap) | Paginated. Item `{id, source_link, create_time, title, content}` |
| GET | `/news/featured` | `page`, `page_size` (20–100) | `language`, `category` (array, comma-sep) | Paginated. Same as `/news` minus `original_link` and engagement counts. |
| GET | `/news/search` | `keyword` | `page`, `page_size` (max 50), `category`, `sort` (`relevance` \| `release_time desc`, default `relevance`) | News fields + `type`, `highlight{title, content}` (HTML `<em>` markers). |

## 7. Fundraising

| Method | Path | Required | Optional | Response highlights |
| --- | --- | --- | --- | --- |
| GET | `/fundraising/projects` | — | — | Array `{project_id, project_name}` |
| GET | `/fundraising/projects/{project_id}` | `project_id` | — | Same shape as `/currencies/{id}/fundraising` (rounds, investors, team, stats, portfolio). |

## 8. Macro

| Method | Path | Required | Optional | Response highlights |
| --- | --- | --- | --- | --- |
| GET | `/macro/events` | — | — | Array `{date, events: [string]}` |
| GET | `/macro/events/{event}/history` | `event` | `start_date`, `end_date`, `limit` (def 50, max 100) | Array `{date, actual, forecast, previous}` |

## 9. Analysis Charts

Schema is dynamic per chart — call `/analyses` first to discover the chart name + field list, then `/analyses/{chart_name}` to fetch the time series.

| Method | Path | Required | Optional | Response highlights |
| --- | --- | --- | --- | --- |
| GET | `/analyses` | — | — | Array `{chart_name, time_field, fields:[{name, type}]}` (e.g. `stablecoin_total_market_cap` → `mcap, usdt, usdc, usds, usde, pyusd, usdd`) |
| GET | `/analyses/{chart_name}` | `chart_name` | `start_time`, `end_time`, `limit` (def 100, max 500) | Array `{timestamp, ...dynamic fields per chart}` |

---

## Gotchas

- All `klines` endpoints support **only `interval=1d`** and a 3-month window.
- Field name inconsistencies: SSI snapshot uses `24h_change_pct` (leading digit); sector-spotlight uses `change_pct_24h` (snake_case). Quote leading-digit keys in code.
- ETF endpoints use `start_date`/`end_date` (date strings, e.g. `2024-04-12`) instead of `start_time`/`end_time` (ms).
- Crypto-stocks `market-cap` returns the hyphenated key `"market-cap"` (not snake_case).
- Many news fields are nullable (`title`, `content`, `matched_currencies`, `media_info`). `release_time` and engagement counters arrive as numeric strings — `Number()` parse before use.
- Window caps differ by module: 7d (feeds), 1mo (ETF history), 3mo (klines).
- `/news` allows `page_size` up to **200**, the others cap at 100.
- News docs say 429 code is `42901` while the error-code table lists `402901`. Use `402901`.
- Both `/fundraising/projects/{project_id}` and `/currencies/{currency_id}/fundraising` mark the path param as "optional" in docs, but it is path-positional → effectively required.
