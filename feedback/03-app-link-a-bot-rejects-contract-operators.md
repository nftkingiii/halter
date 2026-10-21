# App: Link a Bot rejects contract addresses, although the protocol and dreamDEX's own StopRegistry use contract operators
Severity: normal
Area: app

## Steps to reproduce
1. Sign in at https://app.testnet.dreamdex.io with an app wallet ("Wallet 1", a smart-contract wallet that signs only through the app).
2. Open the wallet panel, choose **Link a bot**, keep **Perps** ticked.
3. Paste the address of a contract that is built to be a perps operator, for example Halter at `0x143ec8eb34fb826d51090b1dfcf40ecbab241e75` on Hideki (it calls `placeOrderFor` for one account, inside limits it enforces on chain).
4. Press **Add bot**.

## Expected
The app writes the same operator grant it writes for a key: `placeOrderFor`, `cancelOrderFor` and `reduceOrderFor` for that address, through the `OperatorPermissionsRegistry`. The protocol accepts contract operators, so the app should too, or at least say why it doesn't.

## Actual
The form refuses with: **"That address is a contract. Enter the address your bot trades from."** Nothing is written.

The restriction exists only in the app:
- The pools gate operators with `isOperatorAuthorized(owner, operator, selector)`, which doesn't care whether the operator has code. From an account that signs directly, we linked a contract (Halter v2, `0xc904a9ac96bfda2989ead531bc57fd8d5ee56b06`) with `setOperatorApprovalGlobal`, tx `0x26af5ac4652b1139e43e8c601986a0bbe83de8f8c03a10a010edb4f797ada2fa`. That contract has since placed, cancelled and reduced orders on the BTC and ETH pools for the account (e.g. tx `0x5679d26e0eb0c73a78d5671bd27333b2f7a3e3fb742bc972e433ec8852ff56be`, `0xe305ca13b0a7ad922f00caeb5e810bc22cb5c2154faecb4e0956da047c1c3e28`).
- dreamDEX itself relies on a contract operator: the markets SDK grants each account's operator approval to the perp **StopRegistry**, a contract, so stop orders can be placed with `placeOrderFor` (`@somnia-chain/markets-sdk` 0.32.1, `dist/perp/stops.js`, `operatorGrantCall`).

App wallets can't call the registry outside the app, so for them the app is the only way to link anything. The form's own advice ("give a bot a wallet of its own and move in only what you want it to trade") describes exactly what a contract operator can enforce on chain: allowed markets, caps, leverage, expiry and revocation. Today an app-wallet user can only link a raw key, which has the full place/cancel/reduce power over the wallet.

## Evidence
- App message, reported by the account holder on 2026-10-21 while linking `0x143ec8eb34fb826d51090b1dfcf40ecbab241e75` for account `0x0B2BdDB6D30c30f3923DDEb2EE875d025bc42034`.
- Contract operator working through the registry: the transactions above, all listed in https://github.com/nftkingiii/halter/blob/main/deployments/hideki-v1.json and `deployments/hideki.json`.

## Environment
app.testnet.dreamdex.io (perps, Hideki), Somnia Hideki testnet (chain 50383), account `0x0B2BdDB6D30c30f3923DDEb2EE875d025bc42034` (app wallet), `@somnia-chain/markets-sdk` 0.32.1.
