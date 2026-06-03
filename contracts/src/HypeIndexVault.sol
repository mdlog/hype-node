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

    // --- NAV oracle ---
    /// @dev Validates signature, freshness. Shared by both deposit and redeem paths.
    function _verifyNavSig(bytes32 indexId, uint256 navPerShare, uint256 signedAt, bytes calldata sig)
        internal view
    {
        if (navPerShare == 0) revert ZeroNav();
        if (signedAt > block.timestamp) revert FuturePrice();
        if (block.timestamp > signedAt + MAX_STALENESS) revert StalePrice();
        bytes32 structHash = keccak256(abi.encode(PRICE_TYPEHASH, indexId, navPerShare, signedAt));
        bytes32 digest = _hashTypedDataV4(structHash);
        if (ECDSA.recover(digest, sig) != signer) revert BadSigner();
    }

    /// @dev Validates signature, freshness, AND deviation guard (used on deposit settlement).
    function _verifyNav(bytes32 indexId, uint256 navPerShare, uint256 signedAt, bytes calldata sig)
        internal view
    {
        _verifyNavSig(indexId, navPerShare, signedAt, sig);
        uint256 last = vaults[indexId].lastNav;
        if (last != 0) {
            uint256 hi = last * (10_000 + MAX_DEV_BPS) / 10_000;
            uint256 lo = last * (10_000 - MAX_DEV_BPS) / 10_000;
            if (navPerShare > hi || navPerShare < lo) revert NavDeviation();
        }
    }

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

    // --- management fee ---

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
        _verifyNavSig(r.indexId, navPerShare, signedAt, sig);

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

    // --- test-only exposers (remove before mainnet build) ---
    function verifyNavExposed(bytes32 indexId, uint256 navPerShare, uint256 signedAt, bytes calldata sig) external view {
        _verifyNav(indexId, navPerShare, signedAt, sig);
    }
    function hashTypedDataV4Exposed(bytes32 structHash) external view returns (bytes32) {
        return _hashTypedDataV4(structHash);
    }
}
