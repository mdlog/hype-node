// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {HypeIndexVault} from "../src/HypeIndexVault.sol";
import {MockUSDC} from "../src/mocks/MockUSDC.sol";

/// @notice Invariant: a vault's totalShares always equals the sum of its dead shares,
///         creator fee shares, and all subscriber position shares it has minted.
contract HypeIndexVaultInvariantsTest is Test {
    HypeIndexVault vault;
    MockUSDC usdc;
    uint256 signerPk = 0xA11CE;
    address signer = vm.addr(0xA11CE);
    address keeper = makeAddr("keeper");
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
            // pre-compute sig before prank so the view call does not consume it
            bytes memory sig = _sign(1e6);
            vm.prank(keeper);
            vault.settleDeposit(id, 1e6, 100e6, block.timestamp, sig);
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
