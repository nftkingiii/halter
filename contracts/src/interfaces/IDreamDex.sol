// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// Signatures taken from @somnia-chain/markets-sdk 0.32.1 (readsAbi.js) and
// dreamdex-bot-kit packages/perp-core/src/operator.ts. placeOrderFor matches the
// selector the pools gate operators on, 0x80054449.

struct Position {
    int128 size;
    uint128 avgEntryPrice;
    int256 entryFundingIndex;
    uint64 lastUpdatedTimestampNs;
}

interface IPerpPool {
    struct BookParams {
        uint256 tickSize;
        uint256 minQuantity;
        uint256 lotSize;
    }

    function placeOrderFor(
        address owner,
        bool isBid,
        uint64 userData,
        uint256 price,
        uint256 quantity,
        uint64 expireTimestampNs,
        uint8 orderType,
        uint8 selfMatchingOption,
        address builder,
        uint96 builderFeeBpsTimes1k
    ) external payable returns (bool success, uint128 orderId);

    function cancelOrderFor(address owner, uint128 orderId) external;
    function reduceOrderFor(address owner, uint128 orderId, uint256 newQuantityRemaining) external;
    function isOperatorAuthorized(address owner, address operator, bytes4 selector) external view returns (bool);

    function tryGetMarkPrice() external view returns (bool ok, uint256 price);
    function getOneBase() external view returns (uint256);
    function getOrderBookParameters() external view returns (BookParams memory);
    function isRestricted() external view returns (bool);
    function marginBank() external view returns (address);
}

interface IPerpPoolFactory {
    function isDeployedByFactory(address perpPool) external view returns (bool);
    function getUnrestrictedPerpPools() external view returns (address[] memory);
    function getBaseTokenForPool(address perpPool) external view returns (address);
}

interface IMarginBank {
    function getPosition(address account, address perpPool) external view returns (Position memory);
    function getAccountEquity(address account) external view returns (int256);
    function getAccountHealth(address account)
        external
        view
        returns (int256 equity, uint256 imReq, uint256 mmReq, uint256 cmReq);
    function getActivePerpPools(address account) external view returns (address[] memory);
}

interface IOperatorPermissionsRegistry {
    function setOperatorApprovalForPool(address pool, address operator, bytes4[] calldata selectors, bool approved)
        external;
    function setOperatorApprovalGlobal(address operator, bytes4[] calldata selectors, bool approved) external;
}

interface IVoucherDistributor {
    function claim() external;
}
