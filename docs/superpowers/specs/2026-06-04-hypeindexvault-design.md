# HypeIndexVault — Protocol Core Design Spec

- **Date:** 2026-06-04
- **Wave:** 2 — Publisher Revenue Loop
- **Sub-project:** 1 of 6 (the on-chain foundation; everything else depends on it)
- **Status:** Design approved — pending written-spec review before implementation planning
- **Owner:** HypeNode core team

---

## 1. Context & motivation

HypeNode today is a non-custodial system: `contracts/SSIRegistry.sol` stores index
**metadata only** (`creator`, `symbol`, `tokens[]`, `weightsBps[]`, `mgmtFeeBps`,
`perfFeeBps`, `rebalanceCron`). The fee fields are inert — written once, never read,
never move money. The whole Publisher Revenue Loop (subscriber deposits, USDC fee
streaming, real `/discover` AUM/subscriber ranking, real publisher earnings) is
blocked on a contract that actually **custodies USDC, mints index shares, and accrues
fees**. That contract does not exist (0% built — no stub, no artifact, no oracle, no
USDC configured).

This spec defines **only** that on-chain foundation: the `HypeIndexVault` contract, its
trusted NAV price-signer oracle, the keeper/relayer that executes SoDEX swaps, and the
Foundry toolchain + tests. The app-layer pieces (fee/subscription indexer → Supabase,
subscribe/redeem frontend, real earnings + tax export, `/discover` ranking, agent
auto-draft bridge) are **separate specs** that follow this one.

### Locked decisions (from brainstorming, 2026-06-04)

| Decision | Choice | Rationale |
|---|---|---|
| Direction | **Full custodial vault** | User chose the real Wave 2, not the non-custodial mirror MVP |
| Target chain | **ValueChain** — testnet 138565 first → mainnet 286623 | Co-located with SoDEX + tradeable constituents; already wired in `lib/chains.ts` |
| Deposit settlement | **Async mint-on-fill** | SoDEX swaps are off-chain/async; subscriber bears own slippage; pool protected from MEV/price-drift; safest on thin testnet liquidity |
| Oracle trust posture | **Single EIP-712 signer + staleness/sanity guard + circuit-breaker pause**; multisig is a hard gate before mainnet funds | Only viable path on this stack; no decentralized feed exists for synthetic constituents |
| Share accounting | **Internal non-transferable ledger** | Smallest audit attack surface; matches roadmap transfer-lockup + per-subscriber `SubscriberPosition` |
| Fee accrual | **Share-dilution** | Keeps subscriber USDC fully invested; no USDC moved per accrual; standard ERC4626 pattern |
| Vault topology | **Shared vault** (one contract, many indices, keyed by `indexId`) | Roadmap recommendation B — gas efficiency + simpler UX |
| HWM | **Per-subscriber** | Fair: each subscriber pays perf only on gains above their own entry |
| Fees | **1%/yr management + 10% high-water-mark performance**, USDC settlement | From the brief |

---

## 2. Scope & trust boundary

**In scope:** `HypeIndexVault.sol`; the off-chain price-signer service; the off-chain
keeper/relayer; a testnet `MockUSDC`; the Foundry project + test suite.

**Out of scope (separate specs / Wave 3):** fee/subscription event indexer → Supabase
(`pb_earnings`/`pb_subscriptions`/`pb_creators`); subscribe/redeem frontend; real
earnings dashboard + tax/CSV export + enable Withdraw; `/discover` real ranking;
agent auto-draft → proposal queue bridge; perf-fee crystallization vesting; creator
multisig for large AUM; private-mempool/MEV protection; advanced atomic multi-leg
rollback.

**Trust boundary (the audit-critical statement).** In the MVP the **price-signer** (one
key) and the **keeper** (one hot key) are *trusted* parties. The vault is the on-chain
custody of USDC and the single source of truth for shares, fees, and HWM; the keeper
executes SoDEX swaps; the signer supplies NAV. The guarantee to a subscriber: *shares
are redeemable for USDC at a signed NAV, subject to realized swap execution.* Hardening
— multisig signer, per-tx caps, timelocked fee claims, external audit — is a **hard gate
before any mainnet funds**.

---

## 3. Components

| Component | Location | Responsibility |
|---|---|---|
| `HypeIndexVault.sol` | on-chain (ValueChain) | USDC custody; non-transferable share ledger; async deposit/redeem request queue; mgmt + perf (HWM) fee accrual via dilution; `claimFees`; pause/guardian; signed-NAV verification |
| **Price-signer service** | `agent-service/` (new module) | Compose weighted basket NAV from SoSoValue prices (reuse `lib/api/sosovalue.ts` weighted-NAV logic) and sign EIP-712 price attestations with staleness metadata |
| **Keeper / relayer** | `agent-service/` (reuse `SSI_PRIVATE_KEY` + viem pattern from `lib/api/ssi.ts`) | Listen for `DepositRequested`/`RedeemRequested`; execute SoDEX swaps (slippage cap 1%); call `settleDeposit`/`settleRedeem`/`cancelDeposit`; trigger daily `accrueMgmt` |
| `SSIRegistry.sol` | on-chain (unchanged) | `indexId = keccak256(symbol)`; source of `tokens[]` / `weightsBps[]` / `creator` |
| `MockUSDC.sol` | on-chain (testnet 138565) | ERC20, 6 decimals, faucet mint for testing. Mainnet uses canonical USDC (open item §9) |
| **Foundry project** | `contracts/` | `forge` build + test; replaces the current Remix-only deploy flow |

