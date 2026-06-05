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
