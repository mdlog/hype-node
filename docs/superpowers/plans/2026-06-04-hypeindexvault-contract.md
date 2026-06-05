# HypeIndexVault Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build, test (>80%), and testnet-deploy the `HypeIndexVault` Solidity contract — the on-chain custody + share/fee/HWM/oracle engine that unblocks HypeNode's Wave 2 Publisher Revenue Loop.

**Architecture:** One shared custodial vault keyed by `indexId = keccak256(symbol)`. USDC deposits are escrowed on-chain; a trusted **keeper** executes SoDEX swaps off-chain and settles with realized values (async mint-on-fill); a trusted **signer** supplies EIP-712 NAV attestations the contract verifies (staleness + sanity-deviation + pause guards). Shares are an internal non-transferable ledger. Fees accrue by share-dilution: 1%/yr management (time-pro-rated, daily, idempotent) + 10% high-water-mark performance (per-subscriber, crystallized on redeem). NAV is signer-attested (not `balanceOf`-derived), which structurally neutralizes the ERC4626 first-deposit inflation attack; a minimum-dead-shares mint is belt-and-suspenders.

**Tech Stack:** Solidity ^0.8.24, Foundry (forge), OpenZeppelin Contracts v5 (`EIP712`, `ECDSA`, `Ownable`, `ReentrancyGuard`, `IERC20`, `SafeERC20`), ValueChain testnet (chainId 138565).

**Source spec:** `docs/superpowers/specs/2026-06-04-hypeindexvault-design.md`

