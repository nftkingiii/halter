// Live proof run: the agent trades through Halter; every outcome is a tx with an event.
//   node scripts/proof-orders.mjs
import { decodeEventLog, formatEther, parseEther } from "viem";
import { POOLS, pub, owner, agent, wallet, halterArtifact, poolAbi, loadDeployment, saveDeployment } from "./lib.mjs";

const dep = loadDeployment();
if (!dep.halter) throw new Error("deploy and set up first");
const H = dep.halter;
const abi = halterArtifact().abi;
const REASONS = ["None", "Revoked", "Expired", "NotAgent", "PoolNotAllowed", "NotDreamDexPool", "MarketRestricted", "NotionalCap", "LeverageCap", "DailyLossCap", "StaleMark"];
dep.proofs ??= [];

async function market(pool) {
  const [ok, mark] = await pub.readContract({ address: pool, abi: poolAbi, functionName: "tryGetMarkPrice" });
  if (!ok) throw new Error(`mark price for ${pool} is stale right now; rerun in a minute`);
  const oneBase = await pub.readContract({ address: pool, abi: poolAbi, functionName: "getOneBase" });
  const book = await pub.readContract({ address: pool, abi: poolAbi, functionName: "getOrderBookParameters" });
  return { mark, oneBase, ...book };
}
const align = (x, step) => (x / step) * step;

/** A bid 10% under mark: rests on the book, never fills. */
async function restingBid(pool, qty) {
  const m = await market(pool);
  return { pool, isBid: true, price: align((m.mark * 90n) / 100n, m.tickSize), quantity: qty ?? m.minQuantity, orderType: 0 };
}
/** Quantity worth about `usd` at mark. */
async function qtyFor(pool, usd) {
  const m = await market(pool);
  return align((parseEther(String(usd)) * m.oneBase) / m.mark, m.lotSize);
}

function events(receipt) {
  return receipt.logs
    .filter((l) => l.address.toLowerCase() === H.toLowerCase())
    .map((l) => { try { return decodeEventLog({ abi, data: l.data, topics: l.topics }); } catch { return null; } })
    .filter(Boolean);
}

async function run(label, account, fn, args, expect) {
  let hash, receipt;
  try {
    const { request } = await pub.simulateContract({ account, address: H, abi, functionName: fn, args });
    hash = await wallet(account).writeContract(request);
    receipt = await pub.waitForTransactionReceipt({ hash });
  } catch (e) {
    const msg = (e.shortMessage ?? e.message).split("\n")[0];
    console.log(`  --  ${label.padEnd(40)} rejected before sending: ${msg}`);
    dep.proofs.push({ label, expect, outcome: `rejected in simulation: ${msg}` });
    saveDeployment(dep);
    return null;
  }
  const evs = events(receipt);
  const outcome = evs.map((e) => e.eventName + (e.args.reason !== undefined ? `(${REASONS[e.args.reason]})` : e.args.orderId !== undefined ? `(#${e.args.orderId})` : "")).join(", ");
  const pass = outcome.includes(expect);
  console.log(`  ${pass ? "ok" : "!!"}  ${label.padEnd(40)} ${outcome || receipt.status}  ${hash}`);
  dep.proofs.push({ label, expect, outcome, pass, hash, block: Number(receipt.blockNumber), from: account.address });
  saveDeployment(dep);
  return { receipt, evs };
}

console.log(`Halter ${H}, owner ${owner.address}, agent ${agent.address}\n`);

const allowed = await run("1 allowed: BTC bid inside mandate", agent, "place", [await restingBid(POOLS.BTC)], "OrderAllowed");
await run("2 blocked: BTC ~$100 over $60 cap", agent, "place", [await restingBid(POOLS.BTC, await qtyFor(POOLS.BTC, 100))], "OrderBlocked(NotionalCap)");
await run("3 blocked: SOL not in mandate", agent, "place", [await restingBid(POOLS.SOL)], "OrderBlocked(PoolNotAllowed)");
const pair = await run("4 pair: BTC + ETH in one tx", agent, "placePair", [await restingBid(POOLS.BTC), await restingBid(POOLS.ETH)], "PairPlaced");

// Tidy the book: the agent cancels what it rested, through Halter.
const resting = [allowed, pair].flatMap((r) => r?.evs ?? []).filter((e) => e.eventName === "OrderAllowed");
for (const e of resting) await run(`   cancel #${e.args.orderId}`, agent, "cancel", [e.args.pool, e.args.orderId], "");

await run("5 owner revokes every agent", owner, "revoke", [], "Revoked");
await run("6 blocked: agent after revoke", agent, "place", [await restingBid(POOLS.BTC)], "OrderBlocked(Revoked)");

// Restore the mandate so the app and guard keep working after the proof run.
const m = await pub.readContract({ address: H, abi, functionName: "mandate" });
await run("   owner restores mandate", owner, "setMandate", [{ expiresAt: m[0], maxLeverageX100: m[1], dailyLossCap: m[2], guardHealthBps: m[3], guardReduceBps: m[4], guardSlippageBps: m[5] }], "MandateSet");

const eq = await pub.readContract({ address: "0x478769E1177C0773c43A593DCCc4Ad15F15F1394", abi: [{ type: "function", name: "getAccountEquity", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "int256" }] }], functionName: "getAccountEquity", args: [owner.address] });
console.log(`\nowner perps equity ${formatEther(eq)} USDso; proofs saved to deployments/`);
