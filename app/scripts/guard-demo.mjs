// Live guard demo: Somnia Reactivity calls Halter every epoch; no keeper, no bot running.
//   node scripts/guard-demo.mjs
// 1. agent opens ~$40 BTC long through Halter (IOC)
// 2. wait for a Reactivity callback while healthy -> GuardChecked(epoch, 0)
// 3. owner raises the guard line above current health (demo threshold, labelled as such)
// 4. wait for the next callback -> GuardFired + GuardChecked(epoch, 1), position reduced
// 5. owner restores the 1.5x line; agent closes the rest through Halter
import { formatEther, parseEther, parseAbi, parseEventLogs } from "viem";
import { POOLS, ADDR, pub, owner, agent, wallet, halterArtifact, poolAbi, bankAbi, loadDeployment, saveDeployment } from "./lib.mjs";

const dep = loadDeployment();
if (!dep.halter || !dep.subscriptionId) throw new Error("deploy, setup and subscribe first");
const H = dep.halter;
const abi = halterArtifact().abi;
const posAbi = parseAbi(["function getPosition(address,address) view returns ((int128 size, uint128 avgEntryPrice, int256 entryFundingIndex, uint64 lastUpdatedTimestampNs))"]);
dep.guardDemo ??= [];
const note = (label, extra) => { dep.guardDemo.push({ label, at: new Date().toISOString(), ...extra }); saveDeployment(dep); };

const position = async () => (await pub.readContract({ address: ADDR.marginBank, abi: posAbi, functionName: "getPosition", args: [owner.address, POOLS.BTC] })).size;
const health = async () => {
  const [equity, , mmReq] = await pub.readContract({ address: ADDR.marginBank, abi: bankAbi, functionName: "getAccountHealth", args: [owner.address] });
  return { equity, mmReq };
};

async function tx(label, account, functionName, args) {
  const { request } = await pub.simulateContract({ account, address: H, abi, functionName, args });
  const hash = await wallet(account).writeContract(request);
  const r = await pub.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error(`${label} reverted ${hash}`);
  console.log(`  ok  ${label.padEnd(44)} ${hash}`);
  note(label, { hash, block: Number(r.blockNumber) });
  return r;
}

async function ioc(isBid, usd, maxQty) {
  const book = await pub.readContract({ address: POOLS.BTC, abi: poolAbi, functionName: "getOrderBookParameters" });
  const [, mark] = await pub.readContract({ address: POOLS.BTC, abi: poolAbi, functionName: "tryGetMarkPrice" });
  const one = await pub.readContract({ address: POOLS.BTC, abi: poolAbi, functionName: "getOneBase" });
  let qty = ((parseEther(String(usd)) * one) / mark / book.lotSize) * book.lotSize;
  if (maxQty !== undefined) qty = maxQty;
  const price = ((isBid ? (mark * 101n) / 100n : (mark * 99n) / 100n) / book.tickSize) * book.tickSize;
  return { pool: POOLS.BTC, isBid, price, quantity: qty, orderType: 2 };
}

/** Wait for the next Reactivity callback into Halter after `fromBlock`. */
async function nextCallback(fromBlock, wantFired, minutes = 15) {
  const deadline = Date.now() + minutes * 60_000;
  let from = fromBlock;
  process.stdout.write(`  ..  waiting for a Reactivity callback (${wantFired ? "fired" : "quiet"})`);
  while (Date.now() < deadline) {
    const head = await pub.getBlockNumber();
    const logs = await pub.getLogs({ address: H, fromBlock: from, toBlock: head });
    const evs = parseEventLogs({ abi, logs });
    for (const e of evs.filter((x) => x.eventName === "GuardChecked")) {
      if ((e.args.fired > 0n) === wantFired) {
        const sameTx = evs.filter((x) => x.transactionHash === e.transactionHash).map((x) => x.eventName);
        const t = await pub.getTransaction({ hash: e.transactionHash });
        console.log(`\n  ok  callback epoch ${e.args.epoch} fired=${e.args.fired} [${sameTx.join(", ")}] from ${t.from} -> ${t.to}  ${e.transactionHash}`);
        note(`reactivity callback, epoch ${e.args.epoch}, fired ${e.args.fired}`, { hash: e.transactionHash, block: Number(e.blockNumber), events: sameTx, txFrom: t.from, txTo: t.to });
        return e;
      }
    }
    from = head + 1n;
    process.stdout.write(".");
    await new Promise((r) => setTimeout(r, 15_000));
  }
  throw new Error(`no ${wantFired ? "firing" : "quiet"} callback within ${minutes} min`);
}

console.log(`Halter ${H}  subscription ${dep.subscriptionId}  owner ${owner.address}\n`);

// 1. open a position through Halter
const open = await tx("agent opens ~$40 BTC long (IOC)", agent, "place", [await ioc(true, 40)]);
const sizeOpen = await position();
console.log(`      BTC position ${sizeOpen}`);

// 2. a quiet check while healthy: the chain calls Halter, nothing to do
await nextCallback(open.blockNumber, false);

// 3. demo threshold: guard line at 2x the account's current equity / maintenance ratio
const { equity, mmReq } = await health();
const ratioBps = (equity * 10_000n) / mmReq;
const demoBps = ratioBps * 2n > 4_000_000_000n ? 4_000_000_000n : ratioBps * 2n;
console.log(`      equity ${formatEther(equity)} USDso, maintenance ${formatEther(mmReq)} -> ${Number(ratioBps) / 10_000}x; demo line ${Number(demoBps) / 10_000}x`);
const m = await pub.readContract({ address: H, abi, functionName: "mandate" });
const mandate = (bps) => ({ expiresAt: m[0], maxLeverageX100: m[1], dailyLossCap: m[2], guardHealthBps: Number(bps), guardReduceBps: m[4], guardSlippageBps: m[5] });
const armed = await tx(`owner sets demo guard line (${Number(demoBps) / 10_000}x)`, owner, "setMandate", [mandate(demoBps)]);

// 4. the next callback must fire the guard on its own
await nextCallback(armed.blockNumber, true);
const sizeAfter = await position();
console.log(`      BTC position ${sizeOpen} -> ${sizeAfter}`);
note("position before/after guard", { before: sizeOpen.toString(), after: sizeAfter.toString() });

// 5. back to the real line, then close the rest
await tx("owner restores guard line (1.5x)", owner, "setMandate", [mandate(15_000n)]);
if (sizeAfter > 0n) await tx("agent closes the rest (reducing IOC)", agent, "place", [await ioc(false, 0, BigInt(sizeAfter))]);
console.log(`      BTC position now ${await position()}`);