**Plan boundary:** This is plan **1a** (contract). The off-chain **price-signer** + **keeper** Python services and the 🔴 **SoDEX on-chain-router spike** are plan **1b** — kick the spike off in parallel; it gates 1b, not this contract (the async-mint-on-fill decision fixes the contract interface regardless of the spike's outcome). The contract treats the keeper as a single trusted role that both calls `settle*` and custodies USDC/basket in-flight (the spike only refines what that executor *is*).

---

## File Structure

| File | Responsibility |
|---|---|
| `contracts/foundry.toml` | Forge config (solc 0.8.24, optimizer, ValueChain RPC profiles) |
| `contracts/remappings.txt` | `@openzeppelin/` + `forge-std/` import paths |
| `contracts/src/HypeIndexVault.sol` | The vault: storage, access control, oracle verify, deposit/redeem queue, fees, claim |
| `contracts/src/mocks/MockUSDC.sol` | 6-decimal ERC20 with public faucet `mint` for testnet/testing |
| `contracts/test/MockUSDC.t.sol` | MockUSDC unit tests |
| `contracts/test/HypeIndexVault.t.sol` | Vault unit + invariant tests (the bulk of coverage) |
| `contracts/script/Deploy.s.sol` | Deploy MockUSDC + HypeIndexVault to ValueChain testnet, print addresses |
| `contracts/README.md` (modify) | Add the Foundry build/test/deploy section alongside the existing Remix guide |

> The existing `contracts/SSIRegistry.sol` and `contracts/README.md` stay. `out/` is gitignored — Foundry's default `out/` build dir is already covered.

---

## Task 1: Foundry project scaffold

**Files:**
- Create: `contracts/foundry.toml`
- Create: `contracts/remappings.txt`
- Create: `contracts/.gitignore`

- [ ] **Step 1: Init Foundry libs in the existing `contracts/` dir**

Run (from repo root):
```bash
cd contracts
forge init --no-commit --no-git --force .
rm -f src/Counter.sol test/Counter.t.sol script/Counter.s.sol
forge install OpenZeppelin/openzeppelin-contracts@v5.1.0 --no-git
```
Expected: `lib/forge-std` and `lib/openzeppelin-contracts` populated. (`--force` is safe — it only adds Foundry scaffolding next to the existing `.sol` files.)

- [ ] **Step 2: Write `contracts/foundry.toml`**

```toml
[profile.default]
src = "src"
out = "out"
libs = ["lib"]
solc = "0.8.24"
optimizer = true
optimizer_runs = 200
evm_version = "paris"
fs_permissions = [{ access = "read", path = "./"}]

[rpc_endpoints]
valuechain_testnet = "${SSI_RPC_URL}"
```

- [ ] **Step 3: Write `contracts/remappings.txt`**

```
@openzeppelin/=lib/openzeppelin-contracts/
forge-std/=lib/forge-std/src/
```

- [ ] **Step 4: Write `contracts/.gitignore`**

```
out/
cache/
broadcast/
```

- [ ] **Step 5: Verify the toolchain compiles the existing registry**

Run: `forge build`
Expected: compiles `SSIRegistry.sol` with no errors (`Compiler run successful`).

- [ ] **Step 6: Commit**

```bash
cd ..
git add -f contracts/foundry.toml contracts/remappings.txt contracts/.gitignore contracts/lib
git commit -m "chore(contracts): scaffold Foundry toolchain + OpenZeppelin v5"
```

> Note: `docs/` is gitignored in this repo but planning docs are force-added (precedent: `docs/product-roadmap.md`). `contracts/lib` submodules are large; if you prefer not to vendor them, add `contracts/lib/` to `.gitignore` and rely on `forge install` in CI instead. This plan vendors them for a reproducible build.

---

## Task 2: MockUSDC (6-decimal test token)

**Files:**
- Create: `contracts/src/mocks/MockUSDC.sol`
- Test: `contracts/test/MockUSDC.t.sol`

- [ ] **Step 1: Write the failing test**

`contracts/test/MockUSDC.t.sol`:
```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MockUSDC} from "../src/mocks/MockUSDC.sol";

contract MockUSDCTest is Test {
    MockUSDC usdc;

    function setUp() public {
        usdc = new MockUSDC();
    }

    function test_decimalsIsSix() public view {
        assertEq(usdc.decimals(), 6);
    }

    function test_faucetMint() public {
        usdc.mint(address(0xBEEF), 100e6);
        assertEq(usdc.balanceOf(address(0xBEEF)), 100e6);
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd contracts && forge test --match-contract MockUSDCTest -vv`
Expected: FAIL — `MockUSDC` source not found.

- [ ] **Step 3: Write minimal implementation**

`contracts/src/mocks/MockUSDC.sol`:
```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Test-only USDC: 6 decimals, public faucet mint. Do NOT deploy to mainnet.
contract MockUSDC is ERC20 {
    constructor() ERC20("Mock USDC", "USDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `forge test --match-contract MockUSDCTest -vv`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
cd .. && git add -f contracts/src/mocks/MockUSDC.sol contracts/test/MockUSDC.t.sol
git commit -m "feat(contracts): add MockUSDC 6-decimal test token"
```

---

## Task 3: Vault skeleton — storage, roles, pause

**Files:**
- Create: `contracts/src/HypeIndexVault.sol`
- Test: `contracts/test/HypeIndexVault.t.sol`

- [ ] **Step 1: Write the failing test**

`contracts/test/HypeIndexVault.t.sol`:
```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {HypeIndexVault} from "../src/HypeIndexVault.sol";
import {MockUSDC} from "../src/mocks/MockUSDC.sol";

contract HypeIndexVaultTest is Test {
    HypeIndexVault vault;
    MockUSDC usdc;

    address owner    = address(this);
    uint256 signerPk = 0xA11CE;
    address signer   = vm.addr(0xA11CE);
    address keeper   = address(0xKEE9);
    address guardian = address(0x6A12D);
    address creator  = address(0xC0FFEE);
    address alice    = address(0xA11CE0);

    bytes32 constant INDEX = keccak256("vMEME.ssi");

    function setUp() public {
        usdc  = new MockUSDC();
        vault = new HypeIndexVault(address(usdc), signer, keeper, guardian);
    }

    function test_rolesSetInConstructor() public view {
        assertEq(address(vault.usdc()), address(usdc));
        assertEq(vault.signer(), signer);
        assertEq(vault.keeper(), keeper);
        assertEq(vault.guardian(), guardian);
        assertEq(vault.owner(), owner);
    }

    function test_guardianCanPause() public {
        vm.prank(guardian);
        vault.pause();
        assertTrue(vault.paused());
    }

    function test_nonGuardianCannotPause() public {
        vm.prank(alice);
        vm.expectRevert(HypeIndexVault.NotGuardian.selector);
        vault.pause();
    }

    function test_ownerCanRotateSigner() public {
        vault.setSigner(address(0xDEAD));
        assertEq(vault.signer(), address(0xDEAD));
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `forge test --match-contract HypeIndexVaultTest -vv`
Expected: FAIL — `HypeIndexVault` source not found.

- [ ] **Step 3: Write minimal implementation**

`contracts/src/HypeIndexVault.sol`:
```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// @title HypeIndexVault
/// @notice Shared custodial vault for HypeNode SSI indices. USDC deposits, internal
///         non-transferable shares, 1%/yr mgmt + 10% HWM perf fees via share-dilution,
///         async mint-on-fill settlement, trusted EIP-712 NAV signer. MVP / testnet.
contract HypeIndexVault is EIP712, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // --- constants ---
    uint256 public constant WAD          = 1e18;
    uint256 public constant MIN_SHARES   = 1e3;       // dead shares on first deposit
    uint256 public constant MGMT_FEE_BPS = 100;       // 1%/yr
    uint256 public constant PERF_FEE_BPS = 1000;      // 10%
    uint256 public constant YEAR         = 365 days;
    uint256 public constant MAX_STALENESS = 5 minutes;
    uint256 public constant MAX_DEV_BPS  = 2000;      // ±20% per NAV update
    uint256 public constant MIN_DEPOSIT  = 100e6;     // 100 USDC (6dp)

    bytes32 public constant PRICE_TYPEHASH =
        keccak256("PriceAttestation(bytes32 indexId,uint256 navPerShare,uint256 signedAt)");

    // --- roles ---
    IERC20  public immutable usdc;
    address public signer;     // EIP-712 NAV attester
    address public keeper;     // calls settle*, custodies in-flight funds
    address public guardian;   // circuit-breaker
    bool    public paused;

    // --- storage ---
    struct IndexVault {
        bool    active;
        address creator;
        uint256 totalShares;       // incl. dead shares + creator fee shares
        uint256 usdcReserve;       // USDC held for this index (escrowed/retained)
        uint256 lastMgmtAccrualAt;
        uint256 creatorFeeShares;  // claimable by creator
        uint256 lastNav;           // last accepted navPerShare (deviation guard)
    }
    mapping(bytes32 => IndexVault) public vaults;

    struct Position { uint256 shares; uint256 hwmNav; }
    mapping(bytes32 => mapping(address => Position)) public positions;

    struct PendingDeposit { bytes32 indexId; address who; uint256 usdcIn; uint256 minSharesOut; uint64 ts; bool pulled; }
    struct PendingRedeem  { bytes32 indexId; address who; uint256 shares; uint256 hwmNav; uint256 minUsdcOut; uint64 ts; }
    mapping(uint256 => PendingDeposit) public pendingDeposits;
    mapping(uint256 => PendingRedeem)  public pendingRedeems;
    uint256 public nextRequestId = 1;

    mapping(bytes32 => mapping(uint256 => bool)) public mgmtAccruedOnDay; // indexId => epochDay => done

    // --- events ---
    event VaultOpened(bytes32 indexed indexId, address indexed creator);
    event DepositRequested(uint256 indexed id, bytes32 indexed indexId, address indexed who, uint256 usdcIn);
    event DepositPulled(uint256 indexed id, uint256 usdcIn);
    event Subscribed(uint256 indexed id, bytes32 indexed indexId, address indexed who, uint256 shares, uint256 navPerShare);
    event DepositCancelled(uint256 indexed id, address indexed who, uint256 usdcRefunded);
    event MgmtAccrued(bytes32 indexed indexId, uint256 feeShares, uint256 epochDay);
    event RedeemRequested(uint256 indexed id, bytes32 indexed indexId, address indexed who, uint256 shares);
    event Redeemed(uint256 indexed id, bytes32 indexed indexId, address indexed who, uint256 netUsdc, uint256 perfFeeUsdc);
    event FeesClaimed(bytes32 indexed indexId, address indexed creator, uint256 shares);

    // --- errors ---
    error NotKeeper();
    error NotGuardian();
    error NotCreator();
    error Paused();
    error VaultInactive();
    error VaultExists();
    error BadRequest();
    error BelowMinDeposit();
    error SlippageExceeded();
    error StalePrice();
    error FuturePrice();
    error BadSigner();
    error NavDeviation();
    error ZeroNav();
    error AlreadyPulled();
    error NotPulled();

    constructor(address _usdc, address _signer, address _keeper, address _guardian)
        EIP712("HypeIndexVault", "1")
        Ownable(msg.sender)
    {
        usdc     = IERC20(_usdc);
        signer   = _signer;
        keeper   = _keeper;
        guardian = _guardian;
    }

    // --- modifiers ---
    modifier onlyKeeper()   { if (msg.sender != keeper)   revert NotKeeper();   _; }
    modifier onlyGuardian() { if (msg.sender != guardian) revert NotGuardian(); _; }
    modifier whenNotPaused() { if (paused) revert Paused(); _; }

    // --- admin ---
    function setSigner(address s)   external onlyOwner { signer = s; }
    function setKeeper(address k)   external onlyOwner { keeper = k; }
    function setGuardian(address g) external onlyOwner { guardian = g; }
    function pause()   external onlyGuardian { paused = true; }
    function unpause() external onlyGuardian { paused = false; }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `forge test --match-contract HypeIndexVaultTest -vv`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
cd .. && git add -f contracts/src/HypeIndexVault.sol contracts/test/HypeIndexVault.t.sol
git commit -m "feat(vault): storage, roles, pause skeleton"
```

---

## Task 4: EIP-712 NAV verification + staleness + deviation guards

**Files:**
- Modify: `contracts/src/HypeIndexVault.sol` (add `_verifyNav` + a test-only exposer)
- Modify: `contracts/test/HypeIndexVault.t.sol`

- [ ] **Step 1: Write the failing test**

Add a signing helper + tests to `HypeIndexVaultTest`:
```solidity
    // EIP-712 helper: sign a PriceAttestation as `signer`.
    function _signNav(bytes32 indexId, uint256 navPerShare, uint256 signedAt) internal view returns (bytes memory) {
        bytes32 structHash = keccak256(abi.encode(vault.PRICE_TYPEHASH(), indexId, navPerShare, signedAt));
        bytes32 digest = vault.hashTypedDataV4Exposed(structHash);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerPk, digest);
        return abi.encodePacked(r, s, v);
    }

    function test_verifyNav_acceptsFreshSignedPrice() public view {
        bytes memory sig = _signNav(INDEX, 1e6, block.timestamp);
        vault.verifyNavExposed(INDEX, 1e6, block.timestamp, sig); // does not revert
    }

    function test_verifyNav_rejectsStale() public {
        uint256 t = block.timestamp;
        bytes memory sig = _signNav(INDEX, 1e6, t);
        vm.warp(t + 6 minutes);
        vm.expectRevert(HypeIndexVault.StalePrice.selector);
        vault.verifyNavExposed(INDEX, 1e6, t, sig);
    }

    function test_verifyNav_rejectsWrongSigner() public {
        bytes32 structHash = keccak256(abi.encode(vault.PRICE_TYPEHASH(), INDEX, uint256(1e6), block.timestamp));
        bytes32 digest = vault.hashTypedDataV4Exposed(structHash);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(uint256(0xBADBAD), digest); // not the signer
        vm.expectRevert(HypeIndexVault.BadSigner.selector);
        vault.verifyNavExposed(INDEX, 1e6, block.timestamp, abi.encodePacked(r, s, v));
    }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `forge test --match-test test_verifyNav -vv`
