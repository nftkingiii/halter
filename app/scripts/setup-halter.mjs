// Deploy Halter on Hideki and set up the owner's mandate.
//   node scripts/setup-halter.mjs status   read-only
//   node scripts/setup-halter.mjs deploy   agent key deploys Halter (owner = OWNER_ADDR)
//   node scripts/setup-halter.mjs setup    owner: deposit margin, link Halter, set pools, mandate, agent
import { formatEther, parseEther, parseAbi, keccak256, toBytes, toFunctionSelector, parseEventLogs } from "viem";
import {
  ADDR, POOLS, SEL, pub, owner, agent, wallet, halterArtifact, erc20Abi, bankAbi, registryAbi, poolAbi,
  loadDeployment, saveDeployment, send,
} from "./lib.mjs";

const dep = loadDeployment();
// The account Halter trades for. Default: the test key's own account. With ACCOUNT=0x...
// (an app wallet that links Halter in dreamDEX), the test key becomes the admin.
const account = dep.owner ?? process.env.ACCOUNT ?? owner.address;
const managed = account.toLowerCase() !== owner.address.toLowerCase();
const mode = process.argv[2] ?? "status";
const art = halterArtifact();
const halterAbi = art.abi;

async function status() {
  const stt = async (a) => formatEther(await pub.getBalance({ address: a }));
  const usd = formatEther(await pub.readContract({ address: ADDR.usdso, abi: erc20Abi, functionName: "balanceOf", args: [owner.address] }));
  const eq = formatEther(await pub.readContract({ address: ADDR.marginBank, abi: bankAbi, functionName: "getAccountEquity", args: [account] }));
  console.log(`account ${account}  perps equity ${eq}${managed ? "  (app wallet, links Halter in dreamDEX)" : `  wallet USDso ${usd}`}`);
  console.log(`${managed ? "admin" : "owner"} key ${owner.address}  STT ${await stt(owner.address)}`);
  console.log(`agent ${agent.address}  STT ${await stt(agent.address)}`);
  if (!dep.halter) return console.log("halter: not deployed");
  console.log(`halter ${dep.halter}`);
  for (const [sym, pool] of Object.entries(POOLS)) {
    const linked = await pub.readContract({ address: pool, abi: poolAbi, functionName: "isOperatorAuthorized", args: [account, dep.halter, SEL.placeOrderFor] });
    const cap = await pub.readContract({ address: dep.halter, abi: halterAbi, functionName: "poolNotionalCap", args: [pool] });
    console.log(`  ${sym.padEnd(4)} linked=${linked}  cap=$${formatEther(cap)}`);
  }
  const m = await pub.readContract({ address: dep.halter, abi: halterAbi, functionName: "mandate" });
  const isAgent = await pub.readContract({ address: dep.halter, abi: halterAbi, functionName: "isAgent", args: [agent.address] });
  console.log(`  mandate ${JSON.stringify(m, (k, v) => (typeof v === "bigint" ? v.toString() : v))}  agent=${isAgent}`);
}

if (mode === "deploy") {
  if (dep.halter) throw new Error(`already deployed at ${dep.halter}`);
  // v1 lives in deployments/hideki-v1.json; remember it so setup can unlink it.
  dep.previous ??= process.env.PREVIOUS_HALTER;
  const hash = await wallet(agent).deployContract({
    abi: halterAbi,
    bytecode: art.bytecode.object,
    args: [account, managed ? owner.address : "0x0000000000000000000000000000000000000000", ADDR.factory, ADDR.marginBank],
  });
  const r = await pub.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error(`deploy reverted: ${hash}`);
  Object.assign(dep, { halter: r.contractAddress, owner: account, admin: managed ? owner.address : null, agent: agent.address, deployTx: hash, deployBlock: Number(r.blockNumber) });
  dep.txs.push({ label: "deploy Halter", hash, block: Number(r.blockNumber), from: agent.address });
  saveDeployment(dep);
  console.log(`  ok  deploy Halter at ${r.contractAddress}  ${hash}`);
}

