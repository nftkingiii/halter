// Deploy Halter on Hideki and set up the owner's mandate.
//   node scripts/setup-halter.mjs status   read-only
//   node scripts/setup-halter.mjs deploy   agent key deploys Halter (owner = OWNER_ADDR)
//   node scripts/setup-halter.mjs setup    owner: deposit margin, link Halter, set pools, mandate, agent
import { formatEther, parseEther } from "viem";
import {
  ADDR, POOLS, SEL, pub, owner, agent, wallet, halterArtifact, erc20Abi, bankAbi, registryAbi, poolAbi,
  loadDeployment, saveDeployment, send,
} from "./lib.mjs";

const dep = loadDeployment();
const mode = process.argv[2] ?? "status";
const art = halterArtifact();
const halterAbi = art.abi;

async function status() {
  const stt = async (a) => formatEther(await pub.getBalance({ address: a }));
  const usd = formatEther(await pub.readContract({ address: ADDR.usdso, abi: erc20Abi, functionName: "balanceOf", args: [owner.address] }));
  const eq = formatEther(await pub.readContract({ address: ADDR.marginBank, abi: bankAbi, functionName: "getAccountEquity", args: [owner.address] }));
  console.log(`owner ${owner.address}  STT ${await stt(owner.address)}  wallet USDso ${usd}  perps equity ${eq}`);
  console.log(`agent ${agent.address}  STT ${await stt(agent.address)}`);
  if (!dep.halter) return console.log("halter: not deployed");
  console.log(`halter ${dep.halter}`);
  for (const [sym, pool] of Object.entries(POOLS)) {
    const linked = await pub.readContract({ address: pool, abi: poolAbi, functionName: "isOperatorAuthorized", args: [owner.address, dep.halter, SEL.placeOrderFor] });
    const cap = await pub.readContract({ address: dep.halter, abi: halterAbi, functionName: "poolNotionalCap", args: [pool] });
    console.log(`  ${sym.padEnd(4)} linked=${linked}  cap=$${formatEther(cap)}`);
  }
  const m = await pub.readContract({ address: dep.halter, abi: halterAbi, functionName: "mandate" });
  const isAgent = await pub.readContract({ address: dep.halter, abi: halterAbi, functionName: "isAgent", args: [agent.address] });
  console.log(`  mandate ${JSON.stringify(m, (k, v) => (typeof v === "bigint" ? v.toString() : v))}  agent=${isAgent}`);
}

if (mode === "deploy") {
  if (dep.halter) throw new Error(`already deployed at ${dep.halter}`);
  const hash = await wallet(agent).deployContract({
    abi: halterAbi,
    bytecode: art.bytecode.object,
    args: [owner.address, ADDR.factory, ADDR.marginBank],
  });
  const r = await pub.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error(`deploy reverted: ${hash}`);
  Object.assign(dep, { halter: r.contractAddress, owner: owner.address, agent: agent.address, deployTx: hash, deployBlock: Number(r.blockNumber) });
  dep.txs.push({ label: "deploy Halter", hash, block: Number(r.blockNumber), from: agent.address });
  saveDeployment(dep);
  console.log(`  ok  deploy Halter at ${r.contractAddress}  ${hash}`);
}

if (mode === "setup") {
  if (!dep.halter) throw new Error("deploy first");
  const H = dep.halter;
  const margin = await pub.readContract({ address: ADDR.usdso, abi: erc20Abi, functionName: "balanceOf", args: [owner.address] });
  if (margin > 0n) {
    const allowance = await pub.readContract({ address: ADDR.usdso, abi: erc20Abi, functionName: "allowance", args: [owner.address, ADDR.marginBank] });
    if (allowance < margin) await send(dep, "approve USDso to MarginBank", owner, { address: ADDR.usdso, abi: erc20Abi, functionName: "approve", args: [ADDR.marginBank, margin] });
    await send(dep, `deposit ${formatEther(margin)} USDso margin`, owner, { address: ADDR.marginBank, abi: bankAbi, functionName: "deposit", args: [margin] });
  }
  await send(dep, "link Halter as operator", owner, {
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

await status();
