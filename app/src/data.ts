import { useEffect, useRef, useState } from "react";
import { readLive, type LiveState } from "./chain";
import { marketOf, ONE_BASE, REASONS, REASON_TEXT, DEMO_GUARD_BPS, who, halterAddresses, type Account } from "./config";

// ---------- live chain state ----------
export function useLive(acct: Account, intervalMs = 10_000) {
  const [live, setLive] = useState<LiveState | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let stop = false;
    const tick = async () => {
      try {
        const s = await readLive(acct);
        if (!stop) { setLive(s); setError(null); }
      } catch (e) {
        if (!stop) setError((e as Error).message.split("\n")[0]);
      }
    };
    setLive(null);
    tick();
    const id = setInterval(tick, intervalMs);
    return () => { stop = true; clearInterval(id); };
  }, [acct.id, intervalMs]);
  return { live, error };
}

// ---------- activity (cached chain logs) ----------
export type RawEvent = {
  halter: string; version: "v1" | "v2"; name: string; args: Record<string, any>;
  tx: string; logIndex: number; block: number; time: number; from: string; to: string; reactivity: boolean;
};
export type Kind = "allowed" | "blocked" | "guard" | "owner" | "pair";
export type Row = {
  key: string; kind: Kind; time: number; title: string; detail?: string; tx: string; version: string;
  demo?: boolean; count?: number;
};

