// Halter's AI agent: Claude decides, Halter enforces.
// The agent key can only trade through Halter, so whatever the model proposes
// still has to pass the paddock on chain. Every cycle is logged to agent/runs/.
//
//   node agent/agent.mjs once                 one decision cycle
//   node agent/agent.mjs loop 20              a cycle every 20 minutes
//   node agent/agent.mjs once "note to agent" adds an operator note to the cycle
//
// Needs ANTHROPIC_API_KEY in ~/halter/.env (never committed, never pasted in chat).
import Anthropic from "@anthropic-ai/sdk";
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { decodeEventLog, parseAbi, parseEther, formatEther } from "viem";
import { env, ADDR, pub, owner, agent, wallet, halterArtifact, poolAbi, bankAbi, loadDeployment } from "../scripts/lib.mjs";

const MODEL = "claude-sonnet-5-5";
const MAX_ORDER_USD = 200; // hard ceiling on what the tool layer will even pass to Halter
const MAX_TURNS = 10;
const REASONS = ["None", "Revoked", "Expired", "NotAgent", "PoolNotAllowed", "NotDreamDexPool", "MarketRestricted", "NotionalCap", "LeverageCap", "DailyLossCap", "StaleMark"];

const dep = loadDeployment();
if (!dep.halter) throw new Error("no Halter deployment in deployments/hideki.json");
const H = dep.halter;
const ACCOUNT = dep.owner ?? owner.address; // the dreamDEX account this Halter trades for
const halterAbi = halterArtifact().abi;
const client = env.ANTHROPIC_API_KEY ? new Anthropic({ apiKey: env.ANTHROPIC_API_KEY }) : null;

// Every dreamDEX perp market, read from the factory once per process.
const factoryAbi = parseAbi([
  "function getUnrestrictedPerpPools() view returns (address[])",
  "function getBaseTokenForPool(address) view returns (address)",
]);
const symAbi = parseAbi(["function symbol() view returns (string)"]);
const bookAbi = parseAbi([
  "function getBookLevels(bool isBid, uint64 numLevels) view returns ((uint256 price, uint256 quantity)[])",
  "function getCurrentFundingRate() view returns (int256)",
]);
const posAbi = parseAbi(["function getPosition(address,address) view returns ((int128 size, uint128 avgEntryPrice, int256 entryFundingIndex, uint64 lastUpdatedTimestampNs))"]);
let MARKETS = null; // symbol -> pool
async function markets() {
  if (MARKETS) return MARKETS;
  const pools = await pub.readContract({ address: ADDR.factory, abi: factoryAbi, functionName: "getUnrestrictedPerpPools" });
  const entries = await Promise.all(pools.map(async (p) => {
    const t = await pub.readContract({ address: ADDR.factory, abi: factoryAbi, functionName: "getBaseTokenForPool", args: [p] });
    return [(await pub.readContract({ address: t, abi: symAbi, functionName: "symbol" })).toUpperCase(), p];
  }));
  return (MARKETS = Object.fromEntries(entries));
}

// Mark history the agent can reason over, kept between cycles.
const marksFile = new URL("./data/marks.json", import.meta.url);
mkdirSync(new URL("./data/", import.meta.url), { recursive: true });
const marks = existsSync(marksFile) ? JSON.parse(readFileSync(marksFile, "utf8")) : {};
const usd = (x) => Number(formatEther(x));

// ---------------------------------------------------------------- tools

async function marketInfo(sym) {
  const pool = (await markets())[sym];
  if (!pool) throw new Error(`unknown market ${sym}`);
  const [[ok, mark], oneBase, book, bids, asks, funding] = await Promise.all([
    pub.readContract({ address: pool, abi: poolAbi, functionName: "tryGetMarkPrice" }),
    pub.readContract({ address: pool, abi: poolAbi, functionName: "getOneBase" }),
    pub.readContract({ address: pool, abi: poolAbi, functionName: "getOrderBookParameters" }),
    pub.readContract({ address: pool, abi: bookAbi, functionName: "getBookLevels", args: [true, 3n] }),
    pub.readContract({ address: pool, abi: bookAbi, functionName: "getBookLevels", args: [false, 3n] }),
    pub.readContract({ address: pool, abi: bookAbi, functionName: "getCurrentFundingRate" }).catch(() => null),
  ]);
  return { pool, ok, mark, oneBase, book, bids, asks, funding };
}

