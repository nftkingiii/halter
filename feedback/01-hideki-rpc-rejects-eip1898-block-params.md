# Hideki RPC rejects EIP-1898 block parameters, so Foundry forks and anvil cannot start
Severity: major
Area: API

## Steps to reproduce
1. Call `eth_getBalance` with an EIP-1898 block object:
   ```bash
   curl -s -X POST https://api.hideki2.infra.testnet.somnia.network \
     -H "content-type: application/json" \
     -d '{"jsonrpc":"2.0","id":1,"method":"eth_getBalance","params":["0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",{"blockNumber":"0x1b249f6"}]}'
   ```
2. Repeat with `{"blockHash":"<hash of that block>"}`.
3. Run `anvil --fork-url https://api.hideki2.infra.testnet.somnia.network` or `forge test --fork-url …`.

## Expected
The node accepts the EIP-1898 object form, as it accepts the plain `"0x1b249f6"` block number, and returns the balance. Foundry forks and anvil start normally, so contracts that integrate with dreamDEX perps can be tested against live pool state.

## Actual
Steps 1 and 2 return `{"code":-32602,"message":"invalid parameters"}`. The same call with a plain hex block number succeeds.
Step 3 fails before any test runs:
```
Error: failed to create genesis
- failed to get account for 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266: server returned an error response: error code -32602: invalid parameters, data: null
```

## Evidence
- Requests and responses above, reproduced 2026-10-20 at block 0x1b249f6.
- Workaround that proves the cause: a small proxy that rewrites `{blockNumber}` / `{blockHash}` to a plain block number makes `forge test --fork-url` pass (tools/rpc-1898-proxy.mjs in this repo).

## Environment
Foundry forge 1.8.5 (anvil same release), Ubuntu 22.04, network Somnia Hideki testnet (chain 50383), RPC https://api.hideki2.infra.testnet.somnia.network. No wallet needed.
