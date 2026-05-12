# Product Roadmap — HypeNode

> **3-Wave plan** from today's MVP to production-ready. Each wave has a clear theme, a specific value proposition, and measurable exit criteria. No wave is "100% done" — we close a wave when its exit criteria are met and shift the rest into the next one.

```
┌─ WAVE 1 ───────────────┐  ┌─ WAVE 2 ──────────────┐  ┌─ WAVE 3 ──────────────┐
│                        │  │                       │  │                       │
│  INDEXER MVP           │  │  PUBLISHER REVENUE    │  │  PRODUCTION HARDENING │
│  (current — we are     │→ │  LOOP                 │→ │  + SCALE              │
│  here right now)       │  │                       │  │                       │
│                        │  │  13 May → 29 May      │  │  30 May → 15 Jun      │
│  1 May → 12 May        │  │  (17 days)            │  │  (17 days)            │
│  (12 days, day 10/12)  │  │                       │  │                       │
└────────────────────────┘  └───────────────────────┘  └───────────────────────┘
   Audience: Trader            Audience: Creator +        Audience: Multi-tenant
   (personal use)              Subscriber                 (production users)
```

---

## Wave 1 — Indexer MVP (CURRENT WAVE)

**Period: 1 May 2026 → 12 May 2026** (12 calendar days, ~7 engineering days after weekends)
**Status today (10 May): day 10 of 12, feature complete — all 7 exit criteria met, plus some Wave 2 scope pulled forward (see "Beyond original scope" below).**

### Theme
**"A single user can really manage their own index portfolio end-to-end."**

User connects a wallet, builds a basket from real SoSoValue data, simulates it, deploys it on-chain, and watches it from their portfolio — all without multi-tenant features or any revenue mechanic.

### Wave 1 value proposition
A personal trader or quant can **research → execute → monitor** a strategy without watching the market manually. The agent is the engine; the user owns the strategy.

### What's done in Wave 1 ✅

| Component | Status | Notes |
|---|---|---|
| **Auth flow (SIWE + iron-session)** | ✅ Done | MetaMask connect → sign-in → cookie session. Plus auto-redirect for signed-in users in `app/page.tsx` to their role home. |
| **Wallet-mismatch detection** | ✅ Done | `useSessionGuard` + `WalletMismatchBanner` (strict Option A). |
| **Dashboard** | ✅ Done | Sector momentum, SSI snapshots, news, smart-money widget. |
| **Tokens explorer** | ✅ Done | Universe + token detail (4 tabs: economics, supply, pairs, fundraising). |
| **Fundraising tracker** | ✅ Done | **Refactored 9 May**: the original `/fundraising/projects` endpoint was deprecated upstream → migrated to `/currencies/{id}/fundraising` (probe top 60 currencies + flatten into an event timeline) + table rows mirroring sosovalue.com/assets/fundraising. |
| **Builder — full pipeline** | ✅ Done | Signal → Constituents → Weights → Simulate → Deploy. |
|   ↳ Sector picker + N assets + weighting rule | ✅ | Wired to API (the rule genuinely affects the basket). |
|   ↳ Add-asset modal | ✅ | Search the SoSoValue universe. |
|   ↳ Real 90-day backtest | ✅ | Replays klines, computes Sharpe / Max DD / Win rate / vs BTC + ETH. |
|   ↳ Save / Load draft | ✅ | localStorage. |
|   ↳ Sign & Deploy | ✅ | Wagmi `useWriteContract` → `SSIRegistry.registerIndex` on Sepolia. |
| **Portfolio (real)** | ✅ Done | SSI Registry creator filter + SoDEX balances + reference benchmark. |
| **Agent observability** | ✅ Done | LangGraph state graph + reasoning stream (live polling, 5 s). |
| **Agent control** | ✅ Done | Pause / Step / Reset / Halt — 4 POST endpoints + UI buttons. |
| **Visibility-aware API polling** | ✅ Done | Pauses polling when the tab is hidden. |
| **Path-specific cache TTL** | ✅ Done | klines 30 min, news 30 s, etc. — fixes the "rate-limit guard serving stale" bug. |
| **Logo system** | ✅ Done | CoinGecko via `/api/asset-logos` + `ProjectLogo` + `SsiCompositeLogo` + `InvestorLogo`. |
| **Loading states (LogoSplash)** | ✅ Done | Centered logo + ring-ripple animation. |
| **Strategy agent (Claude tool-use)** | ✅ Done | Opt-in via `ANTHROPIC_API_KEY`; replaces the rule-based version. |
| **Anthropic retry logic** | ✅ Done | Token bucket + exponential backoff for 529 responses. |