async function readPaddock() {
  const m = await pub.readContract({ address: H, abi: halterAbi, functionName: "mandate" });
  const [revoked, count, [equity, imReq, mmReq]] = await Promise.all([
    pub.readContract({ address: H, abi: halterAbi, functionName: "revoked" }),
    pub.readContract({ address: H, abi: halterAbi, functionName: "allowedPoolCount" }),
    pub.readContract({ address: ADDR.marginBank, abi: bankAbi, functionName: "getAccountHealth", args: [ACCOUNT] }),
  ]);
  const bySym = Object.fromEntries(Object.entries(await markets()).map(([s, p]) => [p.toLowerCase(), s]));
  const allowed = [];
  for (let i = 0n; i < count; i++) {
    const pool = await pub.readContract({ address: H, abi: halterAbi, functionName: "allowedPools", args: [i] });
    const cap = await pub.readContract({ address: H, abi: halterAbi, functionName: "poolNotionalCap", args: [pool] });
    if (cap === 0n) continue;
    const pos = await pub.readContract({ address: ADDR.marginBank, abi: posAbi, functionName: "getPosition", args: [ACCOUNT, pool] });
    const info = await marketInfo(bySym[pool.toLowerCase()]);
    const size = BigInt(pos.size);
    const notional = info.ok ? ((size < 0n ? -size : size) * info.mark) / info.oneBase : 0n;
    allowed.push({
      market: bySym[pool.toLowerCase()],
      cap_usd: usd(cap),
      position: size === 0n ? "flat" : `${size > 0n ? "long" : "short"} ${Number(size < 0n ? -size : size) / Number(info.oneBase)}`,
      position_usd: Number(usd(notional).toFixed(2)),
      entry_price: pos.avgEntryPrice > 0n ? Number(usd(pos.avgEntryPrice).toFixed(2)) : null,
    });
  }
  return {
    allowed_markets: allowed,
    other_markets: Object.keys(await markets()).filter((s) => !allowed.some((a) => a.market === s)),
    max_account_leverage: Number(m[1]) / 100,
    daily_loss_cap_usd: usd(m[2]),
    paddock_ends: m[0] ? new Date(Number(m[0]) * 1000).toISOString() : "never",
    guard_line_x_maintenance: Number(m[3]) / 10_000,
    revoked,
    equity_usd: Number(usd(equity).toFixed(2)),
    maintenance_margin_usd: Number(usd(mmReq).toFixed(4)),
    initial_margin_usd: Number(usd(imReq).toFixed(4)),
  };
}

async function readMarket({ market }) {
  const sym = market.toUpperCase();
  const i = await marketInfo(sym);
  const history = (marks[sym] ?? []).slice(-12);
  return {
    market: sym,
    mark_price: i.ok ? usd(i.mark) : "stale",
    best_bid: i.bids[0] ? usd(i.bids[0].price) : null,
    best_ask: i.asks[0] ? usd(i.asks[0].price) : null,
    mid_price: i.bids[0] && i.asks[0] ? Number(((usd(i.bids[0].price) + usd(i.asks[0].price)) / 2).toFixed(4)) : null,
    funding_rate_raw: i.funding?.toString() ?? null,
    min_order_usd: i.ok ? Number(((Number(i.book.minQuantity) / Number(i.oneBase)) * usd(i.mark)).toFixed(2)) : null,
    recent_marks: history.map(([t, p]) => ({ minutes_ago: Math.round((Date.now() - t) / 60000), price: p })),
  };
}

/** Turn a model request into a Halter order. Inputs are untrusted: validate everything. */
async function buildOrder({ market, side, usd_size, order_type }) {
  const sym = String(market).toUpperCase();
  if (!(await markets())[sym]) throw new Error(`${sym} is not a dreamDEX perp market`);
  if (!["buy", "sell"].includes(side)) throw new Error("side must be buy or sell");
  if (!(usd_size > 0 && usd_size <= MAX_ORDER_USD)) throw new Error(`usd_size must be between 0 and ${MAX_ORDER_USD}`);
  if (!["market", "limit_at_touch"].includes(order_type)) throw new Error("order_type must be market or limit_at_touch");
  const i = await marketInfo(sym);
  if (!i.ok) throw new Error(`${sym} mark price is stale; try later`);
  const isBid = side === "buy";
  let qty = (parseEther(String(usd_size)) * i.oneBase) / i.mark;
  qty = (qty / i.book.lotSize) * i.book.lotSize;
  if (qty < i.book.minQuantity) qty = i.book.minQuantity;
  const tick = i.book.tickSize;
  // market = IOC with 1% room; limit_at_touch = rests at the best price on our side
  const raw = order_type === "market"
    ? (isBid ? (i.mark * 101n) / 100n : (i.mark * 99n) / 100n)
    : (isBid ? (i.bids[0]?.price ?? i.mark) : (i.asks[0]?.price ?? i.mark));
  const price = isBid ? (raw / tick) * tick : ((raw + tick - 1n) / tick) * tick;
  return { sym, order: { pool: i.pool, isBid, price, quantity: qty, orderType: order_type === "market" ? 2 : 0 }, oneBase: i.oneBase };
}