---

## 4. On-chain data model

```solidity
struct IndexVault {
    bool    active;
    address creator;
    uint256 totalShares;        // includes creator fee shares
    uint256 usdcReserve;        // idle USDC (pulled-but-not-deployed, or redeem proceeds in flight)
    uint256 lastMgmtAccrualAt;  // timestamp of last management-fee accrual
    uint256 creatorFeeShares;   // shares minted to the creator, claimable
}
mapping(bytes32 => IndexVault) public vaults;             // indexId => vault state

struct Position {
    uint256 shares;
    uint256 hwmNav;             // per-subscriber high-water-mark NAV-per-share
}
mapping(bytes32 => mapping(address => Position)) public positions;

struct PendingDeposit { address who; uint256 usdcIn;  uint256 minSharesOut; uint64 ts; }
struct PendingRedeem  { address who; uint256 shares;  uint256 minUsdcOut;   uint64 ts; }
mapping(uint256 => PendingDeposit) public pendingDeposits;   // requestId => ...
mapping(uint256 => PendingRedeem)  public pendingRedeems;
uint256 public nextRequestId;
```

Shares are an **internal non-transferable ledger** (no ERC20/ERC1155 surface). Basket
assets are custodied in a vault-controlled account (see §9 spike for the exact location,
which depends on whether SoDEX exposes an on-chain router).

---

## 5. Core flows (async mint-on-fill)

### 5.1 Subscribe / deposit
1. Subscriber: `approve(USDC, vault, amount)` then
   `requestDeposit(indexId, usdcAmount, minSharesOut)`.
2. Vault pulls USDC into `usdcReserve`, records a `PendingDeposit`, emits
   `DepositRequested(requestId, indexId, who, usdcAmount)`.
3. Keeper executes SoDEX swaps `USDC → 8 constituents` per `weightsBps`
   (max 1% slippage per leg), waits for fills.
4. Keeper calls `settleDeposit(requestId, signedNav, basketValueUsdc)`:
   - Vault verifies the signed NAV (§6 guards).
   - `shares = basketValueUsdc * 1e18 / navPerShare` (first-deposit handling §7).
   - Require `shares >= minSharesOut`, else route to refund.
   - If subscriber's first position: set `hwmNav = navPerShare`.
   - Mint shares; emit `Subscribed`.
5. On failed/partial/timed-out swaps: `cancelDeposit(requestId)` refunds the held USDC
   to the subscriber.

> "One-click" UX is preserved: a single approve+deposit interaction; shares simply
> appear after the fill settles (seconds–minutes), surfaced via a pending state in a
> later frontend spec.

### 5.2 Rebalance (creator)
Creator triggers a rebalance off-chain; keeper swaps the basket to new `weightsBps`.
Subscribers **auto-follow for free** because the vault pools assets — no per-subscriber
transaction is needed. (Detailed rebalance authorization lives in a follow-up spec; the
vault only needs to expose keeper-gated basket bookkeeping hooks.)

### 5.3 Redeem / cancel (anytime)
1. `requestRedeem(indexId, shares, minUsdcOut)` — escrow the shares, emit
   `RedeemRequested(requestId, ...)`.
2. Keeper sells the proportional basket via SoDEX.
3. `settleRedeem(requestId, usdcReceived, signedNav)`:
   - Crystallize the per-subscriber performance fee (§6.2).
   - Transfer net USDC to the subscriber; burn the escrowed shares; emit `Redeemed`.

### 5.4 Claim fees (creator)
`claimFees(indexId)` redeems the creator's `creatorFeeShares` to USDC (internal
`requestRedeem` path) and transfers to the creator wallet.

---

## 6. NAV, oracle & fee math

### 6.1 NAV & oracle guards
Because basket assets are custodied **off-chain** (SoDEX account — §9), the contract
cannot recompute NAV from on-chain holdings. Instead the **price-signer computes
`navPerShare` off-chain** as `Σ(price_i × qty_i) / totalShares` from current SoSoValue
prices and the basket holdings, then issues an **EIP-712 signed attestation**
`{ indexId, navPerShare, signedAt }`. On every `settle*` the vault **verifies the
signature and enforces guards** (it does not recompute the value):
- **Staleness:** `signedAt` within a freshness window — default **5 minutes**.
- **Sanity:** per-update deviation bound vs last accepted NAV — default **±20%**.
- **Circuit breaker:** `pause()` by a guardian halts all `settle*`/deposit paths.
- **Signer rotation:** `setSigner(addr)` behind owner/timelock.

