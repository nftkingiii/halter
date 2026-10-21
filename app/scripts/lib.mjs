// Shared setup for Halter's testnet scripts. Reads ~/halter/.env (never committed).
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { createPublicClient, createWalletClient, http, defineChain, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const root = new URL("../../", import.meta.url);

export const env = Object.fromEntries(
  readFileSync(new URL(".env", root), "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]),
);

export const hideki = defineChain({
  id: 50383,
  name: "Somnia Hideki 2",
  nativeCurrency: { name: "STT", symbol: "STT", decimals: 18 },
  // RPC_OVERRIDE points the scripts at a local anvil fork for a dry run.
  rpcUrls: { default: { http: [process.env.RPC_OVERRIDE ?? env.RPC_URL] } },
  blockExplorers: { default: { name: "Somnia", url: "https://explorer.testnet.somnia.network/tokyo" } },
});

export const ADDR = {
  factory: "0xE631fAEE547baeE07353E290f0562ea67d856560",
  marginBank: "0x478769E1177C0773c43A593DCCc4Ad15F15F1394",
  usdso: "0xed7993A74dAe1e6656B704A424DcD8711aAf4F72",
  registry: "0x6B2FbfeD328FF5F20C0BE7D3C3437613aFFE8D3a",
};

export const POOLS = {
  BTC: "0x4181dd08E73BbCdd1Ba3E615A18f6abD941b94C0",
  ETH: "0xD6Cb1DD58580B84D76068aC21594219ce03aeddf",
  SOL: "0xB483ec1fb34996638677c20ab087b16F1896FA53",
};

export const SEL = { placeOrderFor: "0x80054449", cancelOrderFor: "0xe37b444b", reduceOrderFor: "0x364c2587" };

export const pub = createPublicClient({ chain: hideki, transport: http() });
export const owner = privateKeyToAccount(env.OWNER_PK);
export const agent = privateKeyToAccount(env.AGENT_PK);
export const wallet = (account) => createWalletClient({ account, chain: hideki, transport: http() });

export const halterArtifact = () =>
  JSON.parse(readFileSync(new URL("contracts/out/Halter.sol/Halter.json", root), "utf8"));

export const erc20Abi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
]);
export const bankAbi = parseAbi([
  "function deposit(uint256 amount)",
  "function getAccountEquity(address) view returns (int256)",
  "function getAccountHealth(address) view returns (int256 equity, uint256 imReq, uint256 mmReq, uint256 cmReq)",
]);
export const registryAbi = parseAbi([
  "function setOperatorApprovalGlobal(address operator, bytes4[] selectors, bool approved)",
]);
export const poolAbi = parseAbi([
  "function isOperatorAuthorized(address owner, address operator, bytes4 selector) view returns (bool)",
  "function tryGetMarkPrice() view returns (bool ok, uint256 price)",
  "function getOneBase() view returns (uint256)",
  "function getOrderBookParameters() view returns ((uint256 tickSize, uint256 minQuantity, uint256 lotSize))",
]);

// ---- deployment record (public: addresses and tx hashes only) ----
// DEPLOY=arena -> deployments/hideki-arena.json (Halter for an app wallet, managed by the admin key)
const depName = process.env.RPC_OVERRIDE ? "dryrun" : process.env.DEPLOY ? `hideki-${process.env.DEPLOY.replace(/[^\w-]/g, "")}` : "hideki";
const depFile = new URL(`deployments/${depName}.json`, root);
export function loadDeployment() {
  return existsSync(depFile) ? JSON.parse(readFileSync(depFile, "utf8")) : { chainId: 50383, txs: [] };
}
export function saveDeployment(d) {
  mkdirSync(new URL("deployments/", root), { recursive: true });
  writeFileSync(depFile, JSON.stringify(d, null, 2) + "\n");
}

/** Simulate, send, wait, record. Throws on a reverted receipt. */
export async function send(dep, label, account, req) {
  const { request } = await pub.simulateContract({ account, ...req });
  const hash = await wallet(account).writeContract(request);
  const r = await pub.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error(`${label} reverted: ${hash}`);
  dep.txs.push({ label, hash, block: Number(r.blockNumber), from: account.address });
  saveDeployment(dep);
  console.log(`  ok  ${label.padEnd(34)} ${hash}`);
  return r;
}
