// Keyless Halter operator for app wallets (EIP-7702, "Nick's method").
//
// dreamDEX's Link a Bot accepts only addresses without code. So we make an address
// nobody holds a key for: we pick an authorization signature (r, s) from a public seed
// and recover the address that "signed" it. Finding that address's private key would mean
// solving a discrete log, so no one, including us, can ever sign for it. The account links
// it while it is still codeless; one type-4 transaction then installs Halter's code on it
// and initialises it. From then on it can only do what Halter's code allows.
//
//   DEPLOY=keyless ACCOUNT=0x.. node scripts/keyless.mjs deploy    implementation for ACCOUNT
//   DEPLOY=keyless node scripts/keyless.mjs derive                  keyless address (link this in the app)
//   DEPLOY=keyless node scripts/keyless.mjs verify                  recompute the derivation from the seed
//   DEPLOY=keyless node scripts/keyless.mjs status                  read-only
//   DEPLOY=keyless node scripts/keyless.mjs activate                install code + initialise (after linking)
//   DEPLOY=keyless node scripts/keyless.mjs setup                   paddock, agent (admin key)
//   DEPLOY=keyless node scripts/keyless.mjs subscribe               guard on Somnia Reactivity (admin key pays)
import { keccak256, toBytes, toHex, concat, numberToHex, parseEther, formatEther, parseAbi, toFunctionSelector, parseEventLogs } from "viem";
import { hashAuthorization, recoverAuthorizationAddress } from "viem/utils";
import { ADDR, POOLS, SEL, pub, owner, agent, wallet, halterArtifact, poolAbi, bankAbi, loadDeployment, saveDeployment, send } from "./lib.mjs";

if (process.env.DEPLOY !== "keyless") throw new Error("run with DEPLOY=keyless so the record goes to deployments/hideki-keyless.json");
const dep = loadDeployment();
const mode = process.argv[2] ?? "status";
const art = halterArtifact();
const abi = art.abi;
const CHAIN_ID = 50383;
const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n; // secp256k1 order
const SEED_TEXT = "Halter keyless operator v1";

/** r and s from public data only, so anyone can redo this and see no key was involved. */
async function derive(impl) {
  const authorization = { chainId: CHAIN_ID, address: impl, nonce: 0 };
  const seed = keccak256(toBytes(`${SEED_TEXT}:${impl.toLowerCase()}`));
  const s = (BigInt(keccak256(concat([seed, toHex("s")]))) % (N / 2n - 1n)) + 1n; // low-s, as EIP-7702 requires
  for (let i = 0; i < 256; i++) {
    const r = BigInt(keccak256(concat([seed, numberToHex(i, { size: 32 })]))) % N;
    for (const yParity of [0, 1]) {
      try {
        const signature = { r: numberToHex(r, { size: 32 }), s: numberToHex(s, { size: 32 }), yParity };
        const authority = await recoverAuthorizationAddress({ authorization, signature });
        return { authority, authorization, signature, seedText: `${SEED_TEXT}:${impl.toLowerCase()}`, counter: i, hash: hashAuthorization(authorization) };
      } catch { /* r is not an x-coordinate on the curve: try the next counter */ }
    }
  }
  throw new Error("no valid r in 256 tries");
}

async function status() {
  if (!dep.implementation) return console.log("no implementation yet: run deploy");
  console.log(`implementation ${dep.implementation} (owner ${dep.owner}, initializer ${owner.address})`);
  if (!dep.keyless) return console.log("keyless address not derived yet: run derive");
  const code = await pub.getCode({ address: dep.keyless.authority });
  console.log(`keyless operator ${dep.keyless.authority}  code ${code ?? "none (codeless: ready to link)"}`);
  for (const [sym, pool] of Object.entries(POOLS)) {
    const linked = await pub.readContract({ address: pool, abi: poolAbi, functionName: "isOperatorAuthorized", args: [dep.owner, dep.keyless.authority, SEL.placeOrderFor] });
    console.log(`  ${sym.padEnd(4)} linked by ${dep.owner.slice(0, 10)}=${linked}`);
  }
  if (code) {
    const [init, admin] = await Promise.all([
      pub.readContract({ address: dep.keyless.authority, abi, functionName: "initialized" }),
      pub.readContract({ address: dep.keyless.authority, abi, functionName: "admin" }),
    ]);
    console.log(`  initialized=${init} admin=${admin}`);
  }
}

if (mode === "deploy") {
  if (dep.implementation) throw new Error(`implementation already at ${dep.implementation}`);
  const account = process.env.ACCOUNT;
  if (!/^0x[0-9a-fA-F]{40}$/.test(account ?? "")) throw new Error("set ACCOUNT=0x... (the app wallet that links the operator)");
  // owner = the app wallet, admin storage unused here, initializer = the admin key
  const hash = await wallet(agent).deployContract({ abi, bytecode: art.bytecode.object, args: [account, "0x0000000000000000000000000000000000000000", owner.address, ADDR.factory, ADDR.marginBank] });
  const r = await pub.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error(`deploy reverted ${hash}`);
  Object.assign(dep, { implementation: r.contractAddress, owner: account, admin: owner.address, agent: agent.address, deployTx: hash, deployBlock: Number(r.blockNumber) });
  dep.txs.push({ label: "deploy Halter implementation", hash, block: Number(r.blockNumber), from: agent.address });
  saveDeployment(dep);
  console.log(`  ok  implementation ${r.contractAddress}  ${hash}`);
}

