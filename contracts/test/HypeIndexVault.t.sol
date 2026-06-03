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
    address keeper   = makeAddr("keeper");
    address guardian = makeAddr("guardian");
    address creator  = makeAddr("creator");
    address alice    = makeAddr("alice");

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
        uint256 t = 1_000_000;
        vm.warp(t);
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

    // Full deposit→pull→settle for `amount` USDC at `nav`. Returns the requestId.
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

    function test_accrueMgmt_oneYearIsOnePercent() public {
        _open();
        _deposit(alice, 1_000e6, 1e6, 0);
        (, , uint256 sharesBefore,,,,) = vault.vaults(INDEX);

        vm.warp(block.timestamp + 365 days);
        vm.prank(keeper);
        vault.accrueMgmt(INDEX);

        (, , uint256 sharesAfter,, , uint256 creatorFeeShares,) = vault.vaults(INDEX);
        // feeShares ≈ totalShares * 1% * (365d/365d)
        uint256 expected = sharesBefore * vault.MGMT_FEE_BPS() * 365 days / (vault.YEAR() * 10_000);
        assertEq(creatorFeeShares, expected);
        assertEq(sharesAfter, sharesBefore + expected);
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

    function test_redeem_revertsOnMinUsdcOut() public {
        _open();
        _deposit(alice, 1_000e6, 1e6, 0);
        (uint256 shares,) = vault.positions(INDEX, alice);
        vm.prank(alice);
        uint256 id = vault.requestRedeem(INDEX, shares, 5_000e6); // demands >= 5000 USDC out

        uint256 nav = 1e6;
        bytes memory sig = _signNav(INDEX, nav, block.timestamp);
        usdc.mint(keeper, 800e6);
        vm.startPrank(keeper);
        usdc.approve(address(vault), 800e6);
        vm.expectRevert(HypeIndexVault.SlippageExceeded.selector);
        vault.settleRedeem(id, 800e6, nav, block.timestamp, sig); // only 800 < 5000 -> revert
        vm.stopPrank();
    }

    function test_redeem_doesNotPoisonDepositGuard() public {
        _open();
        _deposit(alice, 1_000e6, 1e6, 0);                  // lastNav = 1e6
        (uint256 shares,) = vault.positions(INDEX, alice);

        // redeem HALF at an extreme nav (no deviation guard on redeem)
        vm.prank(alice);
        uint256 id = vault.requestRedeem(INDEX, shares / 2, 0);
        uint256 wildNav = 10e6;                            // 10x — would trip deposit guard if it set lastNav
        bytes memory sig = _signNav(INDEX, wildNav, block.timestamp);
        usdc.mint(keeper, 5_000e6);
        vm.startPrank(keeper);
        usdc.approve(address(vault), 5_000e6);
        vault.settleRedeem(id, 5_000e6, wildNav, block.timestamp, sig);
        vm.stopPrank();

        // lastNav must still be the deposit price (1e6), NOT poisoned to 10e6
        (, , , , , , uint256 lastNav) = vault.vaults(INDEX);
        assertEq(lastNav, 1e6);

        // and a legit follow-up deposit at the true price 1e6 must still succeed (guard not poisoned)
        _deposit(makeAddr("bob"), 200e6, 1e6, 0);
        (uint256 bobShares,) = vault.positions(INDEX, makeAddr("bob"));
        assertEq(bobShares, 200e6 * vault.WAD() / 1e6);
    }
}