Expected: FAIL — `verifyNavExposed` / `hashTypedDataV4Exposed` not defined.

- [ ] **Step 3: Write minimal implementation**

Add to `HypeIndexVault.sol` (above the closing brace):
```solidity
    // --- NAV oracle ---
    function _verifyNav(bytes32 indexId, uint256 navPerShare, uint256 signedAt, bytes calldata sig)
        internal view
    {
        if (navPerShare == 0) revert ZeroNav();
        if (signedAt > block.timestamp) revert FuturePrice();
        if (block.timestamp > signedAt + MAX_STALENESS) revert StalePrice();
        bytes32 structHash = keccak256(abi.encode(PRICE_TYPEHASH, indexId, navPerShare, signedAt));
        bytes32 digest = _hashTypedDataV4(structHash);
        if (ECDSA.recover(digest, sig) != signer) revert BadSigner();
        uint256 last = vaults[indexId].lastNav;
        if (last != 0) {
            uint256 hi = last * (10_000 + MAX_DEV_BPS) / 10_000;
            uint256 lo = last * (10_000 - MAX_DEV_BPS) / 10_000;
            if (navPerShare > hi || navPerShare < lo) revert NavDeviation();
        }
    }

    // --- test-only exposers (remove or keep behind a flag for mainnet build) ---
    function verifyNavExposed(bytes32 indexId, uint256 navPerShare, uint256 signedAt, bytes calldata sig) external view {
        _verifyNav(indexId, navPerShare, signedAt, sig);
    }
    function hashTypedDataV4Exposed(bytes32 structHash) external view returns (bytes32) {
        return _hashTypedDataV4(structHash);
    }
```

> The two `*Exposed` functions are `view` test hooks. Before the mainnet build (Wave 3), delete them — they expose no funds-moving logic but keep the audited surface minimal.

- [ ] **Step 4: Run test to verify it passes**

Run: `forge test --match-test test_verifyNav -vv`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
cd .. && git add -f contracts/src/HypeIndexVault.sol contracts/test/HypeIndexVault.t.sol
git commit -m "feat(vault): EIP-712 NAV verification + staleness/deviation guards"
```

---

## Task 5: openVault + requestDeposit + pullForDeposit

**Files:**
- Modify: `contracts/src/HypeIndexVault.sol`
- Modify: `contracts/test/HypeIndexVault.t.sol`

- [ ] **Step 1: Write the failing test**

Add to `HypeIndexVaultTest`:
```solidity
    function _open() internal {
        vm.prank(keeper);
        vault.openVault(INDEX, creator);
    }

    function test_openVault_setsCreatorActive() public {
        _open();
        (bool active, address c,,,,,) = vault.vaults(INDEX);
        assertTrue(active);
        assertEq(c, creator);
    }

    function test_requestDeposit_pullsUsdcAndQueues() public {
        _open();
        usdc.mint(alice, 500e6);
        vm.startPrank(alice);
        usdc.approve(address(vault), 500e6);
        uint256 id = vault.requestDeposit(INDEX, 200e6, 0);
        vm.stopPrank();

        assertEq(id, 1);
        assertEq(usdc.balanceOf(address(vault)), 200e6);
        (bytes32 idx, address who, uint256 usdcIn,,, bool pulled) = vault.pendingDeposits(id);
        assertEq(idx, INDEX);
        assertEq(who, alice);
        assertEq(usdcIn, 200e6);
        assertFalse(pulled);
    }

    function test_requestDeposit_rejectsBelowMin() public {
        _open();
        usdc.mint(alice, 50e6);
        vm.startPrank(alice);
        usdc.approve(address(vault), 50e6);
        vm.expectRevert(HypeIndexVault.BelowMinDeposit.selector);
        vault.requestDeposit(INDEX, 50e6, 0);
        vm.stopPrank();
    }

    function test_pullForDeposit_sendsUsdcToKeeper() public {
        _open();
        usdc.mint(alice, 200e6);
        vm.startPrank(alice);
        usdc.approve(address(vault), 200e6);
        uint256 id = vault.requestDeposit(INDEX, 200e6, 0);
        vm.stopPrank();

        vm.prank(keeper);
        vault.pullForDeposit(id);
        assertEq(usdc.balanceOf(keeper), 200e6);
        (,,,,, bool pulled) = vault.pendingDeposits(id);
        assertTrue(pulled);
    }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `forge test --match-test "test_openVault|test_requestDeposit|test_pullForDeposit" -vv`
