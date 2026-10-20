// Local JSON-RPC proxy for Somnia Hideki: the node rejects EIP-1898 block
// parameters ({ blockNumber } / { blockHash }) with -32602, which Foundry forks
// and anvil send. This rewrites them to plain block numbers and forwards.
//   UPSTREAM=https://api.hideki2.infra.testnet.somnia.network node tools/rpc-1898-proxy.mjs
import http from "node:http";

const UPSTREAM = process.env.UPSTREAM ?? "https://api.hideki2.infra.testnet.somnia.network";
const PORT = Number(process.env.PORT ?? 8545);
const hashToNumber = new Map();

async function upstream(body) {
  const res = await fetch(UPSTREAM, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return res.json();
}

async function fixParam(p) {
  if (!p || typeof p !== "object" || Array.isArray(p)) return p;
  if (typeof p.blockNumber === "string") return p.blockNumber;
  if (typeof p.blockHash === "string") {
    if (!hashToNumber.has(p.blockHash)) {
      const r = await upstream({ jsonrpc: "2.0", id: 1, method: "eth_getBlockByHash", params: [p.blockHash, false] });
      hashToNumber.set(p.blockHash, r.result?.number ?? "latest");
    }
    return hashToNumber.get(p.blockHash);
  }
  return p;
}

async function fixCall(c) {
  if (Array.isArray(c.params)) c.params = await Promise.all(c.params.map((p, i) => (i === 0 ? p : fixParam(p))));
  return c;
}

http
  .createServer((req, res) => {
    let raw = "";
    req.on("data", (d) => (raw += d));
    req.on("end", async () => {
      try {
        const body = JSON.parse(raw);
        const fixed = Array.isArray(body) ? await Promise.all(body.map(fixCall)) : await fixCall(body);
        const out = await upstream(fixed);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(out));
      } catch (e) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: String(e) }));
      }
    });
  })
  .listen(PORT, "127.0.0.1", () => console.log(`rpc-1898-proxy on 127.0.0.1:${PORT} -> ${UPSTREAM}`));