async function previewOrder(input) {
  const { sym, order, oneBase } = await buildOrder(input);
  const { result } = await pub.simulateContract({ account: agent, address: H, abi: halterAbi, functionName: "check", args: [agent.address, order] });
  const reason = REASONS[Number(result[0])];
  return { market: sym, quantity: Number(order.quantity) / Number(oneBase), price: usd(order.price), halter_says: reason === "None" ? "allowed" : `blocked: ${reason}`, reducing: result[1] };
}

async function placeOrder(input, log) {
  const { sym, order, oneBase } = await buildOrder(input);
  return sendOrder(sym, order, oneBase, input, log);
}

async function sendOrder(sym, order, oneBase, input, log) {
  const { request } = await pub.simulateContract({ account: agent, address: H, abi: halterAbi, functionName: "place", args: [order] });
  const hash = await wallet(agent).writeContract(request);
  const r = await pub.waitForTransactionReceipt({ hash });
  const evs = r.logs.filter((l) => l.address.toLowerCase() === H.toLowerCase()).map((l) => decodeEventLog({ abi: halterAbi, data: l.data, topics: l.topics }));
  const blocked = evs.find((e) => e.eventName === "OrderBlocked");
  const out = blocked
    ? { result: "blocked on chain by Halter", reason: REASONS[Number(blocked.args.reason)], tx: hash }
    : { result: "placed", order_id: evs.find((e) => e.eventName === "OrderAllowed")?.args.orderId.toString(), market: sym, quantity: Number(order.quantity) / Number(oneBase), price: usd(order.price), tx: hash };
  log.orders.push({ input, ...out });
  return out;
}

async function closePosition({ market }, log) {
  const sym = String(market).toUpperCase();
  const i = await marketInfo(sym);
  const pos = await pub.readContract({ address: ADDR.marginBank, abi: posAbi, functionName: "getPosition", args: [ACCOUNT, i.pool] });
  const size = BigInt(pos.size);
  if (size === 0n) return { result: "no position to close" };
  if (!i.ok) throw new Error(`${sym} mark price is stale; try later`);
  // Exactly the position size, so Halter sees a pure reduce and never a flip.
  const isBid = size < 0n;
  const raw = isBid ? (i.mark * 101n) / 100n : (i.mark * 99n) / 100n;
  const tick = i.book.tickSize;
  const order = { pool: i.pool, isBid, price: isBid ? (raw / tick) * tick : ((raw + tick - 1n) / tick) * tick, quantity: isBid ? -size : size, orderType: 2 };
  return sendOrder(sym, order, i.oneBase, { market: sym, close: true }, log);
}

const strict = (name, description, properties, required) => ({
  name, description, strict: true,
  input_schema: { type: "object", properties, required, additionalProperties: false },
});
const ORDER_PROPS = {
  market: { type: "string", description: "Market symbol, e.g. BTC" },
  side: { type: "string", enum: ["buy", "sell"] },
  usd_size: { type: "number", description: "Order size in USD notional" },
  order_type: { type: "string", enum: ["market", "limit_at_touch"], description: "market fills now (IOC); limit_at_touch rests at the best price on your side" },
};
const tools = [
  strict("read_paddock", "Read the limits you trade inside (allowed markets with caps and current positions, leverage cap, daily loss cap, guard line, equity) from chain. Call this first every cycle.", {}, []),
  strict("read_market", "Read one market: mark price, best bid/ask, funding, the minimum order in USD, and marks recorded in earlier cycles.", { market: ORDER_PROPS.market }, ["market"]),
  strict("preview_order", "Ask Halter on chain whether an order would be allowed, without sending it.", ORDER_PROPS, ["market", "side", "usd_size", "order_type"]),
  strict("place_order", "Send an order through Halter. Halter checks it against the paddock on chain; a blocked order is recorded with its reason and nothing is traded.", ORDER_PROPS, ["market", "side", "usd_size", "order_type"]),
  strict("close_position", "Close the whole position in one market with a reducing market order through Halter.", { market: ORDER_PROPS.market }, ["market"]),
];

