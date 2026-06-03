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
}