export function useEvents(intervalMs = 8_000) {
  const [events, setEvents] = useState<RawEvent[] | null>(null);
  const [status, setStatus] = useState<{ ok: boolean; behind: number; error?: string }>({ ok: true, behind: 0 });
  const etag = useRef(0);
  useEffect(() => {
    let stop = false;
    const tick = async () => {
      try {
        const r = await fetch("/api/events", { cache: "no-store" });
        if (!r.ok) throw new Error(`activity service answered ${r.status}`);
        const j = await r.json();
        if (stop) return;
        if (j.events.length !== etag.current || events === null) { etag.current = j.events.length; setEvents(j.events); }
        setStatus({ ok: !j.error, behind: j.behind, error: j.error ?? undefined });
      } catch (e) {
        if (!stop) setStatus({ ok: false, behind: 0, error: (e as Error).message });
      }
    };
    tick();
    const id = setInterval(tick, intervalMs);
    return () => { stop = true; clearInterval(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intervalMs]);
  return { events, status };
}

const qty = (q: string, pool: string) => {
  const m = marketOf(pool);
  const one = ONE_BASE[m] ?? 10n ** 18n;
  return (Number(BigInt(q)) / Number(one)).toLocaleString("en-US", { maximumSignificantDigits: 4 });
};
const px = (p: string) => `$${(Number(BigInt(p)) / 1e18).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
const usdOf = (q: string, p: string, pool: string) => {
  const one = ONE_BASE[marketOf(pool)] ?? 10n ** 18n;
  return `$${(Number((BigInt(q) * BigInt(p)) / one) / 1e18).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
};

/** One readable line per Halter event. Pair legs fold into their PairPlaced row. */
/** The events of one account's Halter deployments. */
export const forAccount = (events: RawEvent[] | null, acct: Account) => {
  if (!events) return null;
  const mine = new Set(halterAddresses(acct));
  return events.filter((e) => mine.has(e.halter.toLowerCase()));
};

export function toRows(events: RawEvent[], acct: Account): Row[] {
  const pairTx = new Set(events.filter((e) => e.name === "PairPlaced").map((e) => e.tx));
  const rows: Row[] = [];
  // Previous owner settings per Halter, so owner rows can say what changed.
  const lastPaddock = new Map<string, any>();
  const lastCap = new Map<string, bigint>();
  const lev = (m: any) => `${(Number(m.maxLeverageX100) / 100).toLocaleString()}×`;
  const line = (m: any) => `${(Number(m.guardHealthBps) / 10_000).toLocaleString("en-US", { maximumFractionDigits: 1 })}×`;
  for (const e of events) {
    const a = e.args;
    const base = { key: `${e.tx}:${e.logIndex}`, time: e.time, tx: e.tx, version: e.version };
    switch (e.name) {
      case "OrderAllowed": {
        if (pairTx.has(e.tx)) break;
        const title = a.reducing
          ? `${who(a.agent, acct)} reduced the ${marketOf(a.pool)} ${a.isBid ? "short" : "long"}`
          : `${who(a.agent, acct)} placed a ${marketOf(a.pool)} ${a.isBid ? "bid" : "ask"}`;
        rows.push({ ...base, kind: "allowed", title, detail: `${qty(a.quantity, a.pool)} ${marketOf(a.pool)} at ${px(a.price)} · ${usdOf(a.quantity, a.price, a.pool)} · order #${String(a.orderId).slice(0, 6)}…` });
        break;
      }
      case "PairPlaced": {
        const legs = events.filter((x) => x.tx === e.tx && x.name === "OrderAllowed");
        rows.push({ ...base, kind: "pair", title: `${who(a.agent, acct)} placed a pair: ${legs.map((l) => marketOf(l.args.pool)).join(" + ")}`, detail: `Both legs in one transaction · ${legs.map((l) => `${qty(l.args.quantity, l.args.pool)} ${marketOf(l.args.pool)}`).join(", ")}` });
        break;
      }
      case "OrderBlocked": {
        const r = REASONS[Number(a.reason)] ?? String(a.reason);
        rows.push({ ...base, kind: "blocked", title: `Blocked ${who(a.agent, acct).toLowerCase() === "agent key" ? "the agent's" : `${who(a.agent, acct)}'s`} ${marketOf(a.pool)} ${a.isBid ? "bid" : "ask"}`, detail: `Because ${REASON_TEXT[r] ?? r} · tried ${qty(a.quantity, a.pool)} ${marketOf(a.pool)} (${usdOf(a.quantity, a.price, a.pool)})` });
        break;
      }
      case "GuardFired":
        rows.push({ ...base, kind: "guard", title: `Guard cut the ${marketOf(a.pool)} position`, detail: `Equity ${px(a.equity)} vs maintenance ${px(a.mmReq)} · reduced ${qty(a.quantity, a.pool)} ${marketOf(a.pool)}` });
        break;
      case "GuardChecked": {
        if (Number(a.fired) > 0) {
          rows.push({ ...base, kind: "guard", title: `Somnia Reactivity ran the guard (epoch ${a.epoch})`, detail: `Called by the chain, no keeper · fired on ${a.fired} market${Number(a.fired) > 1 ? "s" : ""}` });
        } else {
          const prev = rows[rows.length - 1];
          if (prev && prev.kind === "guard" && prev.count) {
            prev.count += 1; prev.time = e.time; prev.tx = e.tx; prev.key = base.key;
            prev.title = `Somnia Reactivity checked the guard ${prev.count} times`;
            prev.detail = `Called by the chain each epoch, no keeper · account healthy, nothing to do · latest epoch ${a.epoch}`;
          } else {
            rows.push({ ...base, kind: "guard", count: 1, title: "Somnia Reactivity checked the guard", detail: `Called by the chain, no keeper · account healthy, nothing to do · epoch ${a.epoch}` });
          }
        }
        break;
      }
      case "MandateSet": {
        const m = a.mandate;
        const prev = lastPaddock.get(e.halter);
        lastPaddock.set(e.halter, m);
        const demo = Number(m.guardHealthBps) >= DEMO_GUARD_BPS;
        const changes: string[] = [];
        if (prev) {
          if (prev.maxLeverageX100 !== m.maxLeverageX100) changes.push(`leverage ${lev(prev)} → ${lev(m)}`);
          if (prev.dailyLossCap !== m.dailyLossCap) changes.push(`daily loss ${px(prev.dailyLossCap)} → ${px(m.dailyLossCap)}`);
          if (prev.guardHealthBps !== m.guardHealthBps) changes.push(`guard line ${line(prev)} → ${line(m)}`);
          if (prev.expiresAt !== m.expiresAt) changes.push("new end date");
        }
        const by = acct.admin ? "Admin" : "Owner";
        const title = !prev ? `${by} set up the paddock` : demo ? `${by} set a demo guard line` : changes.length ? `${by} changed the paddock` : `${by} reopened the paddock`;
        const detail = !prev || !changes.length
          ? `${lev(m)} leverage · ${px(m.dailyLossCap)} a day max loss · guard line ${line(m)} maintenance`
          : changes.join(" · ");
        rows.push({ ...base, kind: "owner", demo, title, detail });
        break;
      }
      case "PoolSet": {
        const cap = BigInt(a.notionalCap);
        const key = `${e.halter}:${String(a.pool).toLowerCase()}`;
        const prev = lastCap.get(key);
        lastCap.set(key, cap);
        const by = acct.admin ? "Admin" : "Owner";
        const title = cap === 0n ? `${by} took ${marketOf(a.pool)} out of the paddock` : prev ? `${by} changed the ${marketOf(a.pool)} cap` : `${by} added ${marketOf(a.pool)} to the paddock`;
        rows.push({ ...base, kind: "owner", title, detail: cap === 0n ? undefined : prev ? `${px(String(prev))} → ${px(a.notionalCap)}` : `Cap ${px(a.notionalCap)}` });
        break;
      }
      case "AgentSet":
        rows.push({ ...base, kind: "owner", title: `${acct.admin ? "Admin" : "Owner"} ${a.allowed ? "allowed" : "removed"} ${who(a.agent, acct).toLowerCase()}` });
        break;
      case "AdminSet":
        rows.push({ ...base, kind: "owner", title: "Halter's code installed and initialised", detail: `EIP-7702 activation · admin ${who(a.admin, acct)}` });
        break;
      case "Revoked":
        rows.push({ ...base, kind: "owner", title: `${acct.admin ? "Admin" : "Owner"} revoked every agent`, detail: "Agents stop at once until the owner reopens the paddock" });
        break;
    }
  }
  return rows.reverse();
}

export function stats(events: RawEvent[]) {
  const n = (name: string, f: (e: RawEvent) => boolean = () => true) => events.filter((e) => e.name === name && f(e)).length;
  return {
    allowed: n("OrderAllowed", (e) => !e.args.reducing),
    blocked: n("OrderBlocked"),
    checks: n("GuardChecked"),
    fired: n("GuardFired"),
    pairs: n("PairPlaced"),
  };
}

// ---------- the agent's decision cycles (reasoning is off chain; orders link to chain) ----------
export type AgentRun = {
  started: string; finished?: string; model: string; note: string | null; cost_usd?: number;
  steps: { say?: string; tool?: string; input?: Record<string, unknown>; result?: any; error?: string }[];
  orders: { result: string; reason?: string; tx?: string; market?: string }[];
};

export function useAgentRuns(intervalMs = 30_000) {
  const [runs, setRuns] = useState<AgentRun[] | null>(null);
  const [status, setStatus] = useState<{ ok: boolean; error?: string }>({ ok: true });
  useEffect(() => {
    let stop = false;
    const tick = async () => {
      try {
        const r = await fetch("/api/agent", { cache: "no-store" });
        if (!r.ok) throw new Error(`agent log answered ${r.status}`);
        const j = await r.json();
        if (!stop) { setRuns(j.runs); setStatus({ ok: true }); }
      } catch (e) {
        if (!stop) setStatus({ ok: false, error: (e as Error).message });
      }
    };
    tick();
    const id = setInterval(tick, intervalMs);
    return () => { stop = true; clearInterval(id); };
  }, [intervalMs]);
  return { runs, status };
}
