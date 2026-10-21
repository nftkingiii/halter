// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IPerpPool, IPerpPoolFactory, IMarginBank, Position} from "./interfaces/IDreamDex.sol";
import {SomniaEventHandler} from "./vendor/somnia-reactivity/SomniaEventHandler.sol";

/// @title Halter
/// @notice A mandate contract a dreamDEX account links as its bot. Agents never
///         hold the account's operator grant: they ask Halter, and Halter places
///         the order with `placeOrderFor` only if it fits the owner's mandate.
///         Every decision, allowed or blocked, is an event on chain.
///         Halter is also a Somnia Reactivity handler: a subscription on the
///         chain's EpochTick calls it, and it runs the guard with no keeper.
contract Halter is SomniaEventHandler {
    // ---------------------------------------------------------------- types

    struct Mandate {
        uint64 expiresAt; // unix seconds; 0 = no expiry
        uint16 maxLeverageX100; // account notional / equity, x100 (500 = 5x)
        uint128 dailyLossCap; // quote units (USDso, 18 decimals); 0 = off
        uint32 guardHealthBps; // auto-reduce when equity < mmReq * bps / 1e4 (15000 = 1.5x); 0 = off
        uint16 guardReduceBps; // share of the position the guard closes, bps
        uint16 guardSlippageBps; // IOC price room for the guard order, bps
    }

    struct Order {
        address pool;
        bool isBid;
        uint256 price;
        uint256 quantity;
        uint8 orderType; // 0 limit, 2 IOC, 3 post-only
    }

    enum Reason {
        None,
        Revoked,
        Expired,
        NotAgent,
        PoolNotAllowed,
        NotDreamDexPool,
        MarketRestricted,
        NotionalCap,
        LeverageCap,
        DailyLossCap,
        StaleMark
    }

    // ---------------------------------------------------------------- state

    address public immutable owner;
    IPerpPoolFactory public immutable factory;
    IMarginBank public immutable marginBank;

    Mandate public mandate;
    bool public revoked;

    mapping(address => bool) public isAgent;
    mapping(address => uint256) public poolNotionalCap; // 0 = pool not allowed
    address[] public allowedPools;

    uint64 public lossDay;
    int256 public dayStartEquity;

    // ---------------------------------------------------------------- events

    event MandateSet(Mandate mandate);
    event PoolSet(address indexed pool, uint256 notionalCap);
    event AgentSet(address indexed agent, bool allowed);
    event Revoked(address indexed by);
    event OrderAllowed(
        address indexed agent, address indexed pool, uint128 orderId, bool isBid, uint256 price, uint256 quantity, bool reducing
    );
    event OrderBlocked(address indexed agent, address indexed pool, Reason reason, bool isBid, uint256 price, uint256 quantity);
    event PairPlaced(address indexed agent, uint128 orderIdA, uint128 orderIdB);
    event GuardFired(address indexed caller, address indexed pool, int256 equity, uint256 mmReq, uint256 quantity, uint128 orderId);
    /// One per Reactivity callback, so every check the chain ran is on record.
    event GuardChecked(uint64 indexed epoch, uint256 fired);

    // ---------------------------------------------------------------- errors

    error NotOwner();
    error OrderRejected(Reason reason);
    error PlacementFailed(address pool);
    error GuardNotTriggered();

    uint8 private constant IOC = 2;

    constructor(address owner_, IPerpPoolFactory factory_, IMarginBank marginBank_) {
        owner = owner_;
        factory = factory_;
        marginBank = marginBank_;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    // ---------------------------------------------------------------- owner

    function setMandate(Mandate calldata m) external onlyOwner {
        mandate = m;
        revoked = false;
        emit MandateSet(m);
    }

    /// @notice Allow a market. The pool must be one dreamDEX's own factory deployed:
    ///         a look-alike pool from another venue is refused here and at every order.
    function setPool(address pool, uint256 notionalCap) external onlyOwner {
        if (notionalCap > 0 && !factory.isDeployedByFactory(pool)) revert OrderRejected(Reason.NotDreamDexPool);
        if (poolNotionalCap[pool] == 0 && notionalCap > 0) allowedPools.push(pool);
        poolNotionalCap[pool] = notionalCap;
        emit PoolSet(pool, notionalCap);
    }

    function setAgent(address agent, bool allowed) external onlyOwner {
        isAgent[agent] = allowed;
        emit AgentSet(agent, allowed);
    }

    /// @notice One tap: every agent stops at once. Reducing orders still pass through the guard.
    function revoke() external onlyOwner {
        revoked = true;
        emit Revoked(msg.sender);
    }

    // ---------------------------------------------------------------- agents

    /// @notice Place one order for the owner if it fits the mandate. A blocked order
    ///         returns (false, 0) and leaves an OrderBlocked event instead of reverting,
    ///         so refusals are part of the public record.
    function place(Order calldata o) external returns (bool placed, uint128 orderId) {
        (Reason r, bool reducing) = check(msg.sender, o);
        if (r != Reason.None) {
            emit OrderBlocked(msg.sender, o.pool, r, o.isBid, o.price, o.quantity);
            return (false, 0);
        }
        orderId = _send(o);
        emit OrderAllowed(msg.sender, o.pool, orderId, o.isBid, o.price, o.quantity, reducing);
        return (true, orderId);
    }

    /// @notice Two legs in one transaction: both are placed or neither is.
    ///         A leg the mandate blocks, or a leg the book rejects, reverts the pair.
    function placePair(Order calldata a, Order calldata b) external returns (uint128 idA, uint128 idB) {
        (Reason ra,) = check(msg.sender, a);
        if (ra != Reason.None) revert OrderRejected(ra);
        (Reason rb,) = check(msg.sender, b);
        if (rb != Reason.None) revert OrderRejected(rb);
        // Leverage must hold for the combined position, not leg by leg.
        Reason rc = _checkCombinedLeverage(a, b);
        if (rc != Reason.None) revert OrderRejected(rc);
        idA = _send(a);
        idB = _send(b);
        emit OrderAllowed(msg.sender, a.pool, idA, a.isBid, a.price, a.quantity, false);
        emit OrderAllowed(msg.sender, b.pool, idB, b.isBid, b.price, b.quantity, false);
        emit PairPlaced(msg.sender, idA, idB);
    }

    function cancel(address pool, uint128 orderId) external {
        if (!(isAgent[msg.sender] && !revoked) && msg.sender != owner) revert OrderRejected(Reason.NotAgent);
        IPerpPool(pool).cancelOrderFor(owner, orderId);
    }

    // ---------------------------------------------------------------- guard

    /// @notice Anyone may call; it only acts when the account is below the guard line,
    ///         and it only ever reduces. Wired to Somnia Reactivity by HalterReactor.
    function guard(address pool) public returns (uint128 orderId) {
        Mandate memory m = mandate;
        if (m.guardHealthBps == 0 || poolNotionalCap[pool] == 0) revert GuardNotTriggered();
        (int256 equity,, uint256 mmReq,) = marginBank.getAccountHealth(owner);
        if (mmReq == 0 || equity * 1e4 >= int256(mmReq) * int256(uint256(m.guardHealthBps))) revert GuardNotTriggered();

        Position memory p = marginBank.getPosition(owner, pool);
        if (p.size == 0) revert GuardNotTriggered();
        IPerpPool pp = IPerpPool(pool);
        (bool ok, uint256 mark) = pp.tryGetMarkPrice();
        if (!ok) revert GuardNotTriggered();
        (uint256 tick, uint256 minQty, uint256 lot) = _bookParams(pp);

        uint256 abs = p.size > 0 ? uint256(int256(p.size)) : uint256(-int256(p.size));
        uint256 qty = (abs * m.guardReduceBps / 1e4) / lot * lot;
        // The book refuses orders under minQuantity, and a remainder under it could
        // never be closed by the guard later, so small positions close in full.
        if (qty < minQty || abs - qty < minQty) qty = abs;
        bool isBid = p.size < 0; // short is closed by buying
        uint256 room = mark * m.guardSlippageBps / 1e4;
        uint256 price = isBid ? (mark + room) / tick * tick : ((mark - room) + tick - 1) / tick * tick;

        orderId = _send(Order({pool: pool, isBid: isBid, price: price, quantity: qty, orderType: IOC}));
        emit GuardFired(msg.sender, pool, equity, mmReq, qty, orderId);
    }

    /// @notice Guard every allowed pool that holds a position; never reverts.
    function guardAll() public returns (uint256 fired) {
        for (uint256 i; i < allowedPools.length; ++i) {
            try this.guard(allowedPools[i]) {
                ++fired;
            } catch {}
        }
    }

    /// @dev Reactivity callback (only the precompile at 0x0100 reaches it). The
    ///      subscription listens to EpochTick(uint64 indexed epoch, uint64 indexed block).
    function _onEvent(address, bytes32[] calldata eventTopics, bytes calldata) internal override {
        uint64 epoch = eventTopics.length > 1 ? uint64(uint256(eventTopics[1])) : 0;
        emit GuardChecked(epoch, guardAll());
    }

    // ---------------------------------------------------------------- views

    /// @notice The mandate decision for an order, without sending it. Agents call this first.
    function check(address agent, Order calldata o) public returns (Reason, bool reducing) {
        IPerpPool pp = IPerpPool(o.pool);
        int256 size = marginBank.getPosition(owner, o.pool).size;
        reducing = _isReducing(size, o.isBid, o.quantity);

        if (agent != owner && !isAgent[agent]) return (Reason.NotAgent, reducing);
        if (revoked) return (Reason.Revoked, reducing);
        Mandate memory m = mandate;
        if (m.expiresAt != 0 && block.timestamp > m.expiresAt) return (Reason.Expired, reducing);
        if (poolNotionalCap[o.pool] == 0) return (Reason.PoolNotAllowed, reducing);
        if (!factory.isDeployedByFactory(o.pool)) return (Reason.NotDreamDexPool, reducing);
        if (reducing) return (Reason.None, true); // closing risk is always allowed
        if (pp.isRestricted()) return (Reason.MarketRestricted, false);

        (bool ok, uint256 mark) = pp.tryGetMarkPrice();
        if (!ok) return (Reason.StaleMark, false);
        uint256 oneBase = pp.getOneBase();

        int256 next = o.isBid ? size + int256(o.quantity) : size - int256(o.quantity);
        uint256 absNext = next >= 0 ? uint256(next) : uint256(-next);
        if (absNext * mark / oneBase > poolNotionalCap[o.pool]) return (Reason.NotionalCap, false);

        int256 equity = marginBank.getAccountEquity(owner);
        if (m.dailyLossCap != 0 && _lossToday(equity) > int256(uint256(m.dailyLossCap))) {
            return (Reason.DailyLossCap, false);
        }
        if (m.maxLeverageX100 != 0) {
            uint256 total = _accountNotional(o.pool) + absNext * mark / oneBase;
            if (equity <= 0 || total * 100 > uint256(equity) * m.maxLeverageX100) return (Reason.LeverageCap, false);
        }
        return (Reason.None, false);
    }

    function allowedPoolCount() external view returns (uint256) {
        return allowedPools.length;
    }

    // ---------------------------------------------------------------- internal

    function _send(Order memory o) internal returns (uint128 orderId) {
        (bool success, uint128 id) = IPerpPool(o.pool).placeOrderFor(
            owner, o.isBid, 0, o.price, o.quantity, uint64(block.timestamp + 3650 days) * 1e9, o.orderType, 0, address(0), 0
        );
        if (!success) revert PlacementFailed(o.pool);
        return id;
    }

    function _isReducing(int256 size, bool isBid, uint256 qty) internal pure returns (bool) {
        if (size > 0 && !isBid) return qty <= uint256(size);
        if (size < 0 && isBid) return qty <= uint256(-size);
        return false;
    }

    /// @dev Notional of every active position except `skip`, at mark.
    function _accountNotional(address skip) internal view returns (uint256 total) {
        address[] memory pools = marginBank.getActivePerpPools(owner);
        for (uint256 i; i < pools.length; ++i) {
            if (pools[i] == skip) continue;
            int256 s = marginBank.getPosition(owner, pools[i]).size;
            if (s == 0) continue;
            IPerpPool pp = IPerpPool(pools[i]);
            (bool ok, uint256 mark) = pp.tryGetMarkPrice();
            if (!ok) continue;
            uint256 abs = s > 0 ? uint256(s) : uint256(-s);
            total += abs * mark / pp.getOneBase();
        }
    }

    function _checkCombinedLeverage(Order calldata a, Order calldata b) internal view returns (Reason) {
        uint16 lev = mandate.maxLeverageX100;
        if (lev == 0) return Reason.None;
        uint256 total = _accountNotional(a.pool);
        if (b.pool != a.pool) {
            int256 sb = marginBank.getPosition(owner, b.pool).size;
            total -= _notional(b.pool, sb);
        }
        total += _notional(a.pool, _next(a)) + _notional(b.pool, _next(b));
        int256 equity = marginBank.getAccountEquity(owner);
        if (equity <= 0 || total * 100 > uint256(equity) * lev) return Reason.LeverageCap;
        return Reason.None;
    }

    function _next(Order calldata o) internal view returns (int256) {
        int256 s = marginBank.getPosition(owner, o.pool).size;
        return o.isBid ? s + int256(o.quantity) : s - int256(o.quantity);
    }

    function _notional(address pool, int256 size) internal view returns (uint256) {
        if (size == 0) return 0;
        IPerpPool pp = IPerpPool(pool);
        (bool ok, uint256 mark) = pp.tryGetMarkPrice();
        if (!ok) return 0;
        uint256 abs = size > 0 ? uint256(size) : uint256(-size);
        return abs * mark / pp.getOneBase();
    }

    /// @dev Records the first equity seen each UTC day; returns how far equity is below it.
    function _lossToday(int256 equity) internal returns (int256) {
        uint64 day = uint64(block.timestamp / 1 days);
        if (day != lossDay) {
            lossDay = day;
            dayStartEquity = equity;
        }
        return dayStartEquity - equity;
    }

    function _bookParams(IPerpPool pp) internal view returns (uint256 tick, uint256 minQty, uint256 lot) {
        IPerpPool.BookParams memory b = pp.getOrderBookParameters();
        return (b.tickSize, b.minQuantity, b.lotSize);
    }
}
