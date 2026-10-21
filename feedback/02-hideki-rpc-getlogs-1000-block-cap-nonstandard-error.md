# Hideki RPC caps eth_getLogs at 1,000 blocks (~100 s) with a non-standard error code, and the docs don't mention it
Severity: normal
Area: API

## Steps to reproduce
1. Ask the Hideki RPC for logs over 2,001 blocks:
   ```bash
   curl -s -X POST https://api.hideki2.infra.testnet.somnia.network \
     -H "content-type: application/json" \
     -d '{"jsonrpc":"2.0","id":1,"method":"eth_getLogs","params":[{"fromBlock":"0x1","toBlock":"0x7d1"}]}'
   ```
2. Do the same through viem 2.57.7, the client the markets SDK uses:
   ```js
   import { createPublicClient, http } from "viem";
   const c = createPublicClient({ transport: http("https://api.hideki2.infra.testnet.somnia.network") });
   const head = await c.getBlockNumber();
   await c.getLogs({ address: "0xc904a9ac96bfda2989ead531bc57fd8d5ee56b06", fromBlock: head - 5000n, toBlock: head });
   ```
3. Read the "Perps on testnet for developers" page (https://app.testnet.dreamdex.io/docs/developers/perps-testnet) for any limit on log queries.

## Expected
- The range limit is documented next to the RPC endpoint, together with Hideki's block rate, so a developer can size queries.
- An over-range request fails with the standard JSON-RPC "limit exceeded" error (`-32005`, EIP-1474), which client libraries recognise and handle by splitting the range.

## Actual
- Step 1 returns `{"jsonrpc":"2.0","id":1,"error":{"code":-1,"message":"block range exceeds 1000","data":null}}`. Code `-1` is outside the JSON-RPC error ranges.
- Step 2 throws viem's generic `RpcRequestError: RPC Request failed.` (details: `block range exceeds 1000`) rather than `LimitExceededRpcError`, so nothing in the client knows to split the range.
- Step 3: the page names `eth_call` and `eth_estimateGas` but never `eth_getLogs`, a range limit, or how to read event history other than through the GraphQL indexer.

Hideki produces about 10 blocks a second (600 blocks in 60 s at heads 29,099,xxx on 2026-10-21), so 1,000 blocks is roughly 100 seconds of history per request. Reading one contract's events for a day takes about 860 sequential requests. Anyone who wants their own contract's history on chain (for example, events of a contract that isn't in the dreamDEX indexer) has to build a range-splitting cache. We did, for Halter: `app/server/index.mjs` tails Halter's logs in 1,000-block steps.

## Evidence
- Raw response in step 1, captured 2026-10-21.
- viem error captured 2026-10-21: `RpcRequestError | RPC Request failed. | details: block range exceeds 1000`.
- Our workaround: https://github.com/nftkingiii/halter/blob/main/app/server/index.mjs (`STEP = 1000n`).

## Environment
viem 2.57.7, @somnia-chain/markets-sdk 0.32.1, Node 22.20, network Somnia Hideki testnet (chain 50383), RPC https://api.hideki2.infra.testnet.somnia.network. No wallet needed.
