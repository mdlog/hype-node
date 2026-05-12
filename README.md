<p align="center">
  <img src="public/logo-hypenode.png" alt="HypeNode" width="160" />
</p>

<h1 align="center">HypeNode Autonomous Indexer</h1>

HypeNode is an autonomous crypto index platform: an AI agent researches market
signals (hype, sentiment, fund flows, macro), assembles a basket of tokens,
backtests it, and deploys it on-chain as a Smart Strategy Index (SSI) that
anyone can hold or subscribe to. Built on Next.js 14 + TypeScript + Tailwind
on the frontend, with a Python LangGraph + MCP backend powering the
"Research-to-Execution" agent loop.

Two products live in one app:

- **Indexer** (`/dashboard`, `/builder`, `/portfolio`, `/agent`, …) — manage your
  own on-chain indices end-to-end. Connect MetaMask → research → build basket →
  simulate → deploy to SSI Registry on Sepolia → monitor.
- **Publisher** (`/publisher/radar`, `/publisher/proposals`, …) — agent drafts
  hype-driven indices, you review & publish them on-chain to earn fees.

For the full product roadmap and current status see
[`docs/product-roadmap.md`](docs/product-roadmap.md). For a deeper architecture
overview see [`docs/dokumentasi-aplikasi.md`](docs/dokumentasi-aplikasi.md).

## Stack

| Layer        | Tech                                                                |
|--------------|---------------------------------------------------------------------|
| Frontend     | Next.js 14 App Router · React 18 · TypeScript · Tailwind 3          |
| Wallet       | wagmi · viem · RainbowKit · MetaMask                                |
| Auth         | SIWE (Sign-In With Ethereum) · iron-session cookies                 |
| API surface  | Next.js route handlers (`/app/api/*` — 38 endpoints)                |
| Data         | SoSoValue OpenAPI v1 (rate-limited proxy + per-path TTL cache)      |
| Agent        | Python 3.11 · FastAPI · LangGraph · langchain-anthropic · MCP       |
| Storage      | SQLite (`agent-service/data/hypenode.db`) — risk config, decision log |
| Execution    | SSI Registry (Sepolia) via wagmi `useWriteContract` ·  SoDEX REST v1 |
| Risk hedge   | Auto-route to USSI on threshold breach (planned for Wave 3)         |

## Repository layout

```
app/
  page.tsx                      Landing — pick Indexer or Publisher
  onboarding/role/              First-time role selection
  (indexer)/                    16 indexer pages share IndexerTopBar layout
    dashboard, research, analyses, builder, agent, portfolio, risk,
    history, chat, backtest, settings, tokens, tokens/[id],
    fundraising, fundraising/[id], stocks
  publisher/                    6 publisher pages share PublisherTopBar layout
    radar, proposals, proposals/[id], published, earnings, config
  api/                          38 route handlers
    auth/{nonce,verify,me,logout,role}     SIWE sign-in flow
    sosovalue/[...path]                    Catch-all proxy (browser → server)
    terminal/{sentiment,fund-flow,news,sectors}
    ssi/{list,wrap,snapshot/[ticker],constituents/[ticker],klines/[ticker]}
    currencies/[id]/klines · currencies-list
    etfs/[symbol]/{history,summary}
    agent/{state,reasoning,history,step,pause,halt,reset,
           propose-basket,run-backtest,risk-config}
    sodex/execute · portfolio · proposals · chat · backtest/run
    asset-logos · stock-logos · billing/{usage,topup}
components/
  auth/                         SignInButton, WalletBadge, WalletBalance,
                                WalletMismatchBanner, CreatorIdentityCard
  ui/                           Card, Btn, Tag, Spark, LineChart, Meter,
                                Toggle, HypeGauge, ProjectLogo, StockLogo,
                                SectionLabel, LogoSplash, Metric, Mono, Label
  nav/                          IndexerTopBar, PublisherTopBar
  dashboard/                    SmartMoneyWidget, StablecoinFlowWidget,
                                MacroCalendar, SsiCompositeLogo
  builder/, portfolio/, agent/, chat/, publisher/, live/
lib/
  tokens.ts                     Design tokens (matches hifi-kit colors exactly)
  auth/session.ts               iron-session cookie config
  api/
    sosovalue.ts                Shared rate-limiter / cache / dedup transport
    sosovalue/                  Per-endpoint typed wrappers:
      tokens, treasuries, analyses, news-trending, news-search,
      fundraising, macro, etf-snapshot, crypto-stocks
    ssi.ts                      SSI Registry contract reads
    sodex.ts, sodex/            EIP-712 signed exchange actions
    portfolio.ts                Wallet → on-chain index positions
    agent.ts, backtest.ts       Agent service & backtest clients
  stock-logos.ts, project-slugs.ts   Curated logo mappings
middleware.ts                   SIWE auth guard for protected routes
agent-service/                  Python FastAPI + LangGraph + MCP
  src/
    main.py                     HTTP surface for Next.js (port 8001)
    graph.py                    10-node state machine: signal → … → exec
                                with emergency_exit branch (USSI hedge)
    mcp_server.py               Standalone MCP server (stdio)
    state.py                    Pydantic models
    tools/                      terminal · ssi · sodex · risk · backtest
    storage/                    SQLite-backed persistence
docs/
  product-roadmap.md            Current 3-wave roadmap (MVP → Publisher → Production)
  dokumentasi-aplikasi.md       Architecture & UX reference (Indonesian)
  indexer-vs-publisher.md       Two-product breakdown
  sosovalue-api.md              SoSoValue endpoint reference
```

