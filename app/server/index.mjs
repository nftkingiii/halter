// Halter activity service: tails Halter's own event logs from Hideki and serves
// them, plus the built app. Hideki caps eth_getLogs at 1,000 blocks (~100 s), so
// history needs a cache; live state is still read from chain in the browser.
//   PORT=8787 node server/index.mjs
import http from "node:http";
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, http as viemHttp, decodeEventLog } from "viem";

const here = fileURLToPath(new URL(".", import.meta.url));
const RPC = process.env.RPC_URL ?? "https://api.hideki2.infra.testnet.somnia.network";
const PORT = Number(process.env.PORT ?? 8787);
// Local runs stay on this machine; a host like Railway sets HOST=0.0.0.0.
const HOST = process.env.HOST ?? "127.0.0.1";
const DATA = process.env.DATA_DIR ?? join(here, "data");
const DIST = join(here, "..", "dist");
const STEP = 1000n; // node limit
const CONCURRENCY = 8;

const HALTERS = [
  { version: "v2", address: "0xc904a9ac96bfda2989ead531bc57fd8d5ee56b06", deployBlock: 29119837n },
  { version: "v1", address: "0x24bd6b71f27c7aad65fb9842c6181b65b571a833", deployBlock: 29099189n },
];
const abi = JSON.parse(readFileSync(join(here, "..", "src", "abi", "halter.json"), "utf8"));
const client = createPublicClient({ transport: viemHttp(RPC, { retryCount: 4, retryDelay: 400 }) });

// ---- state, persisted so a restart doesn't rescan from the deploy block ----
mkdirSync(DATA, { recursive: true });
const file = join(DATA, "events.json");
const state = existsSync(file)
  ? JSON.parse(readFileSync(file, "utf8"))
  : { scanned: Object.fromEntries(HALTERS.map((h) => [h.address, String(h.deployBlock - 1n)])), events: [] };
const seen = new Set(state.events.map((e) => `${e.tx}:${e.logIndex}`));
const blockTime = new Map();
let head = 0n;
let lastError = null;

const jsonSafe = (v) => JSON.parse(JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x)));

async function timeOf(n) {
  if (!blockTime.has(n)) blockTime.set(n, Number((await client.getBlock({ blockNumber: n })).timestamp));
  return blockTime.get(n);
}

async function scanRange(h, from, to) {
  const logs = await client.getLogs({ address: h.address, fromBlock: from, toBlock: to });
  const out = [];
  for (const l of logs) {
    const key = `${l.transactionHash}:${l.logIndex}`;
    if (seen.has(key)) continue;
    let ev;
    try { ev = decodeEventLog({ abi, data: l.data, topics: l.topics }); } catch { continue; }
    const tx = await client.getTransaction({ hash: l.transactionHash });
    seen.add(key);
    out.push({
      halter: h.address, version: h.version, name: ev.eventName, args: jsonSafe(ev.args),
      tx: l.transactionHash, logIndex: l.logIndex, block: Number(l.blockNumber),
      time: await timeOf(l.blockNumber), from: tx.from, to: tx.to,
      // Reactivity callbacks are system transactions: the precompile is msg.sender.
      reactivity: ev.eventName === "GuardChecked",
    });
  }
  return out;
}

async function catchUp() {
  head = await client.getBlockNumber();
  for (const h of HALTERS) {
    let next = BigInt(state.scanned[h.address]) + 1n;
    while (next <= head) {
      const batch = [];
      for (let i = 0; i < CONCURRENCY && next <= head; i++) {
        const to = next + STEP - 1n > head ? head : next + STEP - 1n;
        batch.push(scanRange(h, next, to));
        next = to + 1n;
      }
      const found = (await Promise.all(batch)).flat();
      state.events.push(...found);
      state.scanned[h.address] = String(next - 1n);
      if (found.length) state.events.sort((a, b) => a.block - b.block || a.logIndex - b.logIndex);
    }
  }
  writeFileSync(file, JSON.stringify(state));
}

async function loop() {
  try { await catchUp(); lastError = null; } catch (e) { lastError = String(e.shortMessage ?? e.message ?? e); console.error("scan:", lastError); }
  setTimeout(loop, 4000);
}

// ---- http ----
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json", ".woff2": "font/woff2" };
http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname === "/api/events") {
    const behind = HALTERS.map((h) => Number(head - BigInt(state.scanned[h.address])));
    res.writeHead(200, { "content-type": "application/json", "access-control-allow-origin": "*", "cache-control": "no-store" });
    return res.end(JSON.stringify({ head: Number(head), behind: Math.max(...behind), error: lastError, events: state.events }));
  }
  if (url.pathname === "/api/health") {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ ok: true, head: Number(head), events: state.events.length }));
  }
  let p = normalize(join(DIST, decodeURIComponent(url.pathname)));
  if (!p.startsWith(DIST) || !existsSync(p) || statSync(p).isDirectory()) p = join(DIST, "index.html");
  if (!existsSync(p)) { res.writeHead(404); return res.end("build the app first: npm run build"); }
  res.writeHead(200, { "content-type": types[extname(p)] ?? "application/octet-stream" });
  res.end(readFileSync(p));
}).listen(PORT, HOST, () => console.log(`halter service on ${HOST}:${PORT}, rpc ${RPC}`));

loop();