### What's still outstanding in Wave 1 ⚠️

| Component | Status | Estimate |
|---|---|---|
| **Sector picker UI in dropdown** | ✅ Done | — |
| **State-driven step indicator** | ✅ Done | — |
| **Triggers field in `registerIndex`** | ✅ Done | "Rebalance triggers" UI in builder + `rebalanceCron` ABI field wired. |
| **Chart period buttons (1D/1W/1M/3M/ALL)** | ✅ Done client-side | — |
| **History page on real data** | ✅ Done | Agent decision log persisted to SQLite, `AgentDecisionLog` panel in `/history`. |
| **Risk page real wiring** | ✅ Done | Risk-gate config persistent + per-rule toggles + manual override. |
| **Backtest page (standalone)** | ✅ Done | Page exists (~358 lines). |
| **Settings page** | ✅ Done | Page exists (~457 lines). |
| **Chat page wiring** | ✅ Done (far exceeds scope) | **22 tools** registered — see "Beyond original scope" for detail. |
| **Per-asset USD price aggregation in Portfolio** | ✅ Done at snapshot level | `buildPriceLookup` + price-aware `buildSnapshotPositions` in `lib/api/portfolio-snapshot.ts`. Cron route batches one price lookup across all wallets (union of symbols → single `/currencies` walk + per-symbol snapshot fetch). Manual snapshot endpoint prices the user's own balances. Indices still `usd_value: null` pending the Wave 2 vault NAV. Live `BalanceTable` USD column is a small follow-up. |
| **Logos + sponsor on token detail** | ✅ Done | — |
| **Empty state per tab on token detail** | ✅ Done | — |
| **Research page redesign** | ✅ Done | Table layout with filter rail (sector/source/strength/timeframe), sort, and per-investor search — matches the design HTML. |
| **WalletConnect Project ID** | ✅ Obsolete (Privy migration) | Pre-Privy, RainbowKit's `getDefaultConfig` required `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` to enable mobile pairing. After the Privy migration in [`app/providers.tsx`](../app/providers.tsx), Privy bundles WalletConnect internally and the env var is now unused (kept in `.env.example` as legacy only). |

### Beyond original scope (shipped in Wave 1, originally planned for Wave 2/3)

Between 5–10 May, a few Wave 2/3 features were pulled forward because they were needed to make the chat agent a powerful, end-to-end demo:

| Feature | Originally planned for | Status now |
|---|---|---|
| **Standalone MCP server** ([agent-service/src/mcp_server.py](../agent-service/src/mcp_server.py)) | Not in roadmap | ✅ 8 tools, entry point for Claude Desktop / external MCP clients. |
| **`/api/agent/tools/health`** — real per-tool readiness probe | Not in roadmap | ✅ Status `ok` / `degraded` / `missing_config` per tool, 16 tools monitored, colored dot rendered in the chat MCP panel. |
| **RootData OpenAPI integration** | Not in roadmap | ✅ Plus tier (1,000 free credits/mo), 3 chat tools (`search_rootdata`, `get_rootdata_project`, `get_rootdata_investor`). Upstream for the fundraising data on sosovalue.com. |
| **Browser-signed EIP-712 SoDEX trade flow** | Wave 2 (component 2.2, SoDEX router integration) | ✅ Pulled forward — agent prepares → wagmi `signTypedDataAsync` in the browser → server proxies `/api/sodex/submit` to the SoDEX gateway. **Server never holds the user's private key.** Buy + sell + balance + list orders + cancel via chat. |
| **Auto switchChain to ValueChain testnet** | Not in roadmap | ✅ On trade approval, wagmi prompts a switch to chainId 138565 first (auto-adds the chain to MetaMask if not present). |
| **Inner-code check at `/sodex/submit`** | Not in roadmap | ✅ Catches silent SoDEX rejections (outer code 0 + inner code != 0) — previously the UI claimed "ORDER SUBMITTED" while the order was rejected. |
| **Single-use envelope (prevents nonce reuse)** | Not in roadmap | ✅ UI removed the Retry button; user is told to re-submit a fresh prompt. SoDEX nonce is one-shot per signed envelope. |
| **Balance enrichment (locked / available / open orders)** | Not in roadmap | ✅ `sodex_get_balances` tool surfaces available + locked breakdown + open-orders summary + freshness (block time). Chat agent is required to echo verbatim — defends against LLM rounding. |
| **Chat fundraising tools** | Wave 2/3 | ✅ `list_funding_rounds` (cross-currency event timeline) + `get_project_fundraising` (per-project detail) + RootData search/detail for pre-launch projects not listed yet. |
| **Chat agent identity** | Not in roadmap | ✅ Agent avatar uses the HypeNode logo (round 18×18) + inline loading splash while thinking. |

