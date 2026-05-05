// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title SSI Registry
/// @notice Stores published HypeIndex / SSI metadata on-chain. Each index is
///         keyed by `keccak256(symbol)` and registered exactly once.
///         Off-chain components read the `IndexRegistered` event to ingest
///         new listings.
contract SSIRegistry {
    struct Index {
        address creator;
        uint64  createdAt;
        string  symbol;
        string  name;
        string  base;            // quote / settlement token, e.g. "USDC"
        string[] tokens;         // constituent symbols
        uint16[] weightsBps;     // basis points; sum must equal 10000
        uint16  mgmtFeeBps;
        uint16  perfFeeBps;
        string  rebalanceCron;
    }

    mapping(bytes32 => Index) private _indexes;
    bytes32[] private _indexIds;

    event IndexRegistered(
        bytes32 indexed id,
        address indexed creator,
        string symbol,
        string name
    );

    error EmptySymbol();
    error WeightsLengthMismatch(uint256 tokens, uint256 weights);
    error WeightsSumInvalid(uint256 got);
    error IndexAlreadyExists(bytes32 id);
    error IndexNotFound(bytes32 id);

    function registerIndex(
        string calldata symbol,
        string calldata name,
        string calldata base,
        string[] calldata tokens,
        uint16[] calldata weightsBps,
        uint16  mgmtFeeBps,
        uint16  perfFeeBps,
        string calldata rebalanceCron
    ) external returns (bytes32 id) {
        if (bytes(symbol).length == 0) revert EmptySymbol();
        if (tokens.length != weightsBps.length) {
            revert WeightsLengthMismatch(tokens.length, weightsBps.length);
        }
        uint256 sum;
        for (uint256 i; i < weightsBps.length; ++i) sum += weightsBps[i];
        if (sum != 10_000) revert WeightsSumInvalid(sum);

        id = keccak256(bytes(symbol));
        if (_indexes[id].creator != address(0)) revert IndexAlreadyExists(id);

        Index storage idx = _indexes[id];
        idx.creator        = msg.sender;
        idx.createdAt      = uint64(block.timestamp);
        idx.symbol         = symbol;
        idx.name           = name;
        idx.base           = base;
        idx.mgmtFeeBps     = mgmtFeeBps;
        idx.perfFeeBps     = perfFeeBps;
        idx.rebalanceCron  = rebalanceCron;
        for (uint256 i; i < tokens.length; ++i) {
            idx.tokens.push(tokens[i]);
            idx.weightsBps.push(weightsBps[i]);
        }
        _indexIds.push(id);

        emit IndexRegistered(id, msg.sender, symbol, name);
    }

    function getIndex(bytes32 id) external view returns (Index memory) {
        Index memory idx = _indexes[id];
        if (idx.creator == address(0)) revert IndexNotFound(id);
        return idx;
    }

    function indexCount() external view returns (uint256) {
        return _indexIds.length;
    }

    function indexIdAt(uint256 i) external view returns (bytes32) {
        return _indexIds[i];
    }

    function exists(bytes32 id) external view returns (bool) {
        return _indexes[id].creator != address(0);
    }
}
