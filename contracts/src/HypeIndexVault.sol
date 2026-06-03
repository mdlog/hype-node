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