### Wave 1 exit criteria

Wave 1 is considered "ready to ship" when **all seven** items below are satisfied:

- [x] **Auth + session sync**: connect MetaMask → SIWE → land on `/dashboard` without friction.
- [x] **Builder full flow**: a user can build a basket → simulate → deploy to Sepolia, tx confirmed.
- [x] **Portfolio real wiring**: a connected wallet can see published indices + SoDEX balances.
- [x] **Agent observability**: `/agent` shows reasoning live, control buttons actually work.
- [x] **Quota safe mode**: `AGENT_LOOP_SEC=120` + path-specific cache TTL → fits inside the 100K/month SoSoValue tier.
- [x] **Risk-gate config functional**: a user can set a drawdown threshold (+ vol/sentiment/weight/outflow caps + per-rule toggles + manual override), and the agent honors it on every cycle. Persistent in SQLite (`agent-service/data/hypenode.db`), exposed via `GET/POST /risk/config`.
- [x] **History audit trail**: decision log is persistent in SQLite, one row per cycle (sector, basket, risk verdict, breaches, SoDEX placed/skipped/errors, SSI tx hash, strategy source/confidence/reasoning). Surfaced at `/history` via `GET /history` + `GET /history/stats`. Retention is indefinite — at least 30 days satisfies the exit criterion.

**All Wave 1 exit criteria are green.** The remaining work `5 → 12 May` (~7 calendar days) is polish — Settings page, standalone Backtest, Triggers field are all done; per-asset USD pricing landed at the snapshot level (live `BalanceTable` column is a tiny follow-up); the WalletConnect Project ID line item is obsolete after the Privy migration. End-of-week buffer for regression testing before Wave 2 kicks off.

---

## Wave 2 — Publisher Revenue Loop

**Period: 13 May 2026 → 29 May 2026** (17 calendar days, ~12 engineering days)

### Theme
**"Creators publish indices, subscribers deposit, USDC fees stream to creator wallets — all on-chain."**

Wave 2 transforms the Publisher surface from "publish metadata only" into a **revenue-generating product**.

### Wave 2 value proposition

For **creators / KOLs**:
- Monetize alpha / research as recurring USDC income.
- Track AUM, subscribers, and fee earnings in real time.
- Reputation building via a published, on-chain track record.

For **subscribers**:
- Discover index strategies from trusted creators.
- Deposit USDC, get automatic exposure to a basket.
- Auto-rebalanced, no manual trading.

For **the HypeNode platform**:
- Revenue begins (% of creator fees + subscription-tier upsell).
- Network effect: more creators → more subscribers → more data.

### Wave 2 must-have components

#### 2.1. HypeIndexVault smart contract
**Effort: 1.5–2 weeks engineering + 1 week of audit-ready tests**

Implementation options:
- **A. ERC-4626 vault** per index (one contract per index, factory pattern).
- **B. Multi-asset shared vault** (one contract handling many indices, indexed by `id`).

Recommendation: **B (shared vault)** for gas efficiency and a simpler UX.

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

Acceptance tests:
- [ ] User A deposits 100 USDC → shares minted.
- [ ] Vault swaps USDC → 8 underlying tokens via SoDEX router.
- [ ] NAV updates reflecting per-token price changes.
- [ ] After 365 days, management fee = 1% × AUM accrued correctly.
- [ ] User redeems → swaps back to USDC, performance fee deducted.
- [ ] Creator `claimFees` → USDC transfer to the creator wallet.

#### 2.2. SoDEX router integration
**Effort: 1 week** — ⚠️ **PARTIALLY PULLED FORWARD into Wave 1** (browser-sign + signed-envelope relay are done)