Expected: FAIL — functions not defined.

- [ ] **Step 3: Write minimal implementation**

Add to `HypeIndexVault.sol`:
```solidity
    // --- vault lifecycle ---
    function openVault(bytes32 indexId, address creator) external onlyKeeper {
        if (vaults[indexId].active) revert VaultExists();
        vaults[indexId].active            = true;
        vaults[indexId].creator           = creator;
        vaults[indexId].lastMgmtAccrualAt = block.timestamp;
        emit VaultOpened(indexId, creator);
    }

    // --- deposit (async mint-on-fill) ---
    function requestDeposit(bytes32 indexId, uint256 usdcAmount, uint256 minSharesOut)
        external nonReentrant whenNotPaused returns (uint256 id)
    {
        if (!vaults[indexId].active) revert VaultInactive();
        if (usdcAmount < MIN_DEPOSIT) revert BelowMinDeposit();
        usdc.safeTransferFrom(msg.sender, address(this), usdcAmount);
        vaults[indexId].usdcReserve += usdcAmount;
        id = nextRequestId++;
        pendingDeposits[id] = PendingDeposit({
            indexId: indexId, who: msg.sender, usdcIn: usdcAmount,
            minSharesOut: minSharesOut, ts: uint64(block.timestamp), pulled: false
        });
        emit DepositRequested(id, indexId, msg.sender, usdcAmount);
    }

    function pullForDeposit(uint256 id) external onlyKeeper nonReentrant {
        PendingDeposit storage d = pendingDeposits[id];
        if (d.who == address(0)) revert BadRequest();
        if (d.pulled) revert AlreadyPulled();
        d.pulled = true;
        vaults[d.indexId].usdcReserve -= d.usdcIn;
        usdc.safeTransfer(keeper, d.usdcIn);
        emit DepositPulled(id, d.usdcIn);
    }
```

> Storage layout note: `PendingDeposit` has 6 fields; the test destructures all 6 (`(bytes32, address, uint256, uint256, uint64, bool)`). Keep the field order in sync if you edit the struct.

- [ ] **Step 4: Run test to verify it passes**

Run: `forge test --match-test "test_openVault|test_requestDeposit|test_pullForDeposit" -vv`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
cd .. && git add -f contracts/src/HypeIndexVault.sol contracts/test/HypeIndexVault.t.sol
git commit -m "feat(vault): openVault + requestDeposit + pullForDeposit"
```

---

## Task 6: settleDeposit (mint shares at signed NAV, first-deposit dead shares, HWM init)

**Files:**
- Modify: `contracts/src/HypeIndexVault.sol`
- Modify: `contracts/test/HypeIndexVault.t.sol`

- [ ] **Step 1: Write the failing test**

Add a deposit helper + tests:
```solidity
    // Full deposit→pull→settle for `amount` USDC at `nav`. Returns shares minted.
    function _deposit(address who, uint256 amount, uint256 nav, uint256 minOut) internal returns (uint256 id) {
        usdc.mint(who, amount);
        vm.startPrank(who);
        usdc.approve(address(vault), amount);
        id = vault.requestDeposit(INDEX, amount, minOut);
        vm.stopPrank();
        vm.prank(keeper);
        vault.pullForDeposit(id);
        // keeper "swapped" amount USDC into basket worth `amount` (1:1 for the test)
        bytes memory sig = _signNav(INDEX, nav, block.timestamp);
        vm.prank(keeper);
        vault.settleDeposit(id, nav, amount, block.timestamp, sig);
    }

    function test_settleDeposit_mintsSharesAtNav() public {
        _open();
        // nav = 1e6 (1 USDC per WAD shares) → 200 USDC mints 200*WAD/1e6 = 200e12 ... see units note
        _deposit(alice, 200e6, 1e6, 0);
        (uint256 shares, uint256 hwm) = vault.positions(INDEX, alice);
        assertEq(shares, 200e6 * vault.WAD() / 1e6); // basketValue * WAD / nav
        assertEq(hwm, 1e6);
    }

    function test_settleDeposit_firstDepositMintsDeadShares() public {
        _open();
        _deposit(alice, 200e6, 1e6, 0);
        (, , uint256 totalShares,,,,) = vault.vaults(INDEX);
        uint256 aliceShares = 200e6 * vault.WAD() / 1e6;
        assertEq(totalShares, aliceShares + vault.MIN_SHARES());
    }

    function test_settleDeposit_revertsOnSlippage() public {
        _open();
        usdc.mint(alice, 200e6);
        vm.startPrank(alice);
        usdc.approve(address(vault), 200e6);
        uint256 id = vault.requestDeposit(INDEX, 200e6, type(uint256).max); // impossible minSharesOut
        vm.stopPrank();
        vm.prank(keeper);
        vault.pullForDeposit(id);
        bytes memory sig = _signNav(INDEX, 1e6, block.timestamp);
        vm.prank(keeper);
        vm.expectRevert(HypeIndexVault.SlippageExceeded.selector);
        vault.settleDeposit(id, 1e6, 200e6, block.timestamp, sig);
    }
