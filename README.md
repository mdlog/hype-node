# HypeNode Autonomous Indexer

Next.js 14 + TypeScript + Tailwind frontend for the HypeNode "Research-to-Execution"
agentic system, plus a Python LangGraph + MCP backend.

Two products live in one app:

- **Indexer** (`/dashboard` …) — manage your own on-chain indices end-to-end.
- **Publisher** (`/publisher/radar` …) — agent drafts hype-driven indices, you
  approve & publish them to the SSI Protocol and earn fees.

The design ports the hi-fi mockups in [`../*.jsx`](../) one-for-one.

## Stack

| Layer        | Tech                                                                |
|--------------|---------------------------------------------------------------------|
| Frontend     | Next.js 14 App Router · React 18 · TypeScript · Tailwind 3          |
| API surface  | Next.js route handlers (`/app/api/*`)                               |
| Agent        | Python 3.11 · FastAPI · LangGraph · langchain-anthropic             |
| MCP          | `mcp` SDK · stdio server exposing 7 tools                           |
| Data         | SoSoValue Terminal (sentiment / fund flow / news)                   |
| Execution    | SSI Protocol wrap → SoDEX trades on ValueChain L1                   |
| Risk hedge   | Auto-route to USSI on threshold breach                              |

## Layout

```
app/
  page.tsx                      Landing — pick Indexer or Publisher
  (indexer)/                    10 indexer pages share IndexerTopBar layout
    dashboard, research, builder, agent, portfolio,
    risk, history, chat, backtest, settings
  publisher/                    6 publisher pages share PublisherTopBar layout
    radar, proposals, proposals/[id] (review),
    published, earnings, config
  api/                          Edge-friendly route handlers
    terminal/{sentiment,fund-flow,news,sectors}
    ssi/wrap · sodex/execute
    agent/{state,reasoning} · chat · backtest/run · proposals
components/
  ui/                           Card, Btn, Tag, Spark, LineChart, Meter,
                                Toggle, HypeGauge, etc. (ported from hifi-kit)
  nav/                          IndexerTopBar, PublisherTopBar
  live/                         ReasoningStream, ChatComposer (poll /api/agent)
lib/
  tokens.ts                     Design tokens (matches hifi-kit colors exactly)
  fake-data.ts                  Deterministic synthetic series
  api/                          sosovalue · ssi · sodex · agent · backtest clients
agent-service/                  Python FastAPI + LangGraph + MCP
  src/
    main.py                     HTTP surface for Next.js (port 8001)
    graph.py                    10-node state machine: signal → … → exec
                                with emergency_exit branch (USSI hedge)
    mcp_server.py               Standalone MCP server (stdio)
    state.py                    Pydantic models
    tools/                      terminal · ssi · sodex · risk · backtest
```

## Run

```bash
# 1. install
npm install

# 2. dev (frontend only, fully usable with synthetic data)
npm run dev    # http://localhost:3000

# 3. agent service (optional — lights up live reasoning + chat)
cd agent-service
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # set ANTHROPIC_API_KEY + SOSOVALUE_API_KEY if you have them
python -m src.main      # http://localhost:8001
```

The frontend renders fine without the agent service or any API keys — every
client falls back to deterministic synthetic data so the design is testable
end-to-end. With the agent service running, the Agent Console reasoning log
streams live state transitions every 5 s and the MCP Chat composer talks to
Claude through `langchain-anthropic`.

## Production build

```bash
npm run build && npm start
```

The build produces 30 routes (16 pages · 13 API handlers · landing · 404).

## Environment variables