What's **ALREADY** done (in Wave 1, for the chat agent):
- [x] EIP-712 typed-data builder ([agent-service/src/tools/sodex.py:67](../agent-service/src/tools/sodex.py#L67)).
- [x] Browser-sign flow via wagmi `signTypedDataAsync` + server-side relay (`/api/sodex/submit`).
- [x] Per-address account_id resolver (`get_account_id_for(address)`).
- [x] Buy + sell side, market + defensive mode.
- [x] `submit_signed_envelope()` — accepts the browser signature, normalizes to SoDEX wire format, forwards.
- [x] Inner-code rejection check + chat-friendly error messages.

What **STILL NEEDS** to ship in Wave 2 (for the vault):
- [ ] On-chain SoDEX adapter contract (or use an EOA-signed off-chain dispatcher).
- [ ] Slippage protection (default max 1% per swap).
- [ ] Multi-leg execution (1 USDC deposit → 8 atomic swaps).
- [ ] Failed-swap rollback (partial-fill handling).
- [ ] Vault-as-signer flow — currently the chat agent uses the user wallet as signer; the vault flow needs contract-as-counterparty signing semantics.

#### 2.3. Daily fee-accrual cron
**Effort: 3–5 days**

A background job that, every day:
- [ ] Iterates active indices.
- [ ] Calls `accruePendingFees(indexId)` for each.
- [ ] Updates HWM.
- [ ] Logs for the earnings dashboard.

Implementation:
- Use the existing FastAPI agent service + APScheduler.
- Or external cron (GitHub Actions, Render cron, etc.).
- Or on-chain keeper bot (Gelato, Chainlink Automation).

#### 2.4. Subscriber-discovery UI
**Effort: 1 week**

New pages:
- [ ] `/discover` (or `/marketplace`) — browse all public indices.
- [ ] Filters: sector, AUM, 30-day return, creator reputation.
- [ ] `/discover/[id]` — index detail for prospective subscribers:
  - Real backtest performance.
  - Current AUM + subscriber count.
  - Creator profile + track record.
  - Transparent fee structure.
  - "Deposit to subscribe" button.

#### 2.5. Subscribe / deposit flow
**Effort: 4–5 days**

UX:
1. Subscriber opens `/discover/[id]`.
2. Clicks "Subscribe with X USDC".
3. Wagmi: approve USDC → call `vault.deposit`.
4. Confirm tx.
5. They're now a subscriber, share token shows up in their portfolio.

Needs:
- [ ] Approval flow + gas estimation.
- [ ] Slippage UI (preview swap output).
- [ ] Subscriber confirmation modal.
- [ ] Toast / success state.

#### 2.6. Real earnings dashboard
**Effort: 3–4 days**

`/publisher/earnings` is currently a placeholder. In Wave 2 we wire it to:
- [ ] Read vault state per published index (AUM, subscriber count).
- [ ] Read fee-accrual history.
- [ ] Cumulative earnings chart.
- [ ] Per-index breakdown: AUM, subscribers, management + performance revenue.
- [ ] CSV export for tax purposes.

#### 2.7. Hype Radar → auto-draft
**Effort: 1 week**

Hype Radar UI exists today but doesn't trigger drafts. In Wave 2:
- [ ] Backend agent monitors sentiment thresholds.
- [ ] On breach → auto-creates a proposal in `/publisher/proposals`.
- [ ] Notification to the creator (email + in-app).
- [ ] Creator can review + approve / reject + edit.

### Wave 2 optional components (nice-to-have)

- [ ] Creator profile page (Twitter handle, bio, badge).
- [ ] Creator reputation score (track record, AUM history, drawdown).
- [ ] Subscriber waitlist for private indices.
- [ ] Multi-currency base (beyond USDC: ETH, USDT).
- [ ] Performance fee with crystallization period (vest over 30 days).

### Wave 2 exit criteria

Wave 2 is ready when:
- [ ] User A publishes an index → User B subscribes with 100 USDC.
- [ ] Vault executes 8 swaps, share token minted.
- [ ] After 30 days (or a test fast-forward), creator A can claim management-fee USDC to their wallet.
- [ ] User B redeems → swaps back to USDC, performance fee deducted correctly (tested in both profitable and loss scenarios).
- [ ] Earnings dashboard shows real AUM + subscribers + fee revenue.
- [ ] `/discover` marketplace has at least 5 dummy indices to test the discovery flow.
- [ ] Smart-contract audit (internal review minimum, external is a bonus).
- [ ] Slippage protection tested under volatile-market conditions.

**Calendar window: 13 May → 29 May (17 days)**. The cumulative effort estimate for components 2.1–2.7 is ≈ 8–9 weeks serial — this is only feasible if:

1. **At least 2 devs in parallel** — a Solidity dev tackles the vault + SoDEX (2.1, 2.2, 2.3) while a full-stack dev tackles UI + wiring (2.4, 2.5, 2.6, 2.7).
2. **Scope cut**: defer to Wave 3 if slipping — advanced slippage protection, multi-leg atomic rollback, performance-fee crystallization.
3. **External audit deferred to Wave 3** — Wave 2 only needs internal review + Foundry test coverage > 80%.

If only one solo dev: the realistic scope is **vault + minimal subscribe + earnings read-only** (components 2.1, 2.5, 2.6 only). Components 2.4 marketplace and 2.7 Hype Radar auto-draft slide to Wave 3.

### Wave 2 risks

| Risk | Mitigation |
|---|---|
| **Smart-contract bug** drains subscriber funds | Audit before mainnet. Start on testnet. Pause mechanism. Withdrawal-only fallback mode. |
| **Slippage at SoDEX** for small AUM | Cap minimum deposit (e.g., 100 USDC). Limit max slippage to 1%. |
| **Fee-accrual race condition** | Atomic update. Re-entrancy guard. Fork-sim tests. |
| **Creator wallet compromise** → fee theft | 2-of-2 multisig for creators above $X AUM. Time-lock fee claims. |
| **MEV / sandwich attack** on large deposit swaps | Use private mempool (Flashbots). Or batch deposits hourly. |
| **Regulatory** (are these securities?) | Consult crypto lawyer. Disclosure prominent. Optional KYC for large creators. |

---

## Wave 3 — Production Hardening + Scale

**Period: 30 May 2026 → 15 June 2026** (17 calendar days, ~12 engineering days)

### Theme
**"We can launch to thousands of users without falling over, with real SLA and observability."**

Wave 1+2 focused on building features. Wave 3 focuses on operating at scale.

### Wave 3 value proposition

For **end users**: app is reliable, fast, available 24/7.
For **the HypeNode team**: we can support N users without N people on-call.
For **investors / acquirers**: due-diligence ready (security audit, observability, compliance).

### Wave 3 components

#### 3.1. Multi-chain + mainnet migration
**Effort: 1.5–2 weeks**

Currently Sepolia testnet only. In Wave 3:
- [ ] Deploy SSIRegistry + HypeIndexVault to mainnet (Ethereum or ValueChain L1).
- [ ] Multi-chain dropdown in the UI (Sepolia / mainnet / ValueChain).
- [ ] Per-chain config: RPC, USDC address, SoDEX endpoint, gas oracle.
- [ ] Cross-chain withdrawal flow (if required).

#### 3.2. Activity-aware loop
**Effort: 3–5 days**

Discussed earlier — deferred from Wave 1. In Wave 3:
- [ ] Track `_last_user_activity` in `main.py`.
- [ ] Loop pauses if no user activity for > 5 minutes.
- [ ] Quota burn drops dramatically during idle periods.
- [ ] Still maintains background activity during working hours.

#### 3.3. Long page revalidate + manual refresh
**Effort: 2–3 days**

Wave 1 decision: short revalidate windows for testing. In Wave 3:
- [ ] Per-page revalidate: tokens 1h, fundraising 6h, dashboard 5min.
- [ ] Manual refresh button on dashboard, tokens, fundraising.
- [ ] Stale-data indicator ("data 12min ago").
- [ ] Optimistic UI on refresh.

#### 3.4. USSI emergency hedge contract
**Effort: 2 weeks**

When the risk gate trips → vault rotates into the USSI hedge instrument. Today this is just the string label "USSI". In Wave 3:
- [ ] Decide the USSI implementation: synthetic stablecoin? Treasury-bond token? Cash equivalent?
- [ ] Deploy the hedge contract.
- [ ] Wire `risk_node` in `graph.py` to trigger the basket → USSI swap.
- [ ] Auto-revert when the gate clears (or manual unlock).

#### 3.5. Observability stack
**Effort: 1 week**

- [ ] **Sentry** for error tracking (Next.js + FastAPI).
- [ ] **Datadog / Grafana Cloud** for metrics (request latency, error rate, quota usage).
- [ ] Custom dashboards:
  - SoSoValue quota burn rate per day.
  - Anthropic token spend per day.
  - Active users / wallets connected.
  - On-chain tx success rate.
  - Vault AUM growth.
- [ ] Alerts: quota > 80%, 5xx error spike, agent-loop crash.

#### 3.6. Performance optimization
**Effort: 1 week**

- [ ] **Server-side prefetch** for dashboard cold load (parallel SoSoValue calls with timeout).
- [ ] **CDN caching** for static assets (logos, fonts, CSS).
- [ ] **Database** for persistent state (currently in-memory inside the FastAPI runner — restart wipes it):
  - User config (risk thresholds, triggers).
  - Decision history (PostgreSQL or Redis).
  - Subscriber positions (mirror from on-chain for fast reads).
- [ ] **Worker queue** (BullMQ or Celery) for:
  - Fee-accrual cron.
  - Email notifications.
  - Heavy backtest computations.

#### 3.7. Security hardening
**Effort: 2 weeks (including audit)**

- [ ] **External smart-contract audit** (Trail of Bits / OpenZeppelin / Quantstamp).
- [ ] Bug bounty program on Immunefi.
- [ ] Rate limiting per IP on Next.js routes (Upstash Ratelimit).
- [ ] CSRF protection.
- [ ] Audit hot-key handling (`SODEX_PRIVATE_KEY`, `SSI_PRIVATE_KEY`) — minimum multisig for treasury.
- [ ] DDoS protection via Cloudflare.
- [ ] Internal pentest.

#### 3.8. Testing & QA
**Effort: 1.5 weeks**

- [ ] **E2E tests** (Playwright or Cypress):
  - Full flow: connect wallet → builder → simulate → deploy.
  - Subscribe flow: discover → deposit → check share token.
  - Redeem flow + fee distribution.
- [ ] **Unit tests** for smart contracts (Foundry / Hardhat).
- [ ] **Integration tests** for the agent loop (mock SoSoValue + Anthropic).
- [ ] **Fork tests** against mainnet for vault interactions.
- [ ] **Load tests** for Next.js routes (artillery / k6).

#### 3.9. Compliance & legal
**Effort: external + 1 week integration**

- [ ] **Terms of Service** + Privacy Policy lawyered.
- [ ] **Risk disclosure** prominent in the UI (creator + subscriber).
- [ ] **Optional KYC** via Sumsub / Persona for creators above $X AUM (if required).
- [ ] **Geo-blocking** for restricted jurisdictions (US restricted, sanctioned countries).
- [ ] **Tax reporting**: 1099-style export for subscribers and creators.

#### 3.10. Marketing & growth tooling
**Effort: 1 week**

- [ ] **Referral system**: creator gets % of subscribers they refer.
- [ ] **Social proof**: "X subscribers, $Y AUM, +Z% return" in the marketplace.
- [ ] **OG image** dynamic per index (auto-generated screenshot).
- [ ] **Analytics**: PostHog / Mixpanel for funnel tracking.
- [ ] **Email/Discord notifications**: deposit confirmation, rebalance alerts, drawdown breach.

#### 3.11. Mobile responsive + PWA
**Effort: 1.5 weeks**

Currently desktop-first. In Wave 3:
- [ ] Audit every page at mobile breakpoints.
- [ ] Drawer-style navigation on mobile.
- [ ] Touch-friendly chart interactions.
- [ ] PWA manifest + offline shell.
- [ ] iOS / Android safe-area handling.

#### 3.12. Documentation site
**Effort: 1 week**

- [ ] Public docs (Docusaurus or Mintlify): user guide, creator guide, API reference.
- [ ] Tutorial videos (Loom embed).
- [ ] FAQ section.
- [ ] Public roadmap page (a polished subset of this document).

#### 3.13. Customer support tooling
**Effort: 3–5 days**

- [ ] In-app help widget (Intercom / Crisp / Plain).
- [ ] Status page (statuspage.io or hosted) for uptime + outage comms.
- [ ] Internal admin dashboard:
  - User search by wallet.
  - Manual fee-distribution override (rare).
  - Refund flow (if required).

#### 3.14. Pricing & billing
**Effort: 1 week**

- [ ] Subscription tier for creators (Free / Pro / Enterprise).
- [ ] Stripe integration.
- [ ] Tier-based features:
  - Free: 1 published index, basic backtest.
  - Pro ($X/mo): unlimited indices, Claude tool-use unlocked, priority support.
  - Enterprise (custom): private deployment, white-label, dedicated agent.

### Wave 3 exit criteria

Wave 3 is considered "production-launch ready" when:
- [ ] All flows have E2E tests passing.
- [ ] Smart contracts audited (external report with no critical/high findings).
- [ ] Observability stack live (Sentry + metrics dashboard + alerts).
- [ ] Mainnet deployment functional (Ethereum or ValueChain mainnet).
- [ ] Mobile responsive on iOS/Android (audit at primary breakpoints).
- [ ] Public documentation live (docs site with user/creator guide).
- [ ] Status page reachable.
- [ ] Legal sign-off on ToS + Privacy.
- [ ] At least 1 paying customer (creator or subscriber pilot).

**Calendar window: 30 May → 15 June (17 days)**. Cumulative effort for components 3.1–3.14 is ≈ 16–20 weeks serial — Wave 3 within a 17-day window **must be ruthlessly prioritized**:

**MUST-HAVE for launch (in-scope for the 17 days):**
- 3.1 Mainnet migration (deploy + smoke test).
- 3.5 Minimum observability stack (Sentry + 1 dashboard).
- 3.7 Security: internal review + rate limiting + multisig hot keys (external audit kicked off in parallel at the start of Wave 3, results may land post-launch).
- 3.8 E2E tests for happy paths (3 primary scenarios).
- 3.9 Compliance: ToS + Privacy + risk-disclosure UI (lawyer engagement runs in parallel).

**NICE-TO-HAVE (defer to post-launch if slipping):**
- 3.2 Activity-aware loop, 3.3 long revalidate.
- 3.4 USSI hedge contract.
- 3.6 Performance optimization (database, worker queue).
- 3.10 Marketing tooling, 3.11 Mobile/PWA, 3.12 Doc site, 3.13 Customer support, 3.14 Pricing.

External audit (3.7) is realistically 2–4 weeks of wall-clock time; **kick it off on day 1 of Wave 3**, results may not land until the first week post-launch — soft-launch via a whitelist beta while waiting for a clean audit.

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

### Suggested daily cadence

| Wave | Period | Engineer-days / calendar-days | Required per working day |
|---|---|---|---|
| Wave 1 | 1 May → 12 May | ~8 engineer / 12 calendar | 1 solo full-stack is OK |
| Wave 2 | 13 May → 29 May | ~12 engineer / 17 calendar | 2 devs in parallel (Solidity + full-stack), or scope cut to vault + subscribe MVP |
| Wave 3 | 30 May → 15 Jun | ~12 engineer / 17 calendar | 2–3 devs (must-have only) + external lawyer running in parallel |

### Important dependencies

**Wave 2 dependencies:**
- ⬅️ Wave 1 builder + portfolio must be stable.
- ⬅️ SSI Registry contract ABI must not change.
- ⬅️ SoDEX integration already verified working — ✅ done in Wave 1 (browser-sign EIP-712 + signed-envelope relay).
- ⬅️ Chat-agent tool surface already comprehensive (22 tools incl. SoDEX trading) — ✅ done in Wave 1.

**Wave 3 dependencies:**
- ⬅️ Wave 2 vault contract finalized + audited.
- ⬅️ Sufficient AUM to justify mainnet gas costs.
- ⬅️ Legal advisor onboarded by the end of Wave 2.

---

## What we're explicitly NOT building (anti-roadmap)

To stay focused, here's what we will **not** build in these 3 waves:

| Not building | Reason |
|---|---|
| **Custom L1/L2 deployment** (HypeChain) | Use Sepolia/ValueChain first; evaluate if scale demands it. |
| **NFT-gated access** for premium features | Subscription tiers are enough; NFTs add complexity. |
| **Cross-chain bridge** asset transfer | Use existing bridges (Wormhole, LayerZero) instead of rolling our own. |
| **Margin / leverage trading** | Spot only in v1–3. Margin is a whole new compliance surface. |
| **Other order-book DEX integrations** (beyond SoDEX) | Stay focused; SoDEX is enough for index rebalancing. |
| **Synthetic / perp indices** | Spot only. Synthetic perp requires a separate vault architecture. |
| **Tokenized index as a public ERC-20** | Vault share tokens are already ERC-4626; transfer lock-up simplifies accounting. |
| **Native mobile apps** (iOS/Android Swift/Kotlin) | PWA is enough for Wave 3. Native apps post-launch based on demand. |
| **DAO governance** for the HypeNode protocol | Centralized in v1–3; tokenize / decentralize post-launch if the strategy calls for it. |

---

## Success metrics — what we measure each wave

### Wave 1 (current) — adoption metrics
- DAU (daily active wallets).
- # of indices deployed on Sepolia.
- # of successful backtests run.
- Average session duration.
- Bug rate per release.

### Wave 2 — product-market-fit signals
- # of creators publishing public indices.
- # of subscribers per index (avg + median).
- AUM growth week-over-week.
- Fee revenue (total USDC distributed).
- 30-day subscriber retention.
- Creator NPS.

### Wave 3 — business / growth metrics
- MRR (Monthly Recurring Revenue) from subscription tiers.
- LTV / CAC.
- Total mainnet AUM.
- Uptime SLA (target 99.9%).
- Sub-hour P50 latency.
- Customer-support response time.
- Audit findings closed.

---

## Support per wave — team and cost

### Wave 1 (1 May → 12 May)
- 1 full-stack dev (you + agent assistance).
- $50–100 for SoSoValue + Anthropic + hosting in this period.
- No designer / lawyer / auditor needed.

### Wave 2 (13 May → 29 May)
- 1 Solidity dev (mid-senior, full-time 17 days) — **book before 12 May**.
- 1 full-stack dev (full-time, continuing from Wave 1).
- 1 designer (part-time for the Discover marketplace UI).
- $5K–10K for internal audit / bug-bounty contest.
- $100–200 for hosting upgrade + Sentry tier (17-day window).

### Wave 3 (30 May → 15 Jun)
- Wave 2 team continues, plus:
- 1 senior backend (observability + database).
- 1 QA engineer (part-time).
- 1 crypto lawyer (hourly consulting) — **engage by the first week of May to be ready by 30 May**.
- $30K–80K for external audit (Trail of Bits / OpenZeppelin) — **book before 13 May because lead time is 2–4 weeks**.
- $500–2,000 for production infra (Vercel Pro, RDS, Datadog, Sentry) for this period.

**Total runway 1 May → 15 June: $50K–100K + 6.5 calendar weeks (~32–35 parallel engineering days)**. The timeline is aggressive — parallelization and scope discipline are mandatory. Critical path = external audit (book now, results may land post-launch).

---

## Decision points at every wave transition

### End of Wave 1 → start of Wave 2 (deadline 12 May → kick-off 13 May)
- ✅ Does Wave 1 have ≥10 users (waitlist / closed beta) who've expressed interest in publishing an index?
- ✅ Is the cost burn (SoSoValue + Anthropic) sustainable at projected scale?
- ✅ Is the product-market signal strong enough to justify investing in Wave 2?

If **NO**, iterate on Wave 1 — UX polish, more sectors, better simulate UX. Wait for a stronger signal.

### End of Wave 2 → start of Wave 3 (deadline 29 May → kick-off 30 May)
- ✅ Have ≥3 creators published indices that attracted real subscribers?
- ✅ Is total AUM ≥$10K (proof the revenue mechanic works)?
- ✅ Are there any major vault bugs blocking? (If yes, close Wave 2 first.)
- ✅ Is cash runway sufficient for the full Wave 3 scope?

If **NO**, partial Wave 3 (security audit + minimal observability), defer marketing & mobile.

### End of Wave 3 → public launch (target 15 June)
- ✅ External audit clean (no critical/high findings).
- ✅ Mainnet deployment tested with small AUM ($X test).
- ✅ Status page + observability live.
- ✅ Legal ToS + Privacy in place.
- ✅ Customer-support channel ready.

If **NO**, do a soft launch with limited whitelist beta until the gaps are closed.

---

## Appendix — quick references

- [Indexer vs Publisher overview](./indexer-vs-publisher.md)
- [Existing roadmap (legacy)](./roadmap.md)
- [SoSoValue API reference](./sosovalue-api.md)
- [Application docs (Indonesian)](./dokumentasi-aplikasi.md)

---

**Last updated**: 2026-05-10
**Owner**: HypeNode core team
**Status**: Wave 1 in progress, day 10 of 12 (1 May → 12 May), feature complete + Wave 2 scope (SoDEX trading via chat) pulled forward. Remaining work is polish + WalletConnect ID + per-asset USD aggregation in portfolio before Wave 2 kicks off.
**Public-launch target**: 15 June 2026