### 6.2 Fees (share-dilution)
- **Management — 1%/yr, accrued daily.** `accrueMgmt(indexId)` computes
  `feeShares = totalShares × 0.01 × Δt / 365 days` and mints them to
  `creatorFeeShares`. **Idempotent per `(indexId, UTC-day)`** to survive cron retries.
- **Performance — 10%, high-water-mark, per-subscriber, crystallized on redeem (MVP).**
  On `settleRedeem`, if `nav > hwmNav`:
  `profit = (nav − hwmNav) × shares`; `perfFee = 10% × profit` → minted as creator
  shares (dilution); then `hwmNav = nav`. Periodic crystallization is deferred.

> Default knobs (freshness 5 min, deviation ±20%, slippage 1%, min-deposit 100 USDC)
> are starting values to confirm at spec review.

---

## 7. Security & audit scope

- **Reentrancy:** `nonReentrant` on every external state-changing entry.
- **First-deposit inflation / donation attack:** OZ ERC4626-style mitigation — dead
  shares / virtual-offset / minimum-shares.
- **Oracle manipulation:** the §6.1 staleness + sanity + pause guards.
- **Fee/HWM rounding correctness:** round in the protocol's favor; invariant tests.
- **Access control:** `onlyKeeper` for `settle*`; `onlyGuardian` for `pause`;
  `onlyCreator` for `claimFees`; owner/timelock for `setSigner`/`setKeeper`.
- **Caps:** per-tx deposit cap + min-deposit (≥100 USDC) + per-index AUM cap (testnet).
- **Key exposure:** post-vault, `SSI_PRIVATE_KEY`/keeper key controls real funds —
  document rotation + the mainnet multisig gate.

**Target:** internal review + **Foundry coverage > 80%**. External audit is a Wave 3
gate before mainnet funds.

---

## 8. Testing (Foundry)

Set up `forge` under `contracts/`. Suite:
- Unit: deposit/settle/redeem/cancel/claim happy + revert paths.
- Invariant: `Σ positions.shares + creatorFeeShares == totalShares`; USDC conservation.
- **Time-warp:** management fee exactly 1% after 365 days.
- Performance/HWM in **both profit and loss** scenarios (no fee on loss; fee only above HWM).
- First-deposit inflation attack is neutralized.
- Oracle stale / out-of-bound price reverts.
- Partial-fill / timeout → `cancelDeposit` refund is whole.

Mirror the **roadmap acceptance tests**: deposit→shares; rebalance; NAV updates with
price; mgmt 1% accrues; redeem deducts perf fee; `claimFees` lands USDC in the creator
wallet.

---

## 9. Open items (spike / verify before or at the start of implementation)

- 🔴 **SPIKE — deposit→swap mechanism (do this first).** Does SoDEX expose an
  **on-chain router/adapter** or a *contract-as-counterparty* flow on ValueChain
  (286623/138565)? If yes → custody can be trust-minimized (vault calls the router
  directly). If no → forced **EOA-keeper** model: the keeper holds funds in-flight and
  basket assets live in a vault-owned SoDEX account (effective custody at the keeper).
  The roadmap already flags this ("vault-as-signer flow needed"). **The outcome decides
  whether this is a custodial-pure vault or vault-accounting + trusted-keeper execution
  — and it must be stated honestly in user-facing copy.**
- 🟠 **VERIFY — USDC on ValueChain:** confirm the canonical USDC ERC20 address +
  real spot liquidity on mainnet 286623. Testnet uses `MockUSDC`. Roadmap/`sodex.py`
  note testnet spot pairs are thin / often `cancel-only`.
- 🟠 **Basket custody location** (vault contract vs vault-owned SoDEX account) — resolved
  by the spike above.

---

## 10. Build sequence (this sub-project)

1. **Spike** the SoDEX on-chain-router question (§9) — gates the custody model.
2. Stand up the **Foundry** project + `MockUSDC` on testnet 138565.
3. Write `HypeIndexVault.sol` (data model §4, flows §5, oracle+fees §6, security §7).
4. Build the **price-signer** service (EIP-712 + staleness) in agent-service.
5. Build the **keeper/relayer** (swap execution + `settle*` + daily `accrueMgmt`).
6. Foundry test suite to >80% (§8) + internal review.
7. Deploy to ValueChain testnet; run the roadmap acceptance scenarios end-to-end.

(External audit + mainnet + multisig signer = Wave 3 gate, not this spec.)

---

## 11. Acceptance criteria (definition of done for this spec)

- [ ] SoDEX router spike resolved and the custody model documented honestly.
- [ ] `HypeIndexVault` deployed on ValueChain testnet with `MockUSDC`.
- [ ] Subscriber A: `requestDeposit(100 USDC)` → keeper fills → shares minted at signed NAV.
- [ ] NAV reflects per-constituent price changes via signed attestations.
- [ ] After a 365-day time-warp, management fee equals 1% of AUM (within rounding).
- [ ] Redeem in a profit scenario deducts the 10% HWM perf fee; in a loss scenario it does not.
- [ ] `claimFees` transfers USDC to the creator wallet.
- [ ] Foundry coverage > 80%; first-deposit attack + stale-oracle tests pass.