const SYSTEM = `You trade a dreamDEX perpetual futures account on Somnia's Hideki testnet (paper USDso, no real money).
You never hold the account's keys. Every order goes through Halter, a contract that enforces the owner's paddock on chain: allowed markets, a notional cap per market, an account leverage cap, a daily loss cap, and an end date. Orders outside the paddock are refused on chain and recorded.

Your strategy (small, rule-based, explainable):
- Use read_market's recent_marks (one sample per cycle, newest last) and mid_price. A trend is "up" when the last 3 samples each rise and the latest mid is above the oldest of them; "down" is the mirror; anything else is "flat".
- No position and a clear up or down trend: open one position in that direction for 15 to 25 USD with a market order. At most one new position per cycle, and never more than the paddock allows.
- Holding a position: close it with close_position when it is about +1% in profit or -1% in loss against entry_price (use mid_price), or when the trend has turned against it.
- Fewer than 3 recorded samples, or a flat trend: do nothing and say what you are waiting for.
- On this testnet the order book usually sits a few tenths of a percent away from the mark price. That gap is normal here; judge entries and exits on mid_price, not on the gap.

Each cycle:
1. Call read_paddock, then read_market for BTC and ETH.
2. Apply the strategy. Preview before you place. Respect the paddock; if the operator asks for something outside it, explain that Halter will refuse it rather than looking for a way around.
3. Finish with a short plain summary: what you saw, what you did, and why.`;

// Hideki sometimes answers a read with a transient error whose "data" is null, which
// viem then fails to format. Reads are safe to retry; orders are never retried here,
// because a retry could send a second transaction.
const READS = new Set(["read_paddock", "read_market", "preview_order"]);
async function runTool(name, input, log) {
  if (!READS.has(name)) return runToolOnce(name, input, log);
  for (let attempt = 1; ; attempt++) {
    try { return await runToolOnce(name, input, log); }
    catch (e) {
      if (attempt >= 3) throw e;
      log.retries = (log.retries ?? 0) + 1;
      const lines = (x) => String(x ?? "").split(/\r?\n/);
      log.retryErrors = [...(log.retryErrors ?? []), { tool: name, attempt, error: lines(e.message)[0], at: lines(e.stack).slice(1, 3).join(" | ") }];
      await new Promise((r) => setTimeout(r, 400 * attempt));
    }
  }
}

async function runToolOnce(name, input, log) {
  switch (name) {
    case "read_paddock": return readPaddock();
    case "read_market": return readMarket(input);
    case "preview_order": return previewOrder(input);
    case "place_order": return placeOrder(input, log);
    case "close_position": return closePosition(input, log);
    default: throw new Error(`unknown tool ${name}`);
  }
}