if (mode === "derive" || mode === "verify") {
  if (!dep.implementation) throw new Error("deploy first");
  const d = await derive(dep.implementation);
  if (mode === "verify") {
    console.log(d.authority === dep.keyless?.authority ? `verified: ${d.authority} comes from the public seed` : `MISMATCH: recorded ${dep.keyless?.authority}, recomputed ${d.authority}`);
  } else {
    dep.keyless = { authority: d.authority, seedText: d.seedText, counter: d.counter, authorization: d.authorization, signature: d.signature, authorizationHash: d.hash };
    dep.halter = d.authority;
    saveDeployment(dep);
    console.log(`keyless operator: ${d.authority}`);
    console.log(`  seed "${d.seedText}", counter ${d.counter}; anyone can recompute it with: node scripts/keyless.mjs verify`);
    console.log(`  link THIS address in the dreamDEX app (Link a bot, Perps), then run activate`);
  }
}

if (mode === "activate") {
  const k = dep.keyless;
  if (!k) throw new Error("derive first");
  if (await pub.getCode({ address: k.authority })) throw new Error("already has code");
  const linked = await pub.readContract({ address: POOLS.BTC, abi: poolAbi, functionName: "isOperatorAuthorized", args: [dep.owner, k.authority, SEL.placeOrderFor] });
  if (!linked && process.env.FORCE !== "1") throw new Error("the account hasn't linked the keyless address yet (link it in the app first, or FORCE=1)");
  const authorizationList = [{ ...k.authorization, r: k.signature.r, s: k.signature.s, yParity: k.signature.yParity }];
  // One transaction: install Halter's code on the keyless address and initialise it, so
  // there is no window in which anyone else could initialise it first.
  const { request } = await pub.simulateContract({ account: owner, address: k.authority, abi, functionName: "initialize", args: [owner.address], authorizationList });
  const hash = await wallet(owner).writeContract(request);
  const r = await pub.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error(`activate reverted ${hash}`);
  dep.txs.push({ label: "activate keyless operator (EIP-7702) + initialize", hash, block: Number(r.blockNumber), from: owner.address });
  saveDeployment(dep);
  console.log(`  ok  activated ${k.authority}  ${hash}`);
  console.log(`  code now ${await pub.getCode({ address: k.authority })}`);
}

if (mode === "setup") {
  const H = dep.keyless?.authority;
  if (!H || !(await pub.getCode({ address: H }))) throw new Error("activate first");
  await send(dep, "allow BTC, cap $60", owner, { address: H, abi, functionName: "setPool", args: [POOLS.BTC, parseEther("60")] });
  await send(dep, "allow ETH, cap $60", owner, { address: H, abi, functionName: "setPool", args: [POOLS.ETH, parseEther("60")] });
  const now = Math.floor(Date.now() / 1000);
  await send(dep, "set paddock (2x, $25/day, 30d)", owner, {
    address: H, abi, functionName: "setMandate",
    args: [{ expiresAt: BigInt(now + 30 * 86400), maxLeverageX100: 200, dailyLossCap: parseEther("25"), guardHealthBps: 15000, guardReduceBps: 5000, guardSlippageBps: 100 }],
  });
  await send(dep, "allow agent key", owner, { address: H, abi, functionName: "setAgent", args: [agent.address, true] });
  const eq = await pub.readContract({ address: ADDR.marginBank, abi: bankAbi, functionName: "getAccountEquity", args: [dep.owner] });
  console.log(`  account ${dep.owner} perps equity ${formatEther(eq)}`);
}

if (mode === "subscribe") {
  // The chain calls the operator's onEvent each EpochTick; the delegated code runs the guard.
  const H = dep.keyless?.authority;
  if (!H || !(await pub.getCode({ address: H }))) throw new Error("activate first");
  if (dep.subscriptionId) throw new Error(`already subscribed: ${dep.subscriptionId}`);
  const PRECOMPILE = "0x0000000000000000000000000000000000000100";
  const rxAbi = parseAbi([
    "function subscribe((bytes32[4] eventTopics, address origin, address caller, address emitter, address handlerContractAddress, bytes4 handlerFunctionSelector, uint64 priorityFeePerGas, uint64 maxFeePerGas, uint64 gasLimit, bool isGuaranteed, bool isCoalesced) subscriptionData) returns (uint256)",
    "event SubscriptionCreated(uint256 indexed subscriptionId, address indexed owner, (bytes32[4] eventTopics, address origin, address caller, address emitter, address handlerContractAddress, bytes4 handlerFunctionSelector, uint64 priorityFeePerGas, uint64 maxFeePerGas, uint64 gasLimit, bool isGuaranteed, bool isCoalesced) subscriptionData)",
  ]);
  const zero = "0x0000000000000000000000000000000000000000000000000000000000000000";
  const data = {
    eventTopics: [keccak256(toBytes("EpochTick(uint64,uint64)")), zero, zero, zero],
    origin: "0x0000000000000000000000000000000000000000",
    caller: "0x0000000000000000000000000000000000000000",
    emitter: PRECOMPILE,
    handlerContractAddress: H,
    handlerFunctionSelector: toFunctionSelector("onEvent(address,bytes32[],bytes)"),
    priorityFeePerGas: 1_000_000_000n,
    maxFeePerGas: 0n,
    gasLimit: 10_000_000n,
    isGuaranteed: false,
    isCoalesced: false,
  };
  const r = await send(dep, "subscribe keyless operator to EpochTick", owner, { address: PRECOMPILE, abi: rxAbi, functionName: "subscribe", args: [data] });
  const created = parseEventLogs({ abi: rxAbi, logs: r.logs, eventName: "SubscriptionCreated" })[0];
  dep.subscriptionId = created ? created.args.subscriptionId.toString() : "unknown (no SubscriptionCreated log)";
  saveDeployment(dep);
  console.log(`  subscription id ${dep.subscriptionId}`);
}

await status();