if (mode === "setup") {
  if (!dep.halter) throw new Error("deploy first");
  const H = dep.halter;
  const margin = managed ? 0n : await pub.readContract({ address: ADDR.usdso, abi: erc20Abi, functionName: "balanceOf", args: [owner.address] });
  if (managed) console.log("  --  app wallet: deposit and Link a Bot happen in the dreamDEX app, not here");
  if (margin > 0n) {
    const allowance = await pub.readContract({ address: ADDR.usdso, abi: erc20Abi, functionName: "allowance", args: [owner.address, ADDR.marginBank] });
    if (allowance < margin) await send(dep, "approve USDso to MarginBank", owner, { address: ADDR.usdso, abi: erc20Abi, functionName: "approve", args: [ADDR.marginBank, margin] });
    await send(dep, `deposit ${formatEther(margin)} USDso margin`, owner, { address: ADDR.marginBank, abi: bankAbi, functionName: "deposit", args: [margin] });
  }
  // An earlier Halter linked to this account keeps no power once v2 takes over.
  if (!managed && dep.previous && dep.previous !== H) {
    await send(dep, `unlink previous Halter ${dep.previous.slice(0, 10)}`, owner, {
      address: ADDR.registry, abi: registryAbi, functionName: "setOperatorApprovalGlobal",
      args: [dep.previous, [SEL.placeOrderFor, SEL.cancelOrderFor, SEL.reduceOrderFor], false],
    });
  }
  if (!managed) await send(dep, "link Halter as operator", owner, {
    address: ADDR.registry, abi: registryAbi, functionName: "setOperatorApprovalGlobal",
    args: [H, [SEL.placeOrderFor, SEL.cancelOrderFor, SEL.reduceOrderFor], true],
  });
  await send(dep, "allow BTC, cap $60", owner, { address: H, abi: halterAbi, functionName: "setPool", args: [POOLS.BTC, parseEther("60")] });
  await send(dep, "allow ETH, cap $60", owner, { address: H, abi: halterAbi, functionName: "setPool", args: [POOLS.ETH, parseEther("60")] });
  const now = Math.floor(Date.now() / 1000);
  await send(dep, "set mandate (2x, $25/day, 30d)", owner, {
    address: H, abi: halterAbi, functionName: "setMandate",
    args: [{ expiresAt: BigInt(now + 30 * 86400), maxLeverageX100: 200, dailyLossCap: parseEther("25"), guardHealthBps: 15000, guardReduceBps: 5000, guardSlippageBps: 100 }],
  });
  await send(dep, "allow agent key", owner, { address: H, abi: halterAbi, functionName: "setAgent", args: [agent.address, true] });
}

if (mode === "subscribe") {
  // Somnia Reactivity: the chain calls Halter.onEvent on every EpochTick. The owner
  // EOA owns the subscription and pays each callback's gas (it must hold >= 32 STT).
  if (!dep.halter) throw new Error("deploy first");
  const PRECOMPILE = "0x0000000000000000000000000000000000000100";
  const rxAbi = parseAbi([
    "function subscribe((bytes32[4] eventTopics, address origin, address caller, address emitter, address handlerContractAddress, bytes4 handlerFunctionSelector, uint64 priorityFeePerGas, uint64 maxFeePerGas, uint64 gasLimit, bool isGuaranteed, bool isCoalesced) subscriptionData) returns (uint256)",
    "event SubscriptionCreated(uint256 indexed subscriptionId, address indexed owner, (bytes32[4] eventTopics, address origin, address caller, address emitter, address handlerContractAddress, bytes4 handlerFunctionSelector, uint64 priorityFeePerGas, uint64 maxFeePerGas, uint64 gasLimit, bool isGuaranteed, bool isCoalesced) subscriptionData)",
  ]);
  const zero = "0x0000000000000000000000000000000000000000000000000000000000000000";
  const data = {
    eventTopics: [keccak256(toBytes("EpochTick(uint64,uint64)")), zero, zero, zero], // 0 = every epoch
    origin: "0x0000000000000000000000000000000000000000",
    caller: "0x0000000000000000000000000000000000000000",
    emitter: PRECOMPILE,
    handlerContractAddress: dep.halter,
    handlerFunctionSelector: toFunctionSelector("onEvent(address,bytes32[],bytes)"),
    priorityFeePerGas: 1_000_000_000n,
    maxFeePerGas: 0n,
    gasLimit: 10_000_000n,
    isGuaranteed: false,
    isCoalesced: false,
  };
  const r = await send(dep, "subscribe Halter to EpochTick", owner, { address: PRECOMPILE, abi: rxAbi, functionName: "subscribe", args: [data] });
  const created = parseEventLogs({ abi: rxAbi, logs: r.logs, eventName: "SubscriptionCreated" })[0];
  dep.subscriptionId = created ? created.args.subscriptionId.toString() : "unknown (no SubscriptionCreated log)";
  saveDeployment(dep);
  console.log(`  subscription id ${dep.subscriptionId}`);
}

await status();
