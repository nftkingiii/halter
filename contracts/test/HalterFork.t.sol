// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {Halter} from "../src/Halter.sol";
import {
    IPerpPool,
    IPerpPoolFactory,
    IMarginBank,
    IOperatorPermissionsRegistry,
    IVoucherDistributor
} from "../src/interfaces/IDreamDex.sol";

/// Runs against a fork of Hideki testnet (chain 50383):
///   forge test --fork-url $RPC_URL -vv
contract HalterForkTest is Test {
    IPerpPoolFactory constant FACTORY = IPerpPoolFactory(0xE631fAEE547baeE07353E290f0562ea67d856560);
    IMarginBank constant BANK = IMarginBank(0x478769E1177C0773c43A593DCCc4Ad15F15F1394);
    IOperatorPermissionsRegistry constant REGISTRY =
        IOperatorPermissionsRegistry(0x6B2FbfeD328FF5F20C0BE7D3C3437613aFFE8D3a);
    IVoucherDistributor constant VOUCHER = IVoucherDistributor(0x2ACD9EFdA721450906bfE1bef3edE269636E42C4);

    address constant BTC = 0x4181dd08E73BbCdd1Ba3E615A18f6abD941b94C0;
    address constant USDSO = 0xed7993A74dAe1e6656B704A424DcD8711aAf4F72;

    address owner = makeAddr("owner");
    address agent = makeAddr("agent");
    address stranger = makeAddr("stranger");
    Halter halter;
    address eth; // second allowed market, found from the factory

    function setUp() public {
        vm.deal(owner, 10 ether);
        vm.deal(agent, 10 ether);

        // Fork-only funding: the voucher claim is gated to Arena sign-ups, so credit
        // test USDso and deposit it the way the app does (approve the bank, deposit).
        deal(USDSO, owner, 1_000e18);
        vm.startPrank(owner);
        IERC20(USDSO).approve(address(BANK), type(uint256).max);
        IBankDeposit(address(BANK)).deposit(1_000e18);
        vm.stopPrank();

        halter = new Halter(owner, address(0), FACTORY, BANK);
        bytes4[] memory sel = new bytes4[](3);
        sel[0] = 0x80054449; // placeOrderFor
        sel[1] = 0xe37b444b; // cancelOrderFor
        sel[2] = 0x364c2587; // reduceOrderFor
        vm.prank(owner);
        REGISTRY.setOperatorApprovalGlobal(address(halter), sel, true);

        address[] memory pools = FACTORY.getUnrestrictedPerpPools();
        eth = pools[1];

        vm.startPrank(owner);
        halter.setPool(BTC, 200e18); // $200 notional cap on BTC
        halter.setMandate(
            Halter.Mandate({
                expiresAt: uint64(block.timestamp + 7 days),
                maxLeverageX100: 300, // 3x
                dailyLossCap: 50e18,
                guardHealthBps: 15000,
                guardReduceBps: 5000,
                guardSlippageBps: 100
            })
        );
        halter.setAgent(agent, true);
        vm.stopPrank();

        console2.log("equity", BANK.getAccountEquity(owner));
    }

    function _restingBid(address pool, uint256 qty) internal view returns (Halter.Order memory) {
        IPerpPool pp = IPerpPool(pool);
        (, uint256 mark) = pp.tryGetMarkPrice();
        IPerpPool.BookParams memory b = pp.getOrderBookParameters();
        uint256 price = (mark * 90 / 100) / b.tickSize * b.tickSize; // 10% under mark: rests, no fill
        return Halter.Order({pool: pool, isBid: true, price: price, quantity: qty, orderType: 0});
    }

    function _minQty(address pool) internal view returns (uint256) {
        return IPerpPool(pool).getOrderBookParameters().minQuantity;
    }

    function _expectReason(Halter.Order memory o, Halter.Reason want) internal {
        (Halter.Reason got,) = halter.check(agent, o);
        assertEq(uint8(got), uint8(want), "mandate reason");
        vm.prank(agent);
        (bool placed,) = halter.place(o);
        assertEq(placed, want == Halter.Reason.None, "placed");
    }

    function test_contractIsAuthorizedOperator() public view {
        assertTrue(IPerpPool(BTC).isOperatorAuthorized(owner, address(halter), 0x80054449));
    }

    function test_agentOrderInsideMandateIsPlaced() public {
        Halter.Order memory o = _restingBid(BTC, _minQty(BTC));
        vm.prank(agent);
        (bool placed, uint128 id) = halter.place(o);
        assertTrue(placed);
        assertGt(id, 0);
    }

    function test_overNotionalIsBlocked() public {
        _expectReason(_restingBid(BTC, _minQty(BTC) * 100), Halter.Reason.NotionalCap); // ~$1,000 > $200 cap
    }

    function test_overLeverageIsBlocked() public {
        vm.prank(owner);
        halter.setPool(BTC, 1_000_000e18); // lift the pool cap so leverage is the binding limit
        // 3x of $1,000 equity = $3,000; ask for ~$4,000 of BTC
        uint256 qty = (4_000e18 * IPerpPool(BTC).getOneBase()) / _mark(BTC);
        uint256 lot = IPerpPool(BTC).getOrderBookParameters().lotSize;
        _expectReason(_restingBid(BTC, qty / lot * lot), Halter.Reason.LeverageCap);
    }

    function test_poolOutsideMandateIsBlocked() public {
        _expectReason(_restingBid(eth, _minQty(eth)), Halter.Reason.PoolNotAllowed);
    }

    function test_lookalikePoolCannotBeAllowed() public {
        address fake = address(new FakePool());
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(Halter.OrderRejected.selector, Halter.Reason.NotDreamDexPool));
        halter.setPool(fake, 1e18);
    }

    function test_strangerIsBlocked() public {
        Halter.Order memory o = _restingBid(BTC, _minQty(BTC));
        (Halter.Reason got,) = halter.check(stranger, o);
        assertEq(uint8(got), uint8(Halter.Reason.NotAgent));
        vm.prank(stranger);
        (bool placed,) = halter.place(o);
        assertFalse(placed);
    }

    function test_revokeStopsAgent() public {
        vm.prank(owner);
        halter.revoke();
        _expectReason(_restingBid(BTC, _minQty(BTC)), Halter.Reason.Revoked);
    }

    function test_expiredMandateBlocks() public {
        vm.warp(block.timestamp + 8 days);
        _expectReason(_restingBid(BTC, _minQty(BTC)), Halter.Reason.Expired);
    }

    function test_pairPlacesBothLegs() public {
        vm.prank(owner);
        halter.setPool(eth, 200e18);
        Halter.Order memory a = _restingBid(BTC, _minQty(BTC));
        Halter.Order memory b = _restingBid(eth, _minQty(eth));
        vm.prank(agent);
        (uint128 ida, uint128 idb) = halter.placePair(a, b);
        assertGt(ida, 0);
        assertGt(idb, 0);
    }

    function test_pairWithBlockedLegPlacesNothing() public {
        Halter.Order memory a = _restingBid(BTC, _minQty(BTC));
        Halter.Order memory b = _restingBid(eth, _minQty(eth)); // eth not in the mandate
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(Halter.OrderRejected.selector, Halter.Reason.PoolNotAllowed));
        halter.placePair(a, b);
    }

    function test_guardDoesNothingWhenHealthy() public {
        vm.expectRevert(Halter.GuardNotTriggered.selector);
        halter.guard(BTC);
    }

    // ---------------------------------------------------------------- guard + reactivity

    address constant PRECOMPILE = 0x0000000000000000000000000000000000000100;

    /// Agent buys ~$40 of BTC with an IOC through Halter, so the account holds a real position.
    function _openLong() internal returns (int256 size) {
        IPerpPool pp = IPerpPool(BTC);
        IPerpPool.BookParams memory b = pp.getOrderBookParameters();
        uint256 mark = _mark(BTC);
        uint256 qty = (40e18 * pp.getOneBase() / mark) / b.lotSize * b.lotSize;
        uint256 price = (mark * 101 / 100) / b.tickSize * b.tickSize;
        Halter.Order memory o = Halter.Order({pool: BTC, isBid: true, price: price, quantity: qty, orderType: 2});
        vm.prank(agent);
        (bool placed,) = halter.place(o);
        assertTrue(placed, "IOC open");
        size = BANK.getPosition(owner, BTC).size;
        assertGt(size, 0, "long opened");
    }

    /// Owner moves the guard line far above current health, as the demo does.
    function _armGuard(uint32 healthBps) internal {
        (uint64 exp, uint16 lev, uint128 loss,, uint16 red, uint16 slip) = halter.mandate();
        vm.prank(owner);
        halter.setMandate(
            Halter.Mandate({
                expiresAt: exp,
                maxLeverageX100: lev,
                dailyLossCap: loss,
                guardHealthBps: healthBps,
                guardReduceBps: red,
                guardSlippageBps: slip
            })
        );
    }

    function test_guardReducesLivePositionBelowLine() public {
        int256 before = _openLong();
        _armGuard(4_000_000_000); // fire while equity < 400,000x maintenance: always, for the test
        halter.guard(BTC);
        int256 afterSize = BANK.getPosition(owner, BTC).size;
        assertLt(afterSize, before, "guard reduced the long");
        assertGe(afterSize, 0, "guard never flips the position");
    }

    function test_onEventRejectsAnyoneButPrecompile() public {
        bytes32[] memory topics = new bytes32[](3);
        vm.expectRevert();
        halter.onEvent(PRECOMPILE, topics, "");
    }

    function test_reactivityCallbackRunsGuard() public {
        int256 before = _openLong();
        _armGuard(4_000_000_000);
        bytes32[] memory topics = new bytes32[](3);
        topics[0] = keccak256("EpochTick(uint64,uint64)");
        topics[1] = bytes32(uint256(42));
        vm.expectEmit(true, false, false, true, address(halter));
        emit Halter.GuardChecked(42, 1);
        vm.prank(PRECOMPILE);
        halter.onEvent(PRECOMPILE, topics, "");
        assertLt(BANK.getPosition(owner, BTC).size, before, "callback reduced the long");
    }

    function test_reactivityCallbackIsQuietWhenHealthy() public {
        _openLong();
        bytes32[] memory topics = new bytes32[](3);
        topics[0] = keccak256("EpochTick(uint64,uint64)");
        vm.expectEmit(true, false, false, true, address(halter));
        emit Halter.GuardChecked(0, 0);
        vm.prank(PRECOMPILE);
        halter.onEvent(PRECOMPILE, topics, "");
    }

    // ---------------------------------------------------------------- admin-managed account

    /// An account that can only sign inside the dreamDEX app: it links Halter (here, the
    /// operator grant) and a separate admin manages the paddock.
    function _adminManaged() internal returns (Halter h, address account, address adminKey) {
        account = makeAddr("app-wallet");
        adminKey = makeAddr("admin");
        deal(USDSO, account, 500e18);
        vm.startPrank(account);
        IERC20(USDSO).approve(address(BANK), type(uint256).max);
        IBankDeposit(address(BANK)).deposit(500e18);
        vm.stopPrank();
        h = new Halter(account, adminKey, FACTORY, BANK);
        bytes4[] memory sel = new bytes4[](3);
        sel[0] = 0x80054449; sel[1] = 0xe37b444b; sel[2] = 0x364c2587;
        vm.prank(account);
        REGISTRY.setOperatorApprovalGlobal(address(h), sel, true);
    }

    function test_adminSetsPaddockAndAgentTradesForAccount() public {
        (Halter h, address account, address adminKey) = _adminManaged();
        vm.startPrank(adminKey);
        h.setPool(BTC, 200e18);
        h.setMandate(Halter.Mandate({expiresAt: uint64(block.timestamp + 7 days), maxLeverageX100: 300, dailyLossCap: 50e18, guardHealthBps: 15000, guardReduceBps: 5000, guardSlippageBps: 100}));
        h.setAgent(agent, true);
        vm.stopPrank();
        Halter.Order memory o = _restingBid(BTC, _minQty(BTC));
        vm.prank(agent);
        (bool placed, uint128 id) = h.place(o);
        assertTrue(placed, "placed for the account");
        assertGt(id, 0);
        assertEq(h.owner(), account);
    }

    function test_strangerCannotManagePaddock() public {
        (Halter h,,) = _adminManaged();
        vm.prank(stranger);
        vm.expectRevert(Halter.NotOwner.selector);
        h.setPool(BTC, 200e18);
    }

    function test_accountCanRemoveAdmin() public {
        (Halter h, address account, address adminKey) = _adminManaged();
        vm.prank(account);
        h.setAdmin(address(0));
        vm.prank(adminKey);
        vm.expectRevert(Halter.NotOwner.selector);
        h.setAgent(agent, true);
    }

    function _mark(address pool) internal view returns (uint256 m) {
        (, m) = IPerpPool(pool).tryGetMarkPrice();
    }
}

interface IERC20 {
    function approve(address spender, uint256 amount) external returns (bool);
}

interface IBankDeposit {
    function deposit(uint256 amount) external;
}

contract FakePool {
    function placeOrderFor(address, bool, uint64, uint256, uint256, uint64, uint8, uint8, address, uint96)
        external
        payable
        returns (bool, uint128)
    {
        return (true, 1);
    }
}
