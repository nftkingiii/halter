# Halter

**Let a bot trade your dreamDEX perps account, but only inside limits you set on chain.**

Linking a bot to dreamDEX today means handing a key full trading power over your account. It can't withdraw, but it can open any market, at any size, at any leverage, for as long as it runs. Halter is a contract you link *instead* of the bot. Your bots and AI agents send their orders to Halter, and Halter forwards an order with `placeOrderFor` only if it fits your mandate:

- **Markets you allow**, each checked against dreamDEX's own `PerpPoolFactory`. A look-alike pool from another venue can't be added, and no order reaches one.
- **Notional cap per market**, **account leverage cap**, **daily loss cap** and **expiry**.
- **One-tap revoke**: every agent stops at once.
- **Pairs in one transaction**: both legs are placed or neither is.
- **A guard on Somnia Reactivity**: every epoch (~5 min) the chain itself calls Halter, which reduces a position whose margin health is below your line. No keeper, and no bot needs to be running.

Every decision is a public record. Allowed orders emit `OrderAllowed`. Blocked orders don't revert: they emit `OrderBlocked` with the reason, so what your agent *tried* is as visible as what it did.

Built for the [dreamDEX Perps Builder Bounty](https://dorahacks.io/hackathon/dreamdex-perps-bounty/detail) on Somnia Hideki testnet (chain 50383).

## Who it's for

- Traders who want to run a bot or an AI agent without trusting it with their whole account.
- Bot builders who want to show users exactly what their bot can and cannot do.

## Status

Work in progress. Live on Somnia Hideki testnet since 2026-10-20.

**Halter (v2, current):** [`0xc904a9ac96bfda2989ead531bc57fd8d5ee56b06`](https://explorer.testnet.somnia.network/tokyo/address/0xc904a9ac96bfda2989ead531bc57fd8d5ee56b06), Reactivity subscription `14557199` on `EpochTick`
Halter v1 (order proofs below, now unlinked from the account): `0x24bd6b71f27c7aad65fb9842c6181b65b571a833`
Owner (test account, 100 USDso margin): `0xa7770b44A07f3a931Cb30Ae2601a52d01f16b580` · Agent key: `0xFB3f3e9f86aeEDbC68dc0d4fa26eA7896c37800B`
Mandate: BTC and ETH only, $60 notional cap each, 2x account leverage, $25 daily loss cap, 30-day expiry, guard line 1.5x maintenance margin.

### Live guard run on Somnia Reactivity (Hideki testnet, v2)

Nobody calls the guard. The owner subscribed Halter to the chain's `EpochTick`, and the chain calls `Halter.onEvent` once per epoch. The callbacks below are system transactions: `onEvent` reverts for any sender but the precompile `0x0100`, and they carry system nonces and a placeholder signature (`r = 0x1`) rather than the owner's own nonces 17 and 18.

| # | Step | Outcome on chain | Tx |
|---|---|---|---|
| 1 | Agent opens a ~$40 BTC long through Halter (IOC) | position 48,000 units (0.00048 BTC) | [0xc9091480…](https://explorer.testnet.somnia.network/tokyo/tx/0xc9091480065b0a99363a9d7014e4f3e7ff2763b163a685462aa7b5066e6ce638) |
| 2 | Chain calls Halter, epoch 9706, account healthy (~100x maintenance) | `GuardChecked(9706, 0)`, nothing traded, 238k gas | [0x6e2bf275…](https://explorer.testnet.somnia.network/tokyo/tx/0x6e2bf27568a9b0ed67cce31bc9f9f026336c7405eba8c986df2f3580f8a60291) |
| 3 | Owner raises the guard line to 201.6x maintenance (**demo threshold**: a real breach of 1.5x needs a large market move) | `MandateSet` | [0x1a6f2b40…](https://explorer.testnet.somnia.network/tokyo/tx/0x1a6f2b407dea9b6c45f5e24091af2ed38e549b45ada96d34120091bf0d1bf385) |
| 4 | Chain calls Halter, epoch 9707, 3,000 blocks later | `GuardFired` + `GuardChecked(9707, 1)`; dreamDEX BTC pool and MarginBank logs; position 48,000 → 24,000 | [0x99626aab…](https://explorer.testnet.somnia.network/tokyo/tx/0x99626aab83b6d936090fe4cbb155d5b981c3e367323446a4590b8d339bff1730) |
| 5 | Owner restores the 1.5x line | `MandateSet` | [0x6ba9727f…](https://explorer.testnet.somnia.network/tokyo/tx/0x6ba9727f58241c3743337d92386b32e2468b92a420a6312e5515910f9a0bc0d0) |
| 6 | Agent closes the rest through Halter (reducing IOC) | position 0 | [0xf74f89b6…](https://explorer.testnet.somnia.network/tokyo/tx/0xf74f89b6097c404b2ef7590ba235d59c0bf0b0a9fa95acbf808f657a2b4effdf) |

v2 setup, the subscription and every hash: [`deployments/hideki.json`](deployments/hideki.json). Reproduce with `node app/scripts/guard-demo.mjs`.

### Live order proof run (Hideki testnet, v1)

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
| Somnia Reactivity calls Halter every epoch with no keeper; quiet while healthy | guard rows 2 and 4 | **live testnet** |
| The guard reduces a live position below the line, without flipping it | guard row 4 (fired at a labelled demo threshold) | **live testnet** |
| Over-leverage, look-alike pool, stranger and expired orders are blocked; a pair with a blocked leg places neither leg; `onEvent` rejects any caller but the precompile | `contracts/test/HalterFork.t.sol`, 16/16 passing | fork of live Hideki state |
| The guard fires on a real 1.5x breach from a market move | not observed | pending |

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
