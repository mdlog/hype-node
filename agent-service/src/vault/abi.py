"""ABI fragments for the HypeIndexVault keeper.

VAULT_ABI entries are copied verbatim from the Foundry artifact at
contracts/out/HypeIndexVault.sol/HypeIndexVault.json so types/order match
the deployed bytecode exactly.

ERC20_ABI contains hand-written standard fragments (including MockUSDC.mint).
"""

VAULT_ABI = [
    {
        "type": "function",
        "name": "accrueMgmt",
        "inputs": [
            {
                "name": "indexId",
                "type": "bytes32",
                "internalType": "bytes32"
            }
        ],
        "outputs": [],
        "stateMutability": "nonpayable"
    },
    {
        "type": "function",
        "name": "cancelDeposit",
        "inputs": [
            {
                "name": "id",
                "type": "uint256",
                "internalType": "uint256"
            },
            {
                "name": "returnedUsdc",
                "type": "uint256",
                "internalType": "uint256"
            }
        ],
        "outputs": [],
        "stateMutability": "nonpayable"
    },
    {
        "type": "function",
        "name": "claimFees",
        "inputs": [
            {
                "name": "indexId",
                "type": "bytes32",
                "internalType": "bytes32"
            }
        ],
        "outputs": [
            {
                "name": "id",
                "type": "uint256",
                "internalType": "uint256"
            }
        ],
        "stateMutability": "nonpayable"
    },
    {
        "type": "function",
        "name": "nextRequestId",
        "inputs": [],
        "outputs": [
            {
                "name": "",
                "type": "uint256",
                "internalType": "uint256"
            }
        ],
        "stateMutability": "view"
    },
    {
        "type": "function",
        "name": "openVault",
        "inputs": [
            {
                "name": "indexId",
                "type": "bytes32",
                "internalType": "bytes32"
            },
            {
                "name": "creator",
                "type": "address",
                "internalType": "address"
            }
        ],
        "outputs": [],
        "stateMutability": "nonpayable"
    },
    {
        "type": "function",
        "name": "pendingDeposits",
        "inputs": [
            {
                "name": "",
                "type": "uint256",
                "internalType": "uint256"
            }
        ],
        "outputs": [
            {
                "name": "indexId",
                "type": "bytes32",
                "internalType": "bytes32"
            },
            {
                "name": "who",
                "type": "address",
                "internalType": "address"
            },
            {
                "name": "usdcIn",
                "type": "uint256",
                "internalType": "uint256"
            },
            {
                "name": "minSharesOut",
                "type": "uint256",
                "internalType": "uint256"
            },
            {
                "name": "ts",
                "type": "uint64",
                "internalType": "uint64"
            },
            {
                "name": "pulled",
                "type": "bool",
                "internalType": "bool"
            }
        ],
        "stateMutability": "view"
    },
    {
        "type": "function",
        "name": "pendingRedeems",
        "inputs": [
            {
                "name": "",
                "type": "uint256",
                "internalType": "uint256"
            }
        ],
        "outputs": [
            {
                "name": "indexId",
                "type": "bytes32",
                "internalType": "bytes32"
            },
            {
                "name": "who",
                "type": "address",
                "internalType": "address"
            },
            {
                "name": "shares",
                "type": "uint256",
                "internalType": "uint256"
            },
            {
                "name": "hwmNav",
                "type": "uint256",
                "internalType": "uint256"
            },
            {
                "name": "minUsdcOut",
                "type": "uint256",
                "internalType": "uint256"
            },
            {
                "name": "ts",
                "type": "uint64",
                "internalType": "uint64"
            }
        ],
        "stateMutability": "view"
    },
    {
        "type": "function",
        "name": "positions",
        "inputs": [
            {
                "name": "",
                "type": "bytes32",
                "internalType": "bytes32"
            },
            {
                "name": "",
                "type": "address",
                "internalType": "address"
            }
        ],
        "outputs": [
            {
                "name": "shares",
                "type": "uint256",
                "internalType": "uint256"
            },
            {
                "name": "hwmNav",
                "type": "uint256",
                "internalType": "uint256"
            }
        ],
        "stateMutability": "view"
    },
    {
        "type": "function",
        "name": "pullForDeposit",
        "inputs": [
            {
                "name": "id",
                "type": "uint256",
                "internalType": "uint256"
            }
        ],
        "outputs": [],
        "stateMutability": "nonpayable"
    },
    {
        "type": "function",
        "name": "settleDeposit",
        "inputs": [
            {
                "name": "id",
                "type": "uint256",
                "internalType": "uint256"
            },
            {
                "name": "navPerShare",
                "type": "uint256",
                "internalType": "uint256"
            },
            {
                "name": "basketValueUsdc",
                "type": "uint256",
                "internalType": "uint256"
            },
            {
                "name": "signedAt",
                "type": "uint256",
                "internalType": "uint256"
            },
            {
                "name": "sig",
                "type": "bytes",
                "internalType": "bytes"
            }
        ],
        "outputs": [],
        "stateMutability": "nonpayable"
    },
    {
        "type": "function",
        "name": "settleRedeem",
        "inputs": [
            {
                "name": "id",
                "type": "uint256",
                "internalType": "uint256"
            },
            {
                "name": "usdcReceived",
                "type": "uint256",
                "internalType": "uint256"
            },
            {
                "name": "navPerShare",
                "type": "uint256",
                "internalType": "uint256"
            },
            {
                "name": "signedAt",
                "type": "uint256",
                "internalType": "uint256"
            },
            {
                "name": "sig",
                "type": "bytes",
                "internalType": "bytes"
            }
        ],
        "outputs": [],
        "stateMutability": "nonpayable"
    },
    {
        "type": "function",
        "name": "vaults",
        "inputs": [
            {
                "name": "",
                "type": "bytes32",
                "internalType": "bytes32"
            }
        ],
        "outputs": [
            {
                "name": "active",
                "type": "bool",
                "internalType": "bool"
            },
            {
                "name": "creator",
                "type": "address",
                "internalType": "address"
            },
            {
                "name": "totalShares",
                "type": "uint256",
                "internalType": "uint256"
            },
            {
                "name": "usdcReserve",
                "type": "uint256",
                "internalType": "uint256"
            },
            {
                "name": "lastMgmtAccrualAt",
                "type": "uint256",
                "internalType": "uint256"
            },
            {
                "name": "creatorFeeShares",
                "type": "uint256",
                "internalType": "uint256"
            },
            {
                "name": "lastNav",
                "type": "uint256",
                "internalType": "uint256"
            }
        ],
        "stateMutability": "view"
    },
    {
        "type": "function",
        "name": "updateNav",
        "inputs": [
            {
                "name": "indexId",
                "type": "bytes32",
                "internalType": "bytes32"
            },
            {
                "name": "navPerShare",
                "type": "uint256",
                "internalType": "uint256"
            },
            {
                "name": "signedAt",
                "type": "uint256",
                "internalType": "uint256"
            },
            {
                "name": "sig",
                "type": "bytes",
                "internalType": "bytes"
            }
        ],
        "outputs": [],
        "stateMutability": "nonpayable"
    },
    {
        "type": "event",
        "name": "NavUpdated",
        "inputs": [
            {
                "name": "indexId",
                "type": "bytes32",
                "indexed": True,
                "internalType": "bytes32"
            },
            {
                "name": "navPerShare",
                "type": "uint256",
                "indexed": False,
                "internalType": "uint256"
            },
            {
                "name": "signedAt",
                "type": "uint256",
                "indexed": False,
                "internalType": "uint256"
            }
        ],
        "anonymous": False
    },
    {
        "type": "function",
        "name": "verifyNavExposed",
        "inputs": [
            {
                "name": "indexId",
                "type": "bytes32",
                "internalType": "bytes32"
            },
            {
                "name": "navPerShare",
                "type": "uint256",
                "internalType": "uint256"
            },
            {
                "name": "signedAt",
                "type": "uint256",
                "internalType": "uint256"
            },
            {
                "name": "sig",
                "type": "bytes",
                "internalType": "bytes"
            }
        ],
        "outputs": [],
        "stateMutability": "view"
    },
    {
        "type": "event",
        "name": "DepositRequested",
        "inputs": [
            {
                "name": "id",
                "type": "uint256",
                "indexed": True,
                "internalType": "uint256"
            },
            {
                "name": "indexId",
                "type": "bytes32",
                "indexed": True,
                "internalType": "bytes32"
            },
            {
                "name": "who",
                "type": "address",
                "indexed": True,
                "internalType": "address"
            },
            {
                "name": "usdcIn",
                "type": "uint256",
                "indexed": False,
                "internalType": "uint256"
            }
        ],
        "anonymous": False
    },
    {
        "type": "event",
        "name": "RedeemRequested",
        "inputs": [
            {
                "name": "id",
                "type": "uint256",
                "indexed": True,
                "internalType": "uint256"
            },
            {
                "name": "indexId",
                "type": "bytes32",
                "indexed": True,
                "internalType": "bytes32"
            },
            {
                "name": "who",
                "type": "address",
                "indexed": True,
                "internalType": "address"
            },
            {
                "name": "shares",
                "type": "uint256",
                "indexed": False,
                "internalType": "uint256"
            }
        ],
        "anonymous": False
    },
    {
        "type": "event",
        "name": "Redeemed",
        "inputs": [
            {
                "name": "id",
                "type": "uint256",
                "indexed": True,
                "internalType": "uint256"
            },
            {
                "name": "indexId",
                "type": "bytes32",
                "indexed": True,
                "internalType": "bytes32"
            },
            {
                "name": "who",
                "type": "address",
                "indexed": True,
                "internalType": "address"
            },
            {
                "name": "netUsdc",
                "type": "uint256",
                "indexed": False,
                "internalType": "uint256"
            },
            {
                "name": "perfFeeUsdc",
                "type": "uint256",
                "indexed": False,
                "internalType": "uint256"
            }
        ],
        "anonymous": False
    },
    {
        "type": "event",
        "name": "Subscribed",
        "inputs": [
            {
                "name": "id",
                "type": "uint256",
                "indexed": True,
                "internalType": "uint256"
            },
            {
                "name": "indexId",
                "type": "bytes32",
                "indexed": True,
                "internalType": "bytes32"
            },
            {
                "name": "who",
                "type": "address",
                "indexed": True,
                "internalType": "address"
            },
            {
                "name": "shares",
                "type": "uint256",
                "indexed": False,
                "internalType": "uint256"
            },
            {
                "name": "navPerShare",
                "type": "uint256",
                "indexed": False,
                "internalType": "uint256"
            }
        ],
        "anonymous": False
    },
    {
        "type": "event",
        "name": "FeesClaimed",
        "inputs": [
            {
                "name": "indexId",
                "type": "bytes32",
                "indexed": True,
                "internalType": "bytes32"
            },
            {
                "name": "creator",
                "type": "address",
                "indexed": True,
                "internalType": "address"
            },
            {
                "name": "shares",
                "type": "uint256",
                "indexed": False,
                "internalType": "uint256"
            }
        ],
        "anonymous": False
    },
    {
        "type": "event",
        "name": "MgmtAccrued",
        "inputs": [
            {
                "name": "indexId",
                "type": "bytes32",
                "indexed": True,
                "internalType": "bytes32"
            },
            {
                "name": "feeShares",
                "type": "uint256",
                "indexed": False,
                "internalType": "uint256"
            },
            {
                "name": "epochDay",
                "type": "uint256",
                "indexed": False,
                "internalType": "uint256"
            }
        ],
        "anonymous": False
    },
]

