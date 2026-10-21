// Testnet funding for Halter's two dev keys (run on the VM, reads ~/halter/.env).
//   node tools/fund-testnet.mjs bridge   -> 45 STT Shannon -> Hideki (owner to owner)
//   node tools/fund-testnet.mjs agent    -> 5 STT on Hideki (owner -> agent)
//   node tools/fund-testnet.mjs status   -> balances only, sends nothing
//   node tools/fund-testnet.mjs gas 0xADDR 2 -> up to 5 STT of Hideki gas to one address (never USDso)
import { readFileSync } from "node:fs";
import { createPublicClient, createWalletClient, http, parseEther, pad, defineChain, formatEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const env = Object.fromEntries(
  readFileSync(new URL("../.env", import.meta.url), "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]),
);

const shannon = defineChain({ id: 50312, name: "Somnia Shannon", nativeCurrency: { name: "STT", symbol: "STT", decimals: 18 }, rpcUrls: { default: { http: ["https://dream-rpc.somnia.network"] } } });
const hideki = defineChain({ id: 50383, name: "Somnia Hideki 2", nativeCurrency: { name: "STT", symbol: "STT", decimals: 18 }, rpcUrls: { default: { http: [env.RPC_URL] } } });

// Hyperlane STT route, Somnia Testnet <-> Hideki2 (markets-sdk 0.32.1 chains/bridge/registry.js)
const STT_ROUTER_SHANNON = "0x67CD0778A719099DAF2D346aD0Db0d9E6FF6674C";
const routerAbi = [
  { type: "function", name: "transferRemote", stateMutability: "payable", inputs: [{ name: "destination", type: "uint32" }, { name: "recipient", type: "bytes32" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bytes32" }] },
  { type: "function", name: "quoteGasPayment", stateMutability: "view", inputs: [{ type: "uint32" }], outputs: [{ type: "uint256" }] },
];

const owner = privateKeyToAccount(env.OWNER_PK);
const agent = env.AGENT_ADDR;
const pubS = createPublicClient({ chain: shannon, transport: http() });
const pubH = createPublicClient({ chain: hideki, transport: http() });

async function status() {
  const f = async (c, a) => formatEther(await c.getBalance({ address: a }));
  console.log(`owner ${owner.address}  shannon ${await f(pubS, owner.address)} STT  hideki ${await f(pubH, owner.address)} STT`);
  console.log(`agent ${agent}  hideki ${await f(pubH, agent)} STT`);
}

const mode = process.argv[2] ?? "status";
await status();

if (mode === "bridge") {
  const amount = parseEther("45");
  const fee = await pubS.readContract({ address: STT_ROUTER_SHANNON, abi: routerAbi, functionName: "quoteGasPayment", args: [50383] });
  const { request } = await pubS.simulateContract({ account: owner, address: STT_ROUTER_SHANNON, abi: routerAbi, functionName: "transferRemote", args: [50383, pad(owner.address, { size: 32 }), amount], value: amount + fee });
  const hash = await createWalletClient({ account: owner, chain: shannon, transport: http() }).writeContract(request);
  const r = await pubS.waitForTransactionReceipt({ hash });
  console.log(`bridge tx ${hash} status ${r.status} block ${r.blockNumber}  (delivery to Hideki follows in seconds)`);
} else if (mode === "agent") {
  const hash = await createWalletClient({ account: owner, chain: hideki, transport: http() }).sendTransaction({ to: agent, value: parseEther("5") });
  const r = await pubH.waitForTransactionReceipt({ hash });
  console.log(`agent funding tx ${hash} status ${r.status} block ${r.blockNumber}`);
} else if (mode === "gas") {
  const [to, amt] = process.argv.slice(3);
  if (!/^0x[0-9a-fA-F]{40}$/.test(to ?? "")) throw new Error("usage: gas 0xADDRESS AMOUNT");
  const amount = Number(amt ?? 2);
  if (!(amount > 0 && amount <= 5)) throw new Error("amount must be between 0 and 5 STT");
  const before = formatEther(await pubH.getBalance({ address: to }));
  const hash = await createWalletClient({ account: owner, chain: hideki, transport: http() }).sendTransaction({ to, value: parseEther(String(amount)) });
  const r = await pubH.waitForTransactionReceipt({ hash });
  console.log(`gas tx ${hash} status ${r.status} block ${r.blockNumber}`);
  console.log(`${to} Hideki STT ${before} -> ${formatEther(await pubH.getBalance({ address: to }))}`);
}
if (mode !== "status") await status();
