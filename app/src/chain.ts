// Live state, read straight from Hideki in the browser. No server in this path.
import { createPublicClient, defineChain, http, parseAbi } from "viem";
import halterAbi from "./abi/halter.json";
import { RPC_URL, MARGIN_BANK, OWNER, AGENT, CURRENT } from "./config";

export const hideki = defineChain({
  id: 50383,
  name: "Somnia Hideki",
  nativeCurrency: { name: "STT", symbol: "STT", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
});
export const client = createPublicClient({ chain: hideki, transport: http(RPC_URL, { batch: true }) });

const bankAbi = parseAbi([
  "function getAccountHealth(address) view returns (int256 equity, uint256 imReq, uint256 mmReq, uint256 cmReq)",
  "function getPosition(address account, address perpPool) view returns ((int128 size, uint128 avgEntryPrice, int256 entryFundingIndex, uint64 lastUpdatedTimestampNs))",
]);
const poolAbi = parseAbi([
  "function tryGetMarkPrice() view returns (bool ok, uint256 price)",
  "function getOneBase() view returns (uint256)",
]);
const H = { address: CURRENT.address, abi: halterAbi } as const;

export type Mandate = {
  expiresAt: number;
  maxLeverageX100: number;
  dailyLossCap: bigint;
  guardHealthBps: number;
  guardReduceBps: number;
  guardSlippageBps: number;
};
export type Market = { pool: `0x${string}`; cap: bigint; size: bigint; mark: bigint | null; oneBase: bigint; entry: bigint };
export type LiveState = {
  mandate: Mandate;
  revoked: boolean;
  agentAllowed: boolean;
  markets: Market[];
  equity: bigint;
  mmReq: bigint;
  imReq: bigint;
  readAt: number;
  block: bigint;
};

export async function readLive(): Promise<LiveState> {
  const [m, revoked, agentAllowed, count, health, block] = await Promise.all([
    client.readContract({ ...H, functionName: "mandate" }) as Promise<readonly [bigint, number, bigint, number, number, number]>,
    client.readContract({ ...H, functionName: "revoked" }) as Promise<boolean>,
    client.readContract({ ...H, functionName: "isAgent", args: [AGENT] }) as Promise<boolean>,
    client.readContract({ ...H, functionName: "allowedPoolCount" }) as Promise<bigint>,
    client.readContract({ address: MARGIN_BANK, abi: bankAbi, functionName: "getAccountHealth", args: [OWNER] }),
    client.getBlockNumber(),
  ]);
  const pools = await Promise.all(
    Array.from({ length: Number(count) }, (_, i) =>
      client.readContract({ ...H, functionName: "allowedPools", args: [BigInt(i)] }) as Promise<`0x${string}`>,
    ),
  );
  const markets = await Promise.all(
    pools.map(async (pool): Promise<Market> => {
      const [cap, pos, mark, oneBase] = await Promise.all([
        client.readContract({ ...H, functionName: "poolNotionalCap", args: [pool] }) as Promise<bigint>,
        client.readContract({ address: MARGIN_BANK, abi: bankAbi, functionName: "getPosition", args: [OWNER, pool] }),
        client.readContract({ address: pool, abi: poolAbi, functionName: "tryGetMarkPrice" }),
        client.readContract({ address: pool, abi: poolAbi, functionName: "getOneBase" }),
      ]);
      return { pool, cap, size: BigInt(pos.size), entry: BigInt(pos.avgEntryPrice), mark: mark[0] ? mark[1] : null, oneBase };
    }),
  );
  const [equity, imReq, mmReq] = health;
  return {
    mandate: {
      expiresAt: Number(m[0]),
      maxLeverageX100: Number(m[1]),
      dailyLossCap: m[2],
      guardHealthBps: Number(m[3]),
      guardReduceBps: Number(m[4]),
      guardSlippageBps: Number(m[5]),
    },
    revoked,
    agentAllowed,
    markets: markets.filter((x) => x.cap > 0n),
    equity,
    mmReq,
    imReq,
    readAt: Date.now(),
    block,
  };
}

// ---- number formatting (USDso and prices are 18 decimals) ----
export const usd = (x: bigint, dp = 2) => {
  const neg = x < 0n;
  const v = Number(neg ? -x : x) / 1e18;
  return `${neg ? "−" : ""}$${v.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;
};
export const notional = (size: bigint, mark: bigint, oneBase: bigint) => ((size < 0n ? -size : size) * mark) / oneBase;
export const baseAmount = (q: bigint, oneBase: bigint) => {
  const v = Number(q) / Number(oneBase);
  return v.toLocaleString("en-US", { maximumSignificantDigits: 4 });
};