## Authentication flow

Every page except the landing (`/`) and `/api/*` routes is gated by SIWE
through [`middleware.ts`](middleware.ts):

1. User connects wallet (MetaMask, RainbowKit) on the landing page
2. `POST /api/auth/nonce` → server generates SIWE nonce
3. Wallet signs an EIP-4361 message; client `POST /api/auth/verify` with the signature
4. Server verifies via [`siwe`](https://www.npmjs.com/package/siwe), seals
   `{address, chainId, role}` into an iron-session cookie
5. Subsequent requests pass the auth check; mismatched wallet shows
   [`WalletMismatchBanner`](components/auth/WalletMismatchBanner.tsx)

Sign out via `POST /api/auth/logout`. Role selection at `/onboarding/role`
distinguishes Indexer-only users from Publishers.

`SESSION_PASSWORD` (32+ chars high-entropy) is **required** in production —
without it the cookie seal is forgeable.

## Run

```bash
# 1. install
npm install

# 2. dev — frontend (synthetic data without API keys)
npm run dev

# Multiple ports may be in use on shared dev machines — Next will pick the
# first free port from 3000 upward and print the actual URL as
# "Local: http://localhost:<port>". Use that URL, not a hard-coded one.

# 3. agent service (optional — lights up live reasoning + chat)
cd agent-service
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # set ANTHROPIC_API_KEY + SOSOVALUE_API_KEY if you have them
python -m src.main      # http://localhost:8001
```

The frontend renders fine without the agent service. Most data clients fall
back to deterministic synthetic data when `SOSOVALUE_API_KEY` is missing — see
the [audit notes in `docs/product-roadmap.md`](docs/product-roadmap.md) for
known gaps where synthetic data masks real outages (planned cleanup in
Wave 3).

With the agent service running:
- Agent Console (`/agent`) reasoning log polls every 5 s
- MCP Chat composer talks to Claude through `langchain-anthropic`
- Decision log persists to SQLite (`agent-service/data/hypenode.db`)
- Risk config persists across restarts

## Production build

```bash
npm run build && npm start
```

The build produces 65 routes (24 pages · 38 API handlers · landing · 404 +
chunked layout shells). `npm run typecheck` runs `tsc --noEmit` for a quick
type sweep. `npm run lint` runs `next lint`.

## Environment variables

See [`.env.example`](.env.example) for the canonical list. Highlights:

| Var                                         | Default                                             | Purpose                                  |
|---------------------------------------------|-----------------------------------------------------|------------------------------------------|
| `AGENT_SERVICE_URL`                         | `http://localhost:8001`                             | Frontend → Python agent                  |
| `SESSION_PASSWORD`                          | _empty (required in prod)_                          | iron-session cookie seal                 |
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`      | _empty_                                             | RainbowKit / mobile pairing              |
| `SOSOVALUE_API_KEY`                         | _empty → synthetic_                                 | SoSoValue OpenAPI v1                     |
| `SOSOVALUE_API_BASE`                        | `https://openapi.sosovalue.com/openapi/v1`          | API base URL                             |
| `SOSOVALUE_MIN_GAP_MS`                      | `700` (HF tier; bump to `65000` on Demo tier)       | Min ms between outbound calls            |
| `SOSOVALUE_BUCKET_CAPACITY`                 | `20`                                                | Token bucket burst capacity              |
| `SOSOVALUE_CACHE_TTL_MS`                    | `60000`                                             | Default per-path cache TTL               |
| `SOSOVALUE_QUOTA_BACKOFF_MS`                | `1800000` (30 min)                                  | Backoff after monthly quota error        |
| `SSI_CHAIN_ID`                              | `11155111` (Sepolia)                                | SSI Registry chain                       |
| `SSI_RPC_URL`                               | _empty_                                             | RPC endpoint                             |
| `SSI_REGISTRY_ADDRESS`                      | _empty_                                             | Deployed registry address                |
| `NEXT_PUBLIC_SSI_CHAIN_ID` / `_ADDRESS`     | _mirror of SSI\_\*_                                 | Browser-visible (PublishActions)         |
| `SSI_PRIVATE_KEY`                           | _empty_                                             | Hot key for autonomous publishes only    |
| `SODEX_ENV`                                 | `testnet`                                           | `mainnet` (286623) or `testnet` (138565) |
| `SODEX_SPOT_BASE` / `SODEX_PERPS_BASE`      | testnet endpoints                                   | SoDEX gateway URLs                       |
| `SODEX_PRIVATE_KEY` / `SODEX_API_KEY_NAME`  | _empty_                                             | Master-wallet or delegated API key       |
| `ANTHROPIC_API_KEY`                         | _empty → echo response_                             | Claude tool-use in agent                 |
| `ANTHROPIC_MODEL`                           | `claude-sonnet-4-5`                                 | Model id                                 |
| `LANGGRAPH_CHECKPOINT_DIR`                  | `./.checkpoints`                                    | LangGraph state store                    |

## SoSoValue OpenAPI v1

Auth = single header `x-soso-api-key: <YOUR_KEY>`. Get a key by following the
[setup guide](https://sosovalue-1.gitbook.io/sosovalue-api-doc/setting-up-your-api-key).

The shared transport ([`lib/api/sosovalue.ts`](lib/api/sosovalue.ts)) wraps every
endpoint with a singleton rate limiter, in-flight dedup, persistent cache
(`globalThis`-scoped to survive Next.js HMR + route handler isolation), and a
catch-all browser proxy ([`app/api/sosovalue/[...path]/route.ts`](app/api/sosovalue/[...path]/route.ts))
so the API key never leaves the server.

Endpoint groups (typed wrappers in [`lib/api/sosovalue/`](lib/api/sosovalue)):

| Wrapper file                     | Endpoints                                                    |
|----------------------------------|--------------------------------------------------------------|
| `sosovalue.ts`                   | `/etfs`, `/etfs/{ticker}/history`, `/etfs/summary-history`, `/news`, `/currencies/sector-spotlight`, `/indices`, `/indices/{ticker}/{constituents,market-snapshot,klines}`, `/currencies/{id}/{market-snapshot,klines}` |
| `tokens.ts`                      | `/currencies`, `/currencies/{id}/{token-economics,supply,pairs,fundraising}` |
| `treasuries.ts`                  | `/btc-treasuries`, `/btc-treasuries/{ticker}/purchase-history` |
| `analyses.ts`                    | `/analyses`, `/analyses/{name}` (stablecoin mcap, fund flows…) |
| `news-trending.ts`               | `/news/hot`, `/news/featured`                                |
| `news-search.ts`                 | `/news/search`                                               |
| `fundraising.ts`                 | `/fundraising/projects`, `/fundraising/projects/{id}`        |
| `macro.ts`                       | `/macro/events`, `/macro/events/{id}/history`                |
| `etf-snapshot.ts`                | `/etfs/{ticker}/market-snapshot`                             |
| `crypto-stocks.ts`               | `/crypto-stocks`, `/crypto-stocks/{ticker}/{snapshot,klines}`|

For the full endpoint reference and response shapes see
[`docs/sosovalue-api.md`](docs/sosovalue-api.md).

### Rate limiting & cache

The transport uses a **token bucket** instead of a plain serializer:

- **Burst capacity**: `SOSOVALUE_BUCKET_CAPACITY` tokens (default 20) refill at
  one token per `SOSOVALUE_MIN_GAP_MS`. Lets a dashboard SSR fan out 20 calls
  in parallel without serializing
- **Per-path TTL** (overrides `SOSOVALUE_CACHE_TTL_MS` default):
  - klines / market-snapshot / news → 30–60 s
  - currency details / token-economics → 5 min
  - everything else → 15 min default
- **In-flight dedup**: parallel reads for the same path share one promise
- **Error-class backoffs** based on the SoSoValue error envelope:
  - 5xx / `code 500001` → 5 min
  - `code 402901` "monthly" → 6 h
  - `code 402901` other → 5 min
  - `400101 / 400102` / 401 → 6 h (auth failure, global)
  - `400301 / 400401 / 400402` / 403 / 404 → 1 h per-path negative cache
- **Stale-on-failure**: previous good payload wins over a fresh error
- **Cache lives in `globalThis`** so it survives Next.js HMR and route-handler
  isolation; bumped via `STATE_VERSION` when the shape changes

The Python agent service ([`agent-service/src/tools/terminal.py`](agent-service/src/tools/terminal.py))
ships its own equivalent limiter tuned via `SOSOVALUE_MIN_GAP_SEC` /
`SOSOVALUE_CACHE_TTL_SEC`. The agent loop in
[`agent-service/src/main.py`](agent-service/src/main.py) sleeps `AGENT_LOOP_SEC`
(default 120 s) between iterations and rotates through SoSoValue's narrative
sectors so each cycle has at least one fresh token to spend.

## SoDEX REST v1

Read-only endpoints (`/markets/*`, `/accounts/{addr}/*`) are public — no key.

Trade actions (`/trade/orders/batch`, `/trade/orders/replace`,
`/trade/orders/schedule-cancel`, `/accounts/transfers`, plus perps
`/trade/orders`, `/trade/leverage`, `/trade/margin`) require an EIP-712 signed
exchange action:

```ts
domain  = { name: "spot"|"futures", version: "1",
            chainId: 286623 (mainnet) | 138565 (testnet),
            verifyingContract: 0x0…0 }
message = { payloadHash: keccak256(json.Marshal({type, params})), nonce: uint64 }
```

The signature is `0x01 || ECDSA(...)` (the leading byte tells the gateway it's
an EIP-712 action). Use a wallet (viem `signTypedData`, ethers v6, or
`window.ethereum`) — never bake a private key into the agent process.
[`lib/api/sodex.ts → buildExchangeAction`](lib/api/sodex.ts) returns the
typed-data envelope to feed into your wallet.

## SSI Registry (on-chain)

Default deployment target is **Sepolia** (`SSI_CHAIN_ID=11155111`).

- The Builder pipeline (`/builder`) signs `registerIndex(...)` via wagmi
  `useWriteContract` from the user's connected wallet — no server hot key needed
- The Portfolio page (`/portfolio`) reads positions by filtering the registry's
  events for `creator == connectedWallet`
- `SSI_PRIVATE_KEY` is **only** used for autonomous agent publishes (rebalance
  loop) when explicitly enabled — UI publishes always use the user's wallet

To deploy elsewhere (e.g. ValueChain L1 mainnet `286623`), override
`SSI_CHAIN_ID` + `SSI_RPC_URL` + `SSI_REGISTRY_ADDRESS` and the matching
`NEXT_PUBLIC_*` mirrors.

Copy [`.env.example`](.env.example) and [`agent-service/.env.example`](agent-service/.env.example).

## Roadmap

The detailed plan lives in [`docs/product-roadmap.md`](docs/product-roadmap.md).
Three waves:

1. **Wave 1 — Indexer MVP** (~95% complete) — single user can build → simulate
   → deploy → monitor end-to-end on Sepolia
2. **Wave 2 — Publisher Revenue Loop** (vault contract, subscriber deposits,
   USDC fee streaming, marketplace `/discover`)
3. **Wave 3 — Production Hardening** (mainnet migration, external audit,
   observability, mobile-responsive, ToS/Privacy, pricing tiers)

Public launch target: 15 June 2026.

Outstanding items at the README layer (not in the per-wave roadmap):

- `/api/sodex/execute` and `/api/billing/topup` need SIWE auth gates before
  any public exposure
- Several typed wrappers substitute synthetic payloads when SoSoValue returns
  empty data — masks real outages; needs honest empty states
- Reasoning stream is still polling, not SSE
- `ANTHROPIC_MODEL` default may lag (Claude 4.6/4.7 already shipped)

## License

Internal — subject to MDlabs policy.