| Var                        | Default                                                   | Used by      |
|----------------------------|-----------------------------------------------------------|--------------|
| `AGENT_SERVICE_URL`        | `http://localhost:8001`                                   | Next.js      |
| `SOSOVALUE_API_KEY`        | _empty → synthetic data_                                  | Both         |
| `SOSOVALUE_API_BASE`       | `https://openapi.sosovalue.com/openapi/v1`                | Both         |
| `SSI_RPC_URL`              | `https://rpc.valuechain.io`                               | Both         |
| `SSI_REGISTRY_ADDRESS`     | _zero address_                                            | Next.js      |
| `SSI_PRIVATE_KEY`          | _empty (signing happens in wallet)_                       | Next.js      |
| `SODEX_ENV`                | `mainnet` (alt `testnet`)                                 | Both         |
| `SODEX_SPOT_BASE`          | `https://mainnet-gw.sodex.dev/api/v1/spot`                | Both         |
| `SODEX_PERPS_BASE`         | `https://mainnet-gw.sodex.dev/api/v1/perps`               | Both         |
| `ANTHROPIC_API_KEY`        | _empty → echo response_                                   | agent        |
| `ANTHROPIC_MODEL`          | `claude-sonnet-4-5`                                       | agent        |

### SoSoValue OpenAPI v1

Auth = single header `x-soso-api-key: <YOUR_KEY>`. Get a key by following the
[setup guide](https://sosovalue-1.gitbook.io/sosovalue-api-doc/setting-up-your-api-key).
The clients call these endpoints (all wired in [lib/api/sosovalue.ts](lib/api/sosovalue.ts)
+ [agent-service/src/tools/terminal.py](agent-service/src/tools/terminal.py)):

| Path                                  | Used for                                  |
|---------------------------------------|-------------------------------------------|
| `GET /etfs?symbol=…&country_code=US`  | ETF list per asset (BTC, ETH, …)          |
| `GET /etfs/{ticker}/history`          | Daily net inflow / cum inflow / NAV       |
| `GET /news`                           | News feed (filtered by category, lang)    |
| `GET /currencies/sector-spotlight`    | Sector momentum + spotlight rotation      |
| `GET /indices`                        | SSI ticker list (`ssimag7`, `ssilayer1` …)|
| `GET /indices/{ticker}/constituents`  | Index constituents (symbol, weight 0–1)   |

When the key is missing every method falls back to deterministic synthetic data
shaped exactly like the documented response so the UI / agent loop stays
testable end-to-end.

#### Rate limiting (Demo tier = 1 req/min)

[lib/api/sosovalue.ts](lib/api/sosovalue.ts) and
[agent-service/src/tools/terminal.py](agent-service/src/tools/terminal.py)
each ship with a singleton rate limiter + 15-minute in-memory cache:

- **65 s minimum gap** between outbound calls (across endpoints, across pages)
- **In-flight dedup** so parallel cold reads share one fetch
- **Stale-on-rate-limit / stale-on-failure** — old payload wins over a 429
- Cache state lives in `globalThis` (Node) / module globals (Python) so it
  survives Next.js route-handler isolation and HMR

Tunable via env: `SOSOVALUE_MIN_GAP_MS` / `SOSOVALUE_CACHE_TTL_MS` (Node) and
`SOSOVALUE_MIN_GAP_SEC` / `SOSOVALUE_CACHE_TTL_SEC` (Python). On a paid tier
drop the gap to 1000 ms and the TTL to ~60 s for near-realtime data.

The agent loop in [agent-service/src/main.py](agent-service/src/main.py)
rotates through `["DePIN", "RWA", "AI", "Memes", "GameFi"]` one sector per
cycle and sleeps `AGENT_LOOP_SEC` (default 120 s) between iterations so each
cycle has at least one fresh SoSoValue token to spend.

### SoDEX REST v1

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
[lib/api/sodex.ts → `buildExchangeAction`](lib/api/sodex.ts) returns the
typed-data envelope to feed into your wallet.

Copy [`.env.example`](.env.example) and [`agent-service/.env.example`](agent-service/.env.example).

## Roadmap to production

- Replace SSI / SoDEX stubs with real on-chain calls (viem on the Node side, web3.py inside the agent).
- Persist proposals / payouts in Postgres; the `/api/proposals` route currently returns a deterministic snapshot.
- Push the LangGraph checkpoint to Postgres or Redis (`LANGGRAPH_CHECKPOINT_DIR`) so long-running loops survive restarts.
- Stream reasoning entries via SSE rather than polling.
- Wire the SoSoValue OpenAPI v2 client to your real key — the synthetic data shape already matches the response model the agent expects.

## License

Internal — subject to MDlabs policy.
