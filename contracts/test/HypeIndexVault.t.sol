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
}
