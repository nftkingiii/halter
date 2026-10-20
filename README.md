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

Work in progress. What's verified so far is labelled by kind of evidence:

| Claim | Evidence | Kind |
|---|---|---|
| Halter, as the account's linked operator, places orders on dreamDEX BTC and ETH perp pools | `contracts/test/HalterFork.t.sol`, 12/12 passing | fork of live Hideki state |
| Over-notional, over-leverage, unlisted pool, look-alike pool, stranger, revoked and expired orders are blocked with the right reason | same suite | fork |
| A pair with a blocked leg places neither leg | same suite | fork |
| Live orders on Hideki testnet | pending | — |

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