# Minimal ERC-20 ABI fragments (hand-written standard; also covers MockUSDC.mint).
ERC20_ABI = [
    {
        "type": "function",
        "name": "approve",
        "inputs": [
            {"name": "spender", "type": "address"},
            {"name": "amount", "type": "uint256"}
        ],
        "outputs": [{"name": "", "type": "bool"}],
        "stateMutability": "nonpayable"
    },
    {
        "type": "function",
        "name": "balanceOf",
        "inputs": [
            {"name": "account", "type": "address"}
        ],
        "outputs": [{"name": "", "type": "uint256"}],
        "stateMutability": "view"
    },
    {
        "type": "function",
        "name": "transfer",
        "inputs": [
            {"name": "to", "type": "address"},
            {"name": "amount", "type": "uint256"}
        ],
        "outputs": [{"name": "", "type": "bool"}],
        "stateMutability": "nonpayable"
    },
    {
        "type": "function",
        "name": "decimals",
        "inputs": [],
        "outputs": [{"name": "", "type": "uint8"}],
        "stateMutability": "view"
    },
    {
        "type": "function",
        "name": "mint",
        "inputs": [
            {"name": "to", "type": "address"},
            {"name": "amount", "type": "uint256"}
        ],
        "outputs": [],
        "stateMutability": "nonpayable"
    },
]
