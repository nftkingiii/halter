# Halter

**Let a bot trade your dreamDEX perps account, but only inside limits you set on chain.**

Linking a bot to dreamDEX today means handing a key full trading power over your account. It can't withdraw, but it can open any market, at any size, at any leverage, for as long as it runs. Halter is a contract you link *instead* of the bot. Your bots and AI agents send their orders to Halter, and Halter forwards an order with `placeOrderFor` only if it fits your mandate:

- **Markets you allow**, each checked against dreamDEX's own `PerpPoolFactory`. A look-alike pool from another venue can't be added, and no order reaches one.
- **Notional cap per market**, **account leverage cap**, **daily loss cap** and **expiry**.
- **One-tap revoke**: every agent stops at once.
- **Pairs in one transaction**: both legs are placed or neither is.
- **A guard** that reduces a position when margin health drops, so a stop still holds while your bot is offline (wiring to Somnia Reactivity is in progress).

Every decision is a public record. Allowed orders emit `OrderAllowed`. Blocked orders don't revert: they emit `OrderBlocked` with the reason, so what your agent *tried* is as visible as what it did.

Built for the [dreamDEX Perps Builder Bounty](https://dorahacks.io/hackathon/dreamdex-perps-bounty/detail) on Somnia Hideki testnet (chain 50383).

## Who it's for

- Traders who want to run a bot or an AI agent without trusting it with their whole account.
- Bot builders who want to show users exactly what their bot can and cannot do.

## Status

Work in progress. Live on Somnia Hideki testnet since 2026-10-20.

**Halter:** [`0x24bd6b71f27c7aad65fb9842c6181b65b571a833`](https://explorer.testnet.somnia.network/tokyo/address/0x24bd6b71f27c7aad65fb9842c6181b65b571a833)
Owner (test account, 100 USDso margin): `0xa7770b44A07f3a931Cb30Ae2601a52d01f16b580` · Agent key: `0xFB3f3e9f86aeEDbC68dc0d4fa26eA7896c37800B`
Mandate: BTC and ETH only, $60 notional cap each, 2x account leverage, $25 daily loss cap, 30-day expiry.

### Live proof run (Hideki testnet)

The agent key trades only through Halter. Every row is one transaction. Allowed orders carry logs from dreamDEX's BTC/ETH pools and MarginBank; blocked orders succeed as transactions but carry only Halter's `OrderBlocked` log, so nothing reaches a pool.

| # | What the agent tried | Outcome on chain | Tx |
|---|---|---|---|
| 1 | BTC bid inside the mandate | `OrderAllowed`, order rests on the dreamDEX BTC book | [0x5679d26e…](https://explorer.testnet.somnia.network/tokyo/tx/0x5679d26e0eb0c73a78d5671bd27333b2f7a3e3fb742bc972e433ec8852ff56be) |
| 2 | BTC bid worth ~$100, over the $60 cap | `OrderBlocked(NotionalCap)` | [0x58b8f5a1…](https://explorer.testnet.somnia.network/tokyo/tx/0x58b8f5a1d2f9fbca57671423f1bffaca3445490de3e664aaccc338b72c4f6e7a) |
| 3 | SOL bid; the account's link covers SOL, the mandate doesn't | `OrderBlocked(PoolNotAllowed)` | [0xfd4b4011…](https://explorer.testnet.somnia.network/tokyo/tx/0xfd4b40112b1e84f9ccfeddabe8cfd4466a0486747c8eacda5a7475c90ec12148) |
| 4 | BTC + ETH pair | both legs placed in one tx, `PairPlaced` | [0xe305ca13…](https://explorer.testnet.somnia.network/tokyo/tx/0xe305ca13b0a7ad922f00caeb5e810bc22cb5c2154faecb4e0956da047c1c3e28) |
| 5 | Owner revokes every agent | `Revoked` | [0x180ddd0b…](https://explorer.testnet.somnia.network/tokyo/tx/0x180ddd0bf051b6d1c3040735db9b9bb2f2beae5ad730ae59e03cdb75b5d9e8bb) |
| 6 | Agent tries again after revoke | `OrderBlocked(Revoked)` | [0xbfefa440…](https://explorer.testnet.somnia.network/tokyo/tx/0xbfefa4402d76f6430e600624fc9f9f05e98da69b623c12edb63ff3b780416578) |

The agent then cancelled its three resting orders through Halter and the owner restored the mandate. Setup (deposit, operator link, pools, mandate) and every hash are in [`deployments/hideki-v1.json`](deployments/hideki-v1.json). Reproduce with `node app/scripts/proof-orders.mjs`.

### Evidence by kind

| Claim | Evidence | Kind |
|---|---|---|
| Halter, as the account's linked operator, places and cancels orders on dreamDEX perp pools | rows 1 and 4 above | **live testnet** |
| Over-cap, unlisted-pool and post-revoke orders are blocked, with the reason on chain | rows 2, 3, 6 | **live testnet** |
| Pairs go out in one transaction | row 4 | **live testnet** |
| Over-leverage, look-alike pool, stranger and expired orders are blocked; a pair with a blocked leg places neither leg | `contracts/test/HalterFork.t.sol`, 12/12 passing | fork of live Hideki state |
| Guard reduces a position when margin health drops | contract written, not yet exercised | pending |
| Reactivity triggers the guard | not built | pending |

## Layout

```
contracts/   Foundry project: src/Halter.sol, interfaces, fork tests
tools/       rpc-1898-proxy.mjs (fork workaround), fund-testnet.mjs (dev key funding)
feedback/    Feedback-track reports, one issue per file
```

## Run the tests

The Hideki RPC rejects the EIP-1898 block parameters Foundry sends (see `feedback/01-…`), so forks go through a small local proxy:

```bash
node tools/rpc-1898-proxy.mjs &                 # 127.0.0.1:8545 -> Hideki
cd contracts && forge test --fork-url http://127.0.0.1:8545 -vv
```

## X posts

To be added (2–3 posts tagging @DreamDEXSomnia).

## License

MIT
