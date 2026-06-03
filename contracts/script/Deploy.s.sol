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