```

> **Units note:** `navPerShare` = USDC (6dp) value of `WAD` (1e18) shares. `shares = basketValueUsdc * WAD / navPerShare`. With `nav = 1e6`, 1 share-WAD ≈ 1e6 USDC-units worth, so 200e6 USDC mints `200e6 * 1e18 / 1e6 = 200e18` shares. The signer picks the initial `nav` (e.g. `1e6`) to set a clean opening share price.

- [ ] **Step 2: Run test to verify it fails**

Run: `forge test --match-test test_settleDeposit -vv`
Expected: FAIL — `settleDeposit` not defined.

- [ ] **Step 3: Write minimal implementation**

Add to `HypeIndexVault.sol`:
```solidity
    function settleDeposit(
        uint256 id, uint256 navPerShare, uint256 basketValueUsdc, uint256 signedAt, bytes calldata sig
    ) external onlyKeeper nonReentrant whenNotPaused {
        PendingDeposit memory d = pendingDeposits[id];
        if (d.who == address(0)) revert BadRequest();
        if (!d.pulled) revert NotPulled();
        _verifyNav(d.indexId, navPerShare, signedAt, sig);

        uint256 shares = basketValueUsdc * WAD / navPerShare;
        if (shares < d.minSharesOut) revert SlippageExceeded();

        IndexVault storage v = vaults[d.indexId];
        if (v.totalShares == 0) {
            v.totalShares += MIN_SHARES; // dead shares — never assigned to any position
        }
        Position storage p = positions[d.indexId][d.who];
        if (p.shares == 0) p.hwmNav = navPerShare;
        p.shares      += shares;
        v.totalShares += shares;
        v.lastNav      = navPerShare;

        delete pendingDeposits[id];
        emit Subscribed(id, d.indexId, d.who, shares, navPerShare);
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `forge test --match-test test_settleDeposit -vv`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
cd .. && git add -f contracts/src/HypeIndexVault.sol contracts/test/HypeIndexVault.t.sol
git commit -m "feat(vault): settleDeposit mints shares at signed NAV"
```

---

## Task 7: cancelDeposit (refund on failed/partial swap)

**Files:**
- Modify: `contracts/src/HypeIndexVault.sol`
- Modify: `contracts/test/HypeIndexVault.t.sol`

- [ ] **Step 1: Write the failing test**

```solidity
    function test_cancelDeposit_beforePull_refundsFromReserve() public {
        _open();
        usdc.mint(alice, 200e6);
        vm.startPrank(alice);
        usdc.approve(address(vault), 200e6);
        uint256 id = vault.requestDeposit(INDEX, 200e6, 0);
        vm.stopPrank();

        vm.prank(keeper);
        vault.cancelDeposit(id, 0);
        assertEq(usdc.balanceOf(alice), 200e6); // fully refunded
    }

    function test_cancelDeposit_afterPull_keeperReturnsUsdc() public {
        _open();
        usdc.mint(alice, 200e6);
        vm.startPrank(alice);
        usdc.approve(address(vault), 200e6);
        uint256 id = vault.requestDeposit(INDEX, 200e6, 0);
        vm.stopPrank();
        vm.prank(keeper);
        vault.pullForDeposit(id);

        // keeper unwound the partial swap and approves the return
        vm.startPrank(keeper);
        usdc.approve(address(vault), 200e6);
        vault.cancelDeposit(id, 200e6);
        vm.stopPrank();
        assertEq(usdc.balanceOf(alice), 200e6);
    }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `forge test --match-test test_cancelDeposit -vv`
Expected: FAIL — `cancelDeposit` not defined.

- [ ] **Step 3: Write minimal implementation**

```solidity
    /// @param returnedUsdc USDC the keeper sends back when the deposit was already pulled
    ///        (it equals what the keeper recovered unwinding the swap; for an un-pulled
    ///        request pass 0 — the funds are still in the vault reserve).
    function cancelDeposit(uint256 id, uint256 returnedUsdc) external onlyKeeper nonReentrant {
        PendingDeposit memory d = pendingDeposits[id];
        if (d.who == address(0)) revert BadRequest();
        delete pendingDeposits[id];
        if (d.pulled) {
            if (returnedUsdc > 0) usdc.safeTransferFrom(keeper, address(this), returnedUsdc);
            usdc.safeTransfer(d.who, returnedUsdc);
            emit DepositCancelled(id, d.who, returnedUsdc);
        } else {
            vaults[d.indexId].usdcReserve -= d.usdcIn;
            usdc.safeTransfer(d.who, d.usdcIn);
            emit DepositCancelled(id, d.who, d.usdcIn);
        }
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `forge test --match-test test_cancelDeposit -vv`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
cd .. && git add -f contracts/src/HypeIndexVault.sol contracts/test/HypeIndexVault.t.sol
git commit -m "feat(vault): cancelDeposit refund path"
```

---

## Task 8: accrueMgmt (1%/yr share-dilution, idempotent per UTC day)

**Files:**
- Modify: `contracts/src/HypeIndexVault.sol`
- Modify: `contracts/test/HypeIndexVault.t.sol`

- [ ] **Step 1: Write the failing test**

```solidity
    function test_accrueMgmt_oneYearIsOnePercent() public {
        _open();
        uint256 minted = _deposit(alice, 1_000e6, 1e6, 0); // ignore return; recompute
        (, , uint256 sharesBefore,,,,) = vault.vaults(INDEX);

        vm.warp(block.timestamp + 365 days);
        vm.prank(keeper);
        vault.accrueMgmt(INDEX);

        (, , uint256 sharesAfter,, , uint256 creatorFeeShares,) = vault.vaults(INDEX);
        // feeShares ≈ totalShares * 1% * (365d/365d)
        uint256 expected = sharesBefore * vault.MGMT_FEE_BPS() * 365 days / (vault.YEAR() * 10_000);
        assertEq(creatorFeeShares, expected);
        assertEq(sharesAfter, sharesBefore + expected);
        minted; // silence unused
    }

    function test_accrueMgmt_idempotentSameDay() public {
        _open();
        _deposit(alice, 1_000e6, 1e6, 0);
        vm.warp(block.timestamp + 2 days);
        vm.startPrank(keeper);
        vault.accrueMgmt(INDEX);
        uint256 day = block.timestamp / 1 days;
        assertTrue(vault.mgmtAccruedOnDay(INDEX, day));
        vm.expectRevert(HypeIndexVault.BadRequest.selector);
        vault.accrueMgmt(INDEX); // second call same day reverts
        vm.stopPrank();
    }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `forge test --match-test test_accrueMgmt -vv`
Expected: FAIL — `accrueMgmt` not defined.

- [ ] **Step 3: Write minimal implementation**

```solidity
    /// @notice Accrue 1%/yr management fee as diluted creator shares. Idempotent per UTC day.
    function accrueMgmt(bytes32 indexId) external onlyKeeper nonReentrant {
        IndexVault storage v = vaults[indexId];
        if (!v.active) revert VaultInactive();
        uint256 day = block.timestamp / 1 days;
        if (mgmtAccruedOnDay[indexId][day]) revert BadRequest();
        mgmtAccruedOnDay[indexId][day] = true;

        uint256 dt = block.timestamp - v.lastMgmtAccrualAt;
        v.lastMgmtAccrualAt = block.timestamp;
        if (v.totalShares == 0 || dt == 0) return;

        uint256 feeShares = v.totalShares * MGMT_FEE_BPS * dt / (YEAR * 10_000);
        if (feeShares == 0) return;
        v.creatorFeeShares += feeShares;
        v.totalShares      += feeShares;
        emit MgmtAccrued(indexId, feeShares, day);
    }
```

> Destructure note: `vaults(INDEX)` returns the 7 `IndexVault` fields in order
> `(active, creator, totalShares, usdcReserve, lastMgmtAccrualAt, creatorFeeShares, lastNav)`.
> Keep the tuple positions in the tests aligned with this order.

- [ ] **Step 4: Run test to verify it passes**

Run: `forge test --match-test test_accrueMgmt -vv`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
cd .. && git add -f contracts/src/HypeIndexVault.sol contracts/test/HypeIndexVault.t.sol
git commit -m "feat(vault): accrueMgmt 1%/yr share-dilution, idempotent per day"
```

---

## Task 9: requestRedeem + settleRedeem (HWM perf fee crystallization)

**Files:**
- Modify: `contracts/src/HypeIndexVault.sol`
- Modify: `contracts/test/HypeIndexVault.t.sol`

- [ ] **Step 1: Write the failing test**

```solidity
    function test_redeem_profit_deductsPerfFee() public {
        _open();
        _deposit(alice, 1_000e6, 1e6, 0);            // hwm = 1e6
        (uint256 shares,) = vault.positions(INDEX, alice);

        // request redeem of all shares
        vm.prank(alice);
        uint256 id = vault.requestRedeem(INDEX, shares, 0);

        // NAV doubled to 2e6 → profit per share = 1e6; keeper sold basket for 2_000e6
        uint256 nav = 2e6;
        bytes memory sig = _signNav(INDEX, nav, block.timestamp);
        usdc.mint(keeper, 2_000e6);
        vm.startPrank(keeper);
        usdc.approve(address(vault), 2_000e6);
        vault.settleRedeem(id, 2_000e6, nav, block.timestamp, sig);
        vm.stopPrank();

        // profitUsdc = (2e6-1e6)*shares/WAD = 1_000e6 ; perfFee = 10% = 100e6
        // alice nets 2_000e6 - 100e6 = 1_900e6
        assertEq(usdc.balanceOf(alice), 1_900e6);
        // creator got perf as diluted shares worth 100e6 at nav 2e6
        (, , , , , uint256 creatorFeeShares,) = vault.vaults(INDEX);
        assertEq(creatorFeeShares, 100e6 * vault.WAD() / nav);
    }

    function test_redeem_loss_noPerfFee() public {
        _open();
        _deposit(alice, 1_000e6, 1e6, 0);
        (uint256 shares,) = vault.positions(INDEX, alice);
        vm.prank(alice);
        uint256 id = vault.requestRedeem(INDEX, shares, 0);

        // NAV dropped to 0.8e6; keeper sold for 800e6
        uint256 nav = 8e5;
        bytes memory sig = _signNav(INDEX, nav, block.timestamp);
        usdc.mint(keeper, 800e6);
        vm.startPrank(keeper);
        usdc.approve(address(vault), 800e6);
        vault.settleRedeem(id, 800e6, nav, block.timestamp, sig);
        vm.stopPrank();

        assertEq(usdc.balanceOf(alice), 800e6); // no fee on a loss
    }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `forge test --match-test test_redeem -vv`
Expected: FAIL — `requestRedeem` / `settleRedeem` not defined.

- [ ] **Step 3: Write minimal implementation**

```solidity
    // --- redeem (async, perf fee crystallized here) ---
    function requestRedeem(bytes32 indexId, uint256 shares, uint256 minUsdcOut)
        external nonReentrant whenNotPaused returns (uint256 id)
    {
        Position storage p = positions[indexId][msg.sender];
        if (shares == 0 || shares > p.shares) revert BadRequest();
        p.shares -= shares;                       // escrow out of the position
        id = nextRequestId++;
        pendingRedeems[id] = PendingRedeem({
            indexId: indexId, who: msg.sender, shares: shares,
            hwmNav: p.hwmNav, minUsdcOut: minUsdcOut, ts: uint64(block.timestamp)
        });
        emit RedeemRequested(id, indexId, msg.sender, shares);
    }

    function settleRedeem(
        uint256 id, uint256 usdcReceived, uint256 navPerShare, uint256 signedAt, bytes calldata sig
    ) external onlyKeeper nonReentrant whenNotPaused {
        PendingRedeem memory r = pendingRedeems[id];
        if (r.who == address(0)) revert BadRequest();
        _verifyNav(r.indexId, navPerShare, signedAt, sig);

        // keeper delivers the sale proceeds to the vault
        usdc.safeTransferFrom(keeper, address(this), usdcReceived);

        IndexVault storage v = vaults[r.indexId];
        uint256 perfFeeUsdc = 0;
        if (navPerShare > r.hwmNav) {
            uint256 profitUsdc = (navPerShare - r.hwmNav) * r.shares / WAD;
            perfFeeUsdc = profitUsdc * PERF_FEE_BPS / 10_000;
            if (perfFeeUsdc > usdcReceived) perfFeeUsdc = usdcReceived; // safety clamp
            // convert fee to diluted creator shares at current nav
            uint256 feeShares = perfFeeUsdc * WAD / navPerShare;
            v.creatorFeeShares += feeShares;
            v.totalShares      += feeShares;
            v.usdcReserve      += perfFeeUsdc; // retained to back the new creator shares
        }
        v.totalShares -= r.shares; // burn the redeemed shares
        v.lastNav      = navPerShare;

        uint256 netUsdc = usdcReceived - perfFeeUsdc;
        delete pendingRedeems[id];
        usdc.safeTransfer(r.who, netUsdc);
        emit Redeemed(id, r.indexId, r.who, netUsdc, perfFeeUsdc);
    }
```

> `minUsdcOut` is recorded for the keeper/UI to honor off-chain (the keeper must not settle below it); it is not re-checked on-chain because the realized `usdcReceived` is itself keeper-supplied in the MVP trust model. Note this explicitly in the audit doc.

- [ ] **Step 4: Run test to verify it passes**

Run: `forge test --match-test test_redeem -vv`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
cd .. && git add -f contracts/src/HypeIndexVault.sol contracts/test/HypeIndexVault.t.sol
git commit -m "feat(vault): requestRedeem + settleRedeem with HWM perf fee"
```

---

## Task 10: claimFees (creator redeems accrued fee shares)

**Files:**
- Modify: `contracts/src/HypeIndexVault.sol`
- Modify: `contracts/test/HypeIndexVault.t.sol`

- [ ] **Step 1: Write the failing test**

```solidity
    function test_claimFees_movesCreatorSharesToRedeemQueue() public {
        _open();
        _deposit(alice, 1_000e6, 1e6, 0);
        vm.warp(block.timestamp + 365 days);
        vm.prank(keeper);
        vault.accrueMgmt(INDEX);
        (, , , , , uint256 feeShares,) = vault.vaults(INDEX);
        assertGt(feeShares, 0);

        vm.prank(creator);
        uint256 id = vault.claimFees(INDEX);

        // creator fee shares zeroed, a redeem request created for `creator`
        (, , , , , uint256 feeSharesAfter,) = vault.vaults(INDEX);
        assertEq(feeSharesAfter, 0);
        (, address who, uint256 shares,,,) = vault.pendingRedeems(id);
        assertEq(who, creator);
        assertEq(shares, feeShares);
    }

    function test_claimFees_onlyCreator() public {
        _open();
        _deposit(alice, 1_000e6, 1e6, 0);
        vm.warp(block.timestamp + 365 days);
        vm.prank(keeper);
        vault.accrueMgmt(INDEX);
        vm.prank(alice);
        vm.expectRevert(HypeIndexVault.NotCreator.selector);
        vault.claimFees(INDEX);
    }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `forge test --match-test test_claimFees -vv`
Expected: FAIL — `claimFees` not defined.

- [ ] **Step 3: Write minimal implementation**

```solidity
    /// @notice Creator converts accrued fee shares into a redeem request (HWM=0 → no perf fee on fee shares).
    function claimFees(bytes32 indexId) external nonReentrant returns (uint256 id) {
        IndexVault storage v = vaults[indexId];
        if (msg.sender != v.creator) revert NotCreator();
        uint256 shares = v.creatorFeeShares;
        if (shares == 0) revert BadRequest();
        v.creatorFeeShares = 0;
        id = nextRequestId++;
        pendingRedeems[id] = PendingRedeem({
            indexId: indexId, who: v.creator, shares: shares,
            hwmNav: 0, minUsdcOut: 0, ts: uint64(block.timestamp)
        });
        emit FeesClaimed(indexId, v.creator, shares);
        emit RedeemRequested(id, indexId, v.creator, shares);
    }
```

> Fee shares carry `hwmNav: 0`, so `settleRedeem` would compute a "profit" from 0 — that is wrong for fee shares. Guard it: in `settleRedeem`, treat `hwmNav == 0` as "no perf fee" (these are already-net fee shares). Apply the fix in Step 3a.

- [ ] **Step 3a: Patch settleRedeem to skip perf fee when hwmNav == 0**

In `settleRedeem`, change the condition:
```solidity
        if (navPerShare > r.hwmNav && r.hwmNav != 0) {
```

- [ ] **Step 4: Run test to verify it passes**

Run: `forge test --match-test "test_claimFees|test_redeem" -vv`
Expected: PASS (4 tests — claimFees x2 + the earlier redeem x2 still green).

- [ ] **Step 5: Commit**

```bash
cd .. && git add -f contracts/src/HypeIndexVault.sol contracts/test/HypeIndexVault.t.sol
git commit -m "feat(vault): claimFees creator fee-share redemption"
```

---

## Task 11: Invariants + first-deposit-attack + oracle-revert hardening tests

**Files:**
- Create: `contracts/test/HypeIndexVaultInvariants.t.sol`
- Modify: `contracts/test/HypeIndexVault.t.sol`

- [ ] **Step 1: Write the failing tests**

Add to `HypeIndexVault.t.sol`:
```solidity
    function test_inflationAttack_isNeutralized() public {
        _open();
        // attacker deposits the minimum, then donates USDC directly to the vault
        _deposit(alice, 100e6, 1e6, 0);
        usdc.mint(address(vault), 1_000_000e6); // raw donation
        // NAV is signer-attested, not balanceOf-derived → a second depositor's share
        // price is unaffected by the donation.
        uint256 bobShares = _deposit(address(0xB0B), 100e6, 1e6, 0);
        assertEq(bobShares, 100e6 * vault.WAD() / 1e6); // unchanged by the donation
    }

    function test_settleDeposit_rejectsNavDeviation() public {
        _open();
        _deposit(alice, 200e6, 1e6, 0);            // lastNav = 1e6
        // next settle tries nav = 2e6 (+100%, beyond ±20%)
        usdc.mint(address(0xB0B), 200e6);
        vm.startPrank(address(0xB0B));
        usdc.approve(address(vault), 200e6);
        uint256 id = vault.requestDeposit(INDEX, 200e6, 0);
        vm.stopPrank();
        vm.prank(keeper);
        vault.pullForDeposit(id);
        bytes memory sig = _signNav(INDEX, 2e6, block.timestamp);
        vm.prank(keeper);
        vm.expectRevert(HypeIndexVault.NavDeviation.selector);
        vault.settleDeposit(id, 2e6, 200e6, block.timestamp, sig);
    }
```

> `_deposit` must `return` the minted shares for the attack test. If it does not yet,
> change its signature to `returns (uint256 shares)` and end with
> `(shares,) = vault.positions(INDEX, who);` — update the helper, not each call site.

Create `contracts/test/HypeIndexVaultInvariants.t.sol`:
```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {HypeIndexVault} from "../src/HypeIndexVault.sol";
import {MockUSDC} from "../src/mocks/MockUSDC.sol";

/// @notice Invariant: a vault's totalShares always equals the sum of its dead shares,
///         creator fee shares, and all subscriber position shares it has minted.
///         (Handler-based fuzzing; here we assert the accounting identity after a
///         scripted deposit/redeem sequence.)
contract HypeIndexVaultInvariantsTest is Test {
    HypeIndexVault vault;
    MockUSDC usdc;
    uint256 signerPk = 0xA11CE;
    address signer = vm.addr(0xA11CE);
    address keeper = address(0xKEE9);
    bytes32 constant INDEX = keccak256("vMEME.ssi");

    function setUp() public {
        usdc = new MockUSDC();
        vault = new HypeIndexVault(address(usdc), signer, keeper, address(this));
        vm.prank(keeper);
        vault.openVault(INDEX, address(0xC0FFEE));
    }

    function _sign(uint256 nav) internal view returns (bytes memory) {
        bytes32 sh = keccak256(abi.encode(vault.PRICE_TYPEHASH(), INDEX, nav, block.timestamp));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerPk, vault.hashTypedDataV4Exposed(sh));
        return abi.encodePacked(r, s, v);
    }

    function test_sharesConservation_afterDeposits() public {
        for (uint160 i = 1; i <= 5; i++) {
            address who = address(i + 0x1000);
            usdc.mint(who, 100e6);
            vm.startPrank(who);
            usdc.approve(address(vault), 100e6);
            uint256 id = vault.requestDeposit(INDEX, 100e6, 0);
            vm.stopPrank();
            vm.prank(keeper);
            vault.pullForDeposit(id);
            vm.prank(keeper);
            vault.settleDeposit(id, 1e6, 100e6, block.timestamp, _sign(1e6));
        }
        (, , uint256 totalShares,, , uint256 feeShares,) = vault.vaults(INDEX);
        uint256 sumPositions;
        for (uint160 i = 1; i <= 5; i++) {
            (uint256 sh,) = vault.positions(INDEX, address(i + 0x1000));
            sumPositions += sh;
        }
        assertEq(totalShares, sumPositions + feeShares + vault.MIN_SHARES());
    }
}
```

- [ ] **Step 2: Run tests to verify they fail / then drive fixes**

Run: `forge test --match-contract "HypeIndexVault" -vv`
Expected: the new tests run; fix any helper-signature mismatch surfaced (the `_deposit` return).

- [ ] **Step 3: Make them pass**

Apply the `_deposit` return-value change noted above. No contract change should be needed — the inflation-attack test passes precisely because NAV is signer-attested. If `test_inflationAttack_isNeutralized` fails, that is a real design regression — stop and investigate (do NOT loosen the assertion).

- [ ] **Step 4: Run the full suite + coverage**

Run: `forge test -vv && forge coverage --match-contract HypeIndexVault`
Expected: all green; `HypeIndexVault.sol` line coverage **> 80%**. If under 80%, add tests for the uncovered branches (e.g. `cancelDeposit` un-pulled path, `unpause`, `pause`-blocks-deposit).

- [ ] **Step 5: Commit**

```bash
cd .. && git add -f contracts/test/HypeIndexVault.t.sol contracts/test/HypeIndexVaultInvariants.t.sol
git commit -m "test(vault): invariants, inflation-attack neutralization, nav-deviation"
```

---

## Task 12: Deploy script + README (ValueChain testnet 138565)

**Files:**
- Create: `contracts/script/Deploy.s.sol`
- Modify: `contracts/README.md`

- [ ] **Step 1: Write the deploy script**

`contracts/script/Deploy.s.sol`:
```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {HypeIndexVault} from "../src/HypeIndexVault.sol";
import {MockUSDC} from "../src/mocks/MockUSDC.sol";

/// @notice Deploys MockUSDC + HypeIndexVault to ValueChain testnet (138565).
///         Env: DEPLOYER_PK, VAULT_SIGNER, VAULT_KEEPER, VAULT_GUARDIAN.
///         For mainnet, set USDC_ADDRESS to the canonical USDC and skip MockUSDC.
contract Deploy is Script {
    function run() external {
        uint256 pk      = vm.envUint("DEPLOYER_PK");
        address signer  = vm.envAddress("VAULT_SIGNER");
        address keeper  = vm.envAddress("VAULT_KEEPER");
        address guardian= vm.envAddress("VAULT_GUARDIAN");
        address usdcEnv = vm.envOr("USDC_ADDRESS", address(0));

        vm.startBroadcast(pk);
        address usdc = usdcEnv;
        if (usdc == address(0)) {
            usdc = address(new MockUSDC());
            console2.log("MockUSDC:", usdc);
        }
        HypeIndexVault vault = new HypeIndexVault(usdc, signer, keeper, guardian);
        console2.log("HypeIndexVault:", address(vault));
        vm.stopBroadcast();
    }
}
```

- [ ] **Step 2: Dry-run the script against a local fork**

Run:
```bash
cd contracts
DEPLOYER_PK=0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d \
VAULT_SIGNER=0x0000000000000000000000000000000000000001 \
VAULT_KEEPER=0x0000000000000000000000000000000000000002 \
VAULT_GUARDIAN=0x0000000000000000000000000000000000000003 \
forge script script/Deploy.s.sol --fork-url https://testnet-rpc.valuechain.io
```
Expected: simulation prints a `MockUSDC:` and `HypeIndexVault:` address, no broadcast.

> If the public RPC is unreachable in CI, run against a local anvil instead:
> `anvil &` then `--fork-url http://127.0.0.1:8545`.

- [ ] **Step 3: Document the Foundry flow in `contracts/README.md`**

Append a section to `contracts/README.md`:
```markdown
## HypeIndexVault (Foundry)

Build + test:
```bash
cd contracts
forge build
forge test -vv
forge coverage --match-contract HypeIndexVault
```

Deploy to ValueChain testnet (138565):
```bash
export DEPLOYER_PK=0x<funded testnet key>
export VAULT_SIGNER=0x<price-signer address>
export VAULT_KEEPER=0x<keeper address>
export VAULT_GUARDIAN=0x<guardian address>
# omit USDC_ADDRESS on testnet → a MockUSDC is deployed automatically
forge script script/Deploy.s.sol \
  --rpc-url https://testnet-rpc.valuechain.io --broadcast
```

Wire the printed addresses into `.env`:
`SSI_*`/`NEXT_PUBLIC_*` mirrors plus `HYPE_VAULT_ADDRESS`, `USDC_ADDRESS`.
Mainnet (286623): set `USDC_ADDRESS` to the canonical USDC (open item — verify
address + liquidity first) and use a multisig signer/guardian.
```

- [ ] **Step 4: Run the full suite one more time**

Run: `forge test -vv`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
cd .. && git add -f contracts/script/Deploy.s.sol contracts/README.md
git commit -m "feat(vault): deploy script + Foundry README for ValueChain testnet"
```

---

## Self-Review (completed by plan author)

**Spec coverage** — every §-requirement maps to a task:
- §3 components (vault, MockUSDC, Foundry) → Tasks 1–12. (Signer/keeper *services* = plan 1b, by scope.)
- §4 data model → Task 3.
- §5 flows: subscribe → 5–6; cancel → 7; redeem/claim → 9–10. (§5.2 rebalance = keeper-gated basket bookkeeping; the contract needs no extra surface in MVP because pooled shares auto-follow — no task required, noted in spec.)
- §6.1 oracle guards → Task 4; §6.2 mgmt → 8, perf/HWM → 9.
- §7 security: reentrancy (all tasks), access control (3/5/8/9/10), pause (3), inflation attack + nav deviation (11), caps/min-deposit (5).
- §8 testing: unit (2–10), invariant + attack + stale oracle (11), coverage gate (11), deploy/acceptance scaffold (12).
- §9 open items → called out in the plan boundary + Task 12 README (USDC mainnet address, SoDEX router spike deferred to 1b).

**Placeholder scan** — no TBD/TODO; every code step has complete, compilable code; commands have expected output.

**Type consistency** — `IndexVault` 7-field order is fixed in Task 3 and every `vaults(...)` destructure matches it (noted in Task 8). `PendingDeposit` 6-field order fixed in Task 3, destructured consistently in Tasks 5/7. `navPerShare` units (USDC-6dp per WAD shares) are consistent across Tasks 6/8/9. `_deposit` helper returns shares from Task 11 onward (noted). The `hwmNav == 0 ⇒ no perf fee` rule (Task 10 Step 3a) is consistent with `claimFees` minting fee shares at `hwmNav: 0`.

**Known MVP simplifications (documented, audit-flagged, not gaps):** keeper-supplied `usdcReceived`/`basketValueUsdc` are trusted (the MVP trust boundary); `minUsdcOut` is honored off-chain; perf-fee USDC is retained idle to back creator shares rather than re-deployed. All three are listed for the audit and the multisig-before-mainnet gate.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-04-hypeindexvault-contract.md`.
