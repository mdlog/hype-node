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
  own on-chain indices end-to-end. Sign in with email / Google / Twitter / wallet
  via Privy → research → build basket → simulate → deploy to SSI Registry on
  Sepolia → monitor.
- **Publisher** (`/publisher/radar`, `/publisher/proposals`, …) — agent drafts
  hype-driven indices, you review & publish them on-chain, and subscribers can
  deposit into a custodial **HypeIndexVault** to earn you 1%/yr management +
  10% performance fees. Currently on testnet (see [Publisher Vault](#publisher-vault-on-chain)).

Public surface (no sign-in required): `/discover` marketplace, `/docs`,
`/privacy`, `/status` (live endpoint probes).

For the full product roadmap and current status see
[`docs/product-roadmap.md`](docs/product-roadmap.md). For a deeper architecture
overview see [`docs/dokumentasi-aplikasi.md`](docs/dokumentasi-aplikasi.md).

## Stack

| Layer        | Tech                                                                |
|--------------|---------------------------------------------------------------------|
| Frontend     | Next.js 14.2.32 App Router · React 18 · TypeScript · Tailwind 3     |
| Wallet       | Privy (email / Google / Twitter / wallet) · wagmi · viem            |
| Auth         | SIWE (Sign-In With Ethereum) · iron-session cookies                 |
| API surface  | Next.js route handlers (`/app/api/*` — 59 endpoints)                |
| Data         | SoSoValue OpenAPI v1 (rate-limited proxy + per-path TTL cache)      |
| LLM agent    | Python 3.11 · FastAPI · LangGraph · MCP · pluggable Anthropic / OpenAI |
| Storage      | Supabase Postgres (saved runs, threads, billing) · SQLite (`agent-service/data/hypenode.db` for risk config + decision log) |
| Execution    | SSI Registry (Sepolia) via wagmi `useWriteContract` ·  SoDEX REST v1 |
| Publisher vault | `HypeIndexVault.sol` (Solidity · Foundry) — custodial subscribe/redeem + share-dilution fee accrual, driven by a Python keeper/indexer. Testnet-stage |
| Risk hedge   | Auto-route to USSI on threshold breach (planned for Wave 3)         |

## Repository layout

```
app/
  layout.tsx                    Root layout — Providers + AppFooter (every page)
  page.tsx                      Landing — pick Indexer or Publisher
  providers.tsx                 PrivyProvider → QueryClient → WagmiProvider stack
  onboarding/role/              First-time role selection
  (indexer)/                    16 indexer pages share IndexerTopBar layout
    dashboard, research, analyses, builder, agent, portfolio, risk,
    history, chat, backtest (page + BacktestClient + RunHistoryModal),
    settings, tokens, tokens/[id], fundraising, fundraising/[id], stocks
  publisher/                    6 publisher pages share PublisherTopBar layout
    radar, proposals, proposals/[id], published, earnings, config
  (public)/                     Unauthenticated info surface
    docs, privacy, status (live endpoint probes every 30s)
  discover, discover/[id]       Public marketplace (no sign-in). discover/[id]
                                has SubscribePanel (deposit into the vault) +
                                BacktestVsRealized (backtest vs live NAV)
  share/backtest/[code]         Public share link for a saved backtest run
  api/                          59 route handlers
    auth/{nonce,verify,me,logout,role}     SIWE sign-in flow
    demo/{enter,exit}                      Read-only demo session toggle
    sosovalue/[...path]                    Catch-all proxy (browser → server)
    terminal/{sentiment,fund-flow,news,sectors}
    ssi/{list,wrap,snapshot/[ticker],constituents/[ticker],klines/[ticker]}
    currencies/[id]/klines · currencies-list
    etfs/[symbol]/{history,summary}
    agent/{state,reasoning,history,step,pause,halt,reset,tools/health,
           propose-basket,run-backtest,risk-config}
    backtest/{run, runs, runs/[id], share, share/[code]}   Saved runs + share links
    builder/drafts (+ [id])                     Builder draft persistence
    chat (+ threads, threads/[id]/messages)     Chat + thread storage
    portfolio + portfolio/snapshots (+ [id])    Wallet positions + snapshots
    proposals (+ [id]) · risk/audit · settings · sodex/submit
    publisher/earnings (+ /summary)             Creator earnings ledger (keeper-written)
    vault/cancel-deposit                        Cancel a pending vault deposit
    cron/portfolio-snapshot                     Periodic snapshot job
    asset-logos · stock-logos · billing/{usage,topup}
components/
  auth/                         SignInButton (Privy login + SIWE), WalletBadge
                                (with Export wallet for embedded), WalletBalance,
                                WalletMismatchBanner, CreatorIdentityCard
  ui/                           Card, Btn, Tag, Spark, LineChart, Meter,
                                Toggle, HypeGauge, ProjectLogo, StockLogo,
                                SectionLabel, LogoSplash, Metric, Mono, Label
  nav/                          IndexerTopBar, PublisherTopBar, AppFooter,
                                RoleSwitcher
  dashboard/                    SmartMoneyWidget, StablecoinFlowWidget,
                                MacroCalendar, SsiCompositeLogo
  builder/, portfolio/, agent/, chat/, publisher/, live/, history/, research/,
  vault/                        RedeemPanel + ClaimFeesPanel (wired into
                                /discover/[id]) — subscriber redeem + creator fee claim
  billing/                      Inline + modal top-up flows
lib/
  tokens.ts                     Design tokens (matches hifi-kit colors exactly)
  text.ts                       cleanText / safeSlice — strips lone UTF-16
                                surrogates so emoji-tailed news titles don't
                                trip SSR-vs-CSR hydration
  auth/{session.ts, wagmi.ts, useSessionGuard.ts, role.ts}
  hooks/{useAutoRefetch.ts, useTabActivity.ts}
  api/
    sosovalue.ts                Shared rate-limiter / cache / dedup transport
    sosovalue/                  Per-endpoint typed wrappers:
      tokens, treasuries, analyses, news-trending, news-search,
      fundraising, macro, etf-snapshot, crypto-stocks
    ssi.ts                      SSI Registry contract reads
    sodex/{client,typedData,serverSigner}     EIP-712 signed exchange actions
    portfolio.ts, portfolio-snapshot.ts
    agent.ts, backtest.ts       Agent service & backtest clients
  supabase/{server.ts, auth.ts, types.ts}   Postgres persistence client
  stock-logos.ts, project-slugs.ts   Curated logo mappings
middleware.ts                   SIWE auth guard for protected routes
supabase/migrations/            SQL migrations 0001–0006 (bt_runs, chat_threads,
                                pb_subscriptions, pt_track_record, vault_indexer,
                                pb_cancel_requests)
contracts/                      Foundry project (forge, OZ v5.1.0)
  src/HypeIndexVault.sol        Custodial vault — subscribe/redeem + fee accrual
  src/SSIRegistry.sol           On-chain index registry
  src/mocks/MockUSDC.sol        Testnet settlement token
  script/Deploy.s.sol           Deploy scripts
  deploy-vault.sh · DEPLOY-VAULT.md   Deploy helper + runbook
agent-service/                  Python FastAPI + LangGraph + MCP
  src/
    main.py                     HTTP surface for Next.js (port 8001)
    chat_agent.py               Multi-provider (Anthropic / OpenAI) tool-use loop
    graph.py                    10-node state machine: signal → … → exec
                                with emergency_exit branch (USSI hedge)
    mcp_server.py               Standalone MCP server — 17 read-only tools, installable via hypenode-mcp
    state.py                    Pydantic models
    tools/                      terminal · ssi · sodex · risk · backtest ·
                                real_backtest · basket · macro · treasuries ·
                                rootdata
    vault/                      Vault keeper stack — nav (EIP-712 NAV signing),
                                attestation, executor, keeper, daemon
                                (reconcile→settle→accrue→index), indexer
                                (chain→Supabase), rebalance, store, config
    store.py                    SQLite-backed persistence
docs/
  product-roadmap.md            Current 3-wave roadmap (MVP → Publisher → Production)
  dokumentasi-aplikasi.md       Architecture & UX reference (Indonesian)
  indexer-vs-publisher.md       Two-product breakdown
  sosovalue-api.md              SoSoValue endpoint reference
```

## Authentication flow

Every page except the landing (`/`), the public surface (`/discover`, `/docs`,
`/privacy`, `/status`), and `/api/*` routes is gated by SIWE through
[`middleware.ts`](middleware.ts):

1. User clicks "Get access" — [`SignInButton`](components/auth/SignInButton.tsx)
   opens the Privy modal with email · Google · Twitter · wallet options
2. Privy authenticates the user:
   - Email/social → auto-creates an **embedded EOA** (managed by Privy MPC)
   - External wallet (MetaMask / Rabby / WC) → bridges through the
     [`@privy-io/wagmi`](https://www.npmjs.com/package/@privy-io/wagmi) connector
3. The embedded wallet is set as the wagmi active connector so the next
   `useSignMessage` dispatches to the right address (this avoids the
   "logged in with Gmail but signed with MetaMask" bug)
4. `POST /api/auth/nonce` → server generates SIWE nonce
5. Wallet signs the EIP-4361 message; client `POST /api/auth/verify` with the signature
6. Server verifies via [`siwe`](https://www.npmjs.com/package/siwe), seals
   `{address, chainId, role}` into an iron-session cookie
7. Subsequent requests pass the auth check; mismatched wallet shows
   [`WalletMismatchBanner`](components/auth/WalletMismatchBanner.tsx)

Sign out via `POST /api/auth/logout` + Privy `useLogout()` (drops the
iron-session cookie, Privy session, and wagmi connector in one call). Role
selection at `/onboarding/role` distinguishes Indexer-only users from
Publishers.

Embedded-wallet users can self-custody by clicking **Export wallet** in the
WalletBadge dropdown — Privy reveals the private key after passkey/PIN
verification, after which it can be imported into MetaMask for use on
external dApps like sodex.dev.

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
cp .env.example .env
# Pick your LLM provider + key:
#   LLM_PROVIDER=anthropic  →  ANTHROPIC_API_KEY=...
#   LLM_PROVIDER=openai     →  OPENAI_API_KEY=...   (recommended model: gpt-4o)
# Also set SOSOVALUE_API_KEY for live market data.
python -m src.main      # http://localhost:8001
```

The frontend renders fine without the agent service. Most data clients fall
back to deterministic synthetic data when `SOSOVALUE_API_KEY` is missing — see
the [audit notes in `docs/product-roadmap.md`](docs/product-roadmap.md) for
known gaps where synthetic data masks real outages (planned cleanup in
Wave 3).

With the agent service running:
- Agent Console (`/agent`) reasoning log polls every 5 s
- Chat composer (`/chat`) talks to Claude or GPT-4o depending on
  `LLM_PROVIDER`; the same `TOOL_SCHEMAS` is converted to each provider's
  tool-call format internally so the UX is identical across backends
- Decision log persists to SQLite (`agent-service/data/hypenode.db`)
- Risk config persists across restarts
- Saved backtest runs, chat threads, and share links live in Supabase

## Production build

```bash
npm run build && npm start
```

The build produces ~90 routes (30 pages · 59 API handlers · landing · 404 +
chunked layout shells). `npm run typecheck` runs `tsc --noEmit` for a quick
type sweep. `npm run lint` runs `next lint`.

ESLint is currently set to `ignoreDuringBuilds: true` in
[`next.config.mjs`](next.config.mjs) — the `@typescript-eslint` plugin was
pruned during the Privy install, which makes any `eslint-disable-next-line
@typescript-eslint/...` comment fail the build. Lint manually before commit:
`npm run lint` (or re-add the plugin in `Sosovalue/package.json` to restore
build-time linting).

## Environment variables

See [`.env.example`](.env.example) for the canonical list. Highlights:

| Var                                         | Default                                             | Purpose                                  |
|---------------------------------------------|-----------------------------------------------------|------------------------------------------|
| `AGENT_SERVICE_URL`                         | `http://localhost:8001`                             | Frontend → Python agent                  |
| `SESSION_PASSWORD`                          | _empty (required in prod)_                          | iron-session cookie seal                 |
| `NEXT_PUBLIC_PRIVY_APP_ID`                  | _empty → login UI disabled_                         | Privy app id (get one at dashboard.privy.io) |
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`      | _empty (legacy — Privy bundles WC internally)_      | RainbowKit / standalone WC pairing       |
| `SOSOVALUE_API_KEY`                         | _empty → synthetic_                                 | SoSoValue OpenAPI v1                     |
| `SOSOVALUE_API_BASE`                        | `https://openapi.sosovalue.com/openapi/v1`          | API base URL                             |
| `SOSOVALUE_MIN_GAP_MS`                      | `700` (HF tier; bump to `65000` on Demo tier)       | Min ms between outbound calls            |
| `SOSOVALUE_BUCKET_CAPACITY`                 | `20`                                                | Token bucket burst capacity              |
| `SOSOVALUE_CACHE_TTL_MS`                    | `60000` (bump to `600000` for slower dashboards)    | Default per-path cache TTL               |
| `SOSOVALUE_QUOTA_BACKOFF_MS`                | `1800000` (30 min)                                  | Backoff after monthly quota error        |
| `SSI_CHAIN_ID`                              | `11155111` (Sepolia)                                | SSI Registry chain                       |
| `SSI_RPC_URL`                               | _empty_                                             | RPC endpoint                             |
| `SSI_REGISTRY_ADDRESS`                      | _empty_                                             | Deployed registry address                |
| `NEXT_PUBLIC_SSI_CHAIN_ID` / `_ADDRESS`     | _mirror of SSI\_\*_                                 | Browser-visible (PublishActions)         |
| `SSI_PRIVATE_KEY`                           | _empty_                                             | Hot key for autonomous publishes only    |
| `SODEX_ENV`                                 | `testnet`                                           | `mainnet` (286623) or `testnet` (138565) |
| `SODEX_SPOT_BASE` / `SODEX_PERPS_BASE`      | testnet endpoints                                   | SoDEX gateway URLs                       |
| `SODEX_PRIVATE_KEY` / `SODEX_API_KEY_NAME`  | _empty_                                             | Master-wallet or delegated API key       |
| `LLM_PROVIDER`                              | `anthropic`                                         | `anthropic` or `openai` — chat backend   |
| `ANTHROPIC_API_KEY` / `ANTHROPIC_MODEL`     | _empty_ / `claude-sonnet-4-5`                       | Used when `LLM_PROVIDER=anthropic`       |
| `OPENAI_API_KEY` / `OPENAI_MODEL`           | _empty_ / `gpt-4o`                                  | Used when `LLM_PROVIDER=openai`          |
| `NEXT_PUBLIC_SUPABASE_URL`                  | _empty_                                             | Supabase project URL                     |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`             | _empty_                                             | Supabase anon key (browser-safe)         |
| `SUPABASE_SERVICE_ROLE_KEY`                 | _empty_                                             | Server-only Supabase role for writes     |
| `LANGGRAPH_CHECKPOINT_DIR`                  | `./.checkpoints`                                    | LangGraph state store                    |
| `AGENT_OPERATORS`                           | _empty (prod fails closed)_                         | Comma-sep wallets allowed to drive agent control + `risk-config` routes |
| `KEEPER_SECRET`                             | _empty → keeper writes disabled_                    | `x-keeper-secret` for keeper→earnings-ledger writes |
| `NEXT_PUBLIC_VAULT_CHAIN_ID`                | `11155111` (Sepolia)                                | Chain the vault UI (`SubscribePanel`) targets |
| `NEXT_PUBLIC_HYPE_VAULT_ADDRESS`            | _empty → "not deployed" fallback_                   | Deployed `HypeIndexVault` address (browser) |
| `NEXT_PUBLIC_USDC_ADDRESS`                  | _empty_                                             | Settlement USDC / MockUSDC address (browser) |
| `VAULT_CHAIN_ID` *(keeper)*                 | _required_                                          | EIP-712 domain chainId; must match deployment |
| `VAULT_RPC_URL` *(keeper)*                  | `http://127.0.0.1:8545`                             | RPC endpoint for keeper + indexer        |
| `VAULT_ADDRESS` / `VAULT_USDC_ADDRESS` *(keeper)* | _required_                                    | Deployed vault + settlement token addresses |
| `VAULT_SIGNER_PRIVATE_KEY` *(keeper)*       | _required_                                          | EIP-712 NAV price-signer hot key         |
| `VAULT_KEEPER_PRIVATE_KEY` *(keeper)*       | _required_                                          | Keeper tx key (settle / accrue)          |
| `VAULT_REBALANCE_ENABLED` *(keeper)*        | _empty → off_                                       | Master switch for the daily rebalance loop |

Vars marked *(keeper)* live in [`agent-service/.env`](agent-service/.env.example),
not the root `.env`.

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
[`lib/api/sodex/typedData.ts → buildSignedEnvelope`](lib/api/sodex/typedData.ts)
returns the typed-data envelope to feed into your wallet.

### Spot vs perps

The agent supports both products via three chat tools, all browser-signed:

| Tool | Product | Symbol form | Sizing |
|------|---------|-------------|--------|
| `sodex_execute_trade` | spot | `vSOL_vUSDC` (testnet `v` prefix) | USDC notional |
| `sodex_sell_trade` | spot | same | asset quantity |
| `sodex_perps_trade` | perps | `SOL-USD` (plain ticker) | contract size + leverage |

On testnet, spot pairs frequently flip to `cancel-only` mode when no market
maker is around; perps tends to carry the live liquidity. The chat agent
should pick `sodex_perps_trade` whenever the user mentions leverage, long/short,
or "futures", or as a fallback when spot returns "symbol is in cancel only mode".

EIP-712 domain `name` is `"spot"` vs `"futures"` (not `"perps"`). The shared
`/api/sodex/submit` endpoint forwards both products transparently because the
prepared envelope carries `base_url` + `path` inline.

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

## Publisher Vault (on-chain)

> **Testnet-stage.** The vault ships and works end-to-end on testnet, but it is
> **not audited** and uses a **trusted-keeper custody model** (see caveats
> below). Do not point it at real funds. Mainnet is gated on Wave 3.

The Publisher revenue loop is backed by [`contracts/src/HypeIndexVault.sol`](contracts/src/HypeIndexVault.sol)
— one shared custodial vault, keyed per index by `indexId = keccak256(symbol)`,
settling in USDC:

- **Subscribe / redeem** — subscribers deposit USDC via
  [`SubscribePanel`](app/discover/[id]/SubscribePanel.tsx) on `/discover/[id]`;
  because SoDEX swaps are off-chain/async, deposits **mint shares on fill**
  (redeem is symmetric). A pending deposit can be pulled back through
  [`vault/cancel-deposit`](app/api/vault/cancel-deposit/route.ts) before the
  keeper settles it. Redeem + creator fee-claim UI live in
  [`components/vault/`](components/vault) (`RedeemPanel`, `ClaimFeesPanel`).
- **Shares** — an internal, non-transferable ledger (no ERC-20/1155 surface).
- **Fees** — 1%/yr management + 10% performance, accrued by **share dilution**
  (minting creator shares — no USDC moves per accrual), with a per-subscriber
  high-water mark.
- **NAV & keeper** — the Python keeper stack
  ([`agent-service/src/vault/`](agent-service/src/vault)) signs NAV with an
  EIP-712 price-signer (staleness + sanity band), and a daemon runs
  reconcile → settle → accrue → index once per cycle. The indexer mirrors
  on-chain events into Supabase (`pb_subscriptions`, earnings ledger) to feed
  `/discover` and `/publisher/earnings`.

Deploy with [`contracts/deploy-vault.sh`](contracts/deploy-vault.sh) — full
runbook in [`contracts/DEPLOY-VAULT.md`](contracts/DEPLOY-VAULT.md). Set
`NEXT_PUBLIC_VAULT_CHAIN_ID` / `NEXT_PUBLIC_HYPE_VAULT_ADDRESS` /
`NEXT_PUBLIC_USDC_ADDRESS` on the frontend and the `VAULT_*` keys on the keeper
(see [Environment variables](#environment-variables)). Until the vault address
is set, `/discover/[id]` shows an honest "Vault not deployed yet" fallback.

**Custody caveats (why this is testnet-only):** SoDEX settlement is off-chain,
so a smart contract cannot be the SoDEX signer — funds are custodian-backed
mirror tokens in a SoDEX account keyed to the **keeper EOA**, i.e. effective
custody sits with the keeper, not the contract. The keeper's `basketValueUsdc`
input is currently unsigned (a compromised keeper could mint arbitrary shares).
Mainnet requires an external audit, custody re-architecture, and a multisig
price-signer — all tracked in Wave 3.

## Use HypeNode inside Claude Desktop (Wave-1 delivered)

The standalone MCP server ships as part of the `agent-service` package and exposes **17 read-only SoSoValue research tools** directly inside Claude Desktop — no API or custom UI required.

```bash
cd agent-service
pip install -e .   # registers `hypenode-mcp` console-script
```

Then point Claude Desktop at the binary — see the full setup guide in
[`agent-service/docs/CLAUDE_DESKTOP_SETUP.md`](agent-service/docs/CLAUDE_DESKTOP_SETUP.md)
and copy the ready-made config from
[`agent-service/claude_desktop_config.example.json`](agent-service/claude_desktop_config.example.json).

Available tools: sector sentiment, fund flows, news, sector spotlight, SSI index list, basket builder, real-klines backtest, currency snapshots, risk-gate checker, macro calendar, macro event history, smart-money signal, fundraising rounds, RootData project/investor search. All read-only — stateful trade tools are excluded by design.

---

## Roadmap

The detailed plan lives in [`docs/product-roadmap.md`](docs/product-roadmap.md).
Three waves:

1. **Wave 1 — Indexer MVP** (~95% complete) — single user can build → simulate
   → deploy → monitor end-to-end on Sepolia
2. **Wave 2 — Publisher Revenue Loop** (custodial `HypeIndexVault`, subscriber
   deposits, share-dilution fees, keeper/indexer, marketplace `/discover`) —
   **built and working end-to-end on testnet** (see [Publisher Vault](#publisher-vault-on-chain)).
   Not audited; trusted-keeper custody — mainnet is gated on Wave 3.
3. **Wave 3 — Production Hardening** (mainnet migration, external audit,
   vault custody re-architecture + multisig signer, observability,
   mobile-responsive, ToS/Privacy, pricing tiers)

Status: the app runs on public **testnet** today; mainnet launch follows the
Wave 3 audit + custody re-architecture.

Outstanding items at the README layer (not in the per-wave roadmap):

- Several typed wrappers substitute synthetic payloads when SoSoValue returns
  empty data — masks real outages; needs honest empty states
- Chat agent is non-streaming — full response returned after tool loop
  completes. SSE streaming is the highest-leverage UX win still on the table
- No stop-generation button on chat (timeout-bounded at `CHAT_LOOP_TIMEOUT_SEC`,
  default 90 s) and no message edit / regenerate
- Reasoning stream on `/agent` is still polling, not SSE
- ESLint disabled at build time — restore by adding `@typescript-eslint/*`
  back to the parent `Sosovalue/package.json` devDependencies
- Mobile-responsive pass pending — most app pages assume ≥900px width

## License

Internal — subject to MDlabs policy.