async function cycle(note) {
  if (!client) throw new Error("add ANTHROPIC_API_KEY to ~/halter/.env");
  // record marks for the allowed markets so later cycles see a trend
  for (const sym of ["BTC", "ETH"]) {
    const i = await marketInfo(sym).catch(() => null);
    const mid = i?.bids[0] && i?.asks[0] ? (usd(i.bids[0].price) + usd(i.asks[0].price)) / 2 : i?.ok ? usd(i.mark) : null;
    if (mid !== null) (marks[sym] ??= []).push([Date.now(), Number(mid.toFixed(4))]), (marks[sym] = marks[sym].slice(-48));
  }
  writeFileSync(marksFile, JSON.stringify(marks));

  const started = new Date();
  const log = { started: started.toISOString(), model: MODEL, halter: H, note: note ?? null, steps: [], orders: [], usage: { input: 0, output: 0 } };
  const messages = [{ role: "user", content: `Decision cycle at ${started.toISOString()}.${note ? `\nOperator note: ${note}` : ""}` }];

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const res = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      system: SYSTEM,
      tools,
      messages,
      output_config: { effort: "medium" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });
    log.usage.input += res.usage.input_tokens;
    log.usage.output += res.usage.output_tokens;
    if (res.stop_reason === "refusal") { log.steps.push({ refusal: res.stop_details ?? null }); break; }
    for (const b of res.content) if (b.type === "text" && b.text.trim()) log.steps.push({ say: b.text.trim() });
    if (res.stop_reason !== "tool_use") break;

    messages.push({ role: "assistant", content: res.content });
    const results = [];
    for (const b of res.content.filter((x) => x.type === "tool_use")) {
      let content, is_error = false;
      try { content = JSON.stringify(await runTool(b.name, b.input, log)); }
      catch (e) { content = String(e.shortMessage ?? e.message).split("\n")[0]; is_error = true; }
      log.steps.push({ tool: b.name, input: b.input, ...(is_error ? { error: content } : { result: JSON.parse(content) }) });
      results.push({ type: "tool_result", tool_use_id: b.id, content, ...(is_error ? { is_error } : {}) });
    }
    messages.push({ role: "user", content: results });
  }

  log.finished = new Date().toISOString();
  log.cost_usd = Number(((log.usage.input * 2 + log.usage.output * 10) / 1e6).toFixed(4));
  const dir = new URL("./runs/", import.meta.url);
  mkdirSync(dir, { recursive: true });
  writeFileSync(new URL(`${started.toISOString().replace(/[:.]/g, "-")}.json`, dir), JSON.stringify(log, (k, v) => (typeof v === "bigint" ? v.toString() : v), 2));

  for (const s of log.steps) {
    if (s.say) console.log(`\n${s.say}`);
    if (s.tool) console.log(`  - ${s.tool}(${JSON.stringify(s.input)})${s.error ? ` FAILED ${s.error}` : s.tool === "place_order" || s.tool === "close_position" ? ` => ${JSON.stringify(s.result)}` : ""}`);
    if (s.refusal) console.log(`  refused: ${JSON.stringify(s.refusal)}`);
  }
  await pushRuns();
  console.log(`\n  ${log.orders.length} order(s), ${log.usage.input} in / ${log.usage.output} out tokens, ~$${log.cost_usd}`);
}

// Send recent cycles to the hosted app, if one is configured. Failures never stop trading.
async function pushRuns() {
  if (!env.HALTER_INGEST_URL || !env.HALTER_INGEST_TOKEN) return;
  try {
    const dir = new URL("./runs/", import.meta.url);
    const files = readdirSync(dir).filter((f) => f.endsWith(".json")).sort().slice(-60);
    const runs = files.map((f) => JSON.parse(readFileSync(new URL(f, dir), "utf8")));
    const r = await fetch(env.HALTER_INGEST_URL, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${env.HALTER_INGEST_TOKEN}` },
      body: JSON.stringify(runs),
    });
    if (!r.ok) console.error(`push to app failed: ${r.status}`);
  } catch (e) {
    console.error("push to app failed:", e.message);
  }
}

const [mode = "once", arg] = process.argv.slice(2);
if (mode === "check") {
  // Tool layer only: chain reads and eth_call previews. No model call, no transaction.
  const show = (k, v) => console.log(`${k}:`, JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x)));
  show("read_paddock", await readPaddock());
  show("read_market BTC", await readMarket({ market: "BTC" }));
  show("preview BTC buy $20", await previewOrder({ market: "BTC", side: "buy", usd_size: 20, order_type: "market" }));
  show("preview BTC buy $90", await previewOrder({ market: "BTC", side: "buy", usd_size: 90, order_type: "market" }));
  show("preview SOL buy $20", await previewOrder({ market: "SOL", side: "buy", usd_size: 20, order_type: "market" }));
  for (const bad of [{ market: "DOGECOIN", side: "buy", usd_size: 10, order_type: "market" }, { market: "BTC", side: "buy", usd_size: 5000, order_type: "market" }]) {
    try { await previewOrder(bad); console.log("!! accepted", bad); } catch (e) { console.log("rejected input:", e.message); }
  }
} else if (mode === "loop") {
  const every = Math.max(5, Number(arg ?? 20));
  console.log(`agent: a cycle every ${every} min, Halter ${H}`);
  for (;;) {
    try { await cycle(); } catch (e) { console.error("cycle failed:", e.message); }
    await new Promise((r) => setTimeout(r, every * 60_000));
  }
} else {
  // "@name" loads agent/notes/name.txt, so notes never pass through shell quoting.
  const note = arg?.startsWith("@") ? readFileSync(new URL(`./notes/${arg.slice(1).replace(/[^\w-]/g, "")}.txt`, import.meta.url), "utf8").trim() : arg;
  await cycle(mode === "once" ? note : undefined);
}
