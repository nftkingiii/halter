// Everything the app reads comes from these addresses on Somnia Hideki testnet.
export const RPC_URL = "https://api.hideki2.infra.testnet.somnia.network";
export const EXPLORER = "https://explorer.testnet.somnia.network/tokyo";

export type HalterDeployment = { version: "v1" | "v2"; address: `0x${string}`; deployBlock: number; current: boolean };

export const HALTERS: HalterDeployment[] = [
  { version: "v2", address: "0xc904a9ac96bfda2989ead531bc57fd8d5ee56b06", deployBlock: 29119837, current: true },
  { version: "v1", address: "0x24bd6b71f27c7aad65fb9842c6181b65b571a833", deployBlock: 29099189, current: false },
];
export const CURRENT = HALTERS.find((h) => h.current)!;
export const SUBSCRIPTION_ID = "14557199";

export const OWNER = "0xa7770b44A07f3a931Cb30Ae2601a52d01f16b580" as const;
export const AGENT = "0xFB3f3e9f86aeEDbC68dc0d4fa26eA7896c37800B" as const;
export const MARGIN_BANK = "0x478769E1177C0773c43A593DCCc4Ad15F15F1394" as const;
export const FACTORY = "0xE631fAEE547baeE07353E290f0562ea67d856560" as const;
export const PRECOMPILE = "0x0000000000000000000000000000000000000100" as const;

/** Every dreamDEX perp market the account's operator link covers (factory order). */
export const MARKETS: Record<string, string> = {
  "0x4181dd08e73bbcdd1ba3e615a18f6abd941b94c0": "BTC",
  "0xd6cb1dd58580b84d76068ac21594219ce03aeddf": "ETH",
  "0xb483ec1fb34996638677c20ab087b16f1896fa53": "SOL",
  "0x63b47ed4a7de0fde659b0d82441dd74828b7297a": "HYPE",
  "0x7058579f3248559963f79adb937c6de9f953e060": "XRP",
  "0xc410012e39765cd5f772e84bacb19554aec040df": "DOGE",
  "0x3d2a99fe1e2bdeaa25024515a2d2202daf9531ad": "BNB",
  "0x34fa62909f77699a7a6278d992f72ff31c7a619d": "ADA",
  "0x1be21287cfb865a7c462ff3c4f275e70bcccefe4": "SUI",
  "0xf71b619450bafe953f47b9b556416a3a67b443b5": "LINK",
  "0xde9762b6b441133d1314c68864ae4e63a6ee45c7": "AVAX",
  "0x74b05b9b8c8f180b53b7891018f3b254b3e658c9": "XLM",
  "0x1cd15ae8bff0fe0a7f49233be8b90734775ba454": "NEAR",
  "0x0f464d57c1fd839e4d87a408bbccdab8f77e6394": "WLD",
  "0xd9b6a347a3ae9fd6ba21179d3343f2c8a922f697": "TAO",
  "0x2a73129f26917124bd2a47a9b355c395c537f050": "ZEC",
  "0x76c981a52530cdf9497559140aafcd8cd16836e7": "PUMP",
  "0xfa9b9e50cc1745113d57893991af200a74c86b6f": "1000PEPE",
  "0x352636ab146039851ef06d6367a106d5fb4e6409": "VVV",
  "0xdcb0ad226727b2ce92857f0af5751389d42b2a3f": "LIT",
  "0x2a1822b02039ddf0e293f3f7243673fc03eaf16c": "ZRO",
};
export const marketOf = (pool: string) => MARKETS[pool.toLowerCase()] ?? `${pool.slice(0, 6)}…`;

/** A guard line above 10x maintenance is not a real risk setting; label it. */
export const DEMO_GUARD_BPS = 100_000;

export const short = (a: string, n = 4) => `${a.slice(0, 2 + n)}…${a.slice(-n)}`;
export const who = (a: string) => {
  const l = a.toLowerCase();
  if (l === OWNER.toLowerCase()) return "Owner";
  if (l === AGENT.toLowerCase()) return "Agent key";
  if (l === PRECOMPILE) return "Somnia Reactivity";
  return short(a);
};

/** Base-unit scale per market (getOneBase, read 2026-10-21). */
export const ONE_BASE: Record<string, bigint> = {
  BTC: 10n ** 8n, ETH: 10n ** 18n, SOL: 10n ** 9n, HYPE: 10n ** 6n, XRP: 10n ** 6n, DOGE: 10n ** 8n, BNB: 10n ** 18n,
  ADA: 10n ** 6n, SUI: 10n ** 9n, LINK: 10n ** 18n, AVAX: 10n ** 18n, XLM: 10n ** 7n, NEAR: 10n ** 24n, WLD: 10n ** 18n,
  TAO: 10n ** 9n, ZEC: 10n ** 8n, PUMP: 10n ** 6n, "1000PEPE": 10n ** 18n, VVV: 10n ** 18n, LIT: 10n ** 18n, ZRO: 10n ** 18n,
};

export const REASONS = [
  "None", "Revoked", "Expired", "NotAgent", "PoolNotAllowed", "NotDreamDexPool",
  "MarketRestricted", "NotionalCap", "LeverageCap", "DailyLossCap", "StaleMark",
] as const;
export const REASON_TEXT: Record<string, string> = {
  Revoked: "the owner revoked every agent",
  Expired: "the paddock had ended",
  NotAgent: "the caller is not an allowed agent",
  PoolNotAllowed: "this market is outside the paddock",
  NotDreamDexPool: "the pool is not a dreamDEX market",
  MarketRestricted: "the market is close-only",
  NotionalCap: "it would exceed the market's notional cap",
  LeverageCap: "it would exceed the leverage cap",
  DailyLossCap: "today's loss cap is used up",
  StaleMark: "the mark price was stale",
};
