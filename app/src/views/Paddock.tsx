import { useMemo } from "react";
import type { LiveState } from "../chain";
import { usd, notional, baseAmount } from "../chain";
import { CURRENT, EXPLORER, MARKETS, OWNER, SUBSCRIPTION_ID, DEMO_GUARD_BPS, marketOf, short } from "../config";
import { toRows, type RawEvent } from "../data";
import { Tape } from "./Tape";

const dateOf = (t: number) => new Date(t * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
const ago = (t: number) => {
  const s = Math.max(0, Math.round(Date.now() / 1000 - t));
  return s < 90 ? `${s} s ago` : s < 5400 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} h ago`;
};

// ---- the dial: log scale 1x..200x over a 180° arc ----
const CX = 250, CY = 260, R = 190;
const frac = (x: number) => Math.min(1, Math.max(0, Math.log(Math.max(x, 1)) / Math.log(200)));
const at = (x: number, r = R) => {
  const a = Math.PI * (1 - frac(x));
  return [CX + r * Math.cos(a), CY - r * Math.sin(a)] as const;
};

function Dial({ ratio, line }: { ratio: number | null; line: number }) {
  const ticks = [1, 2, 5, 10, 20, 50, 100, 200];
  const [nx, ny] = at(ratio ?? 200, R - 28);
  const [g1x, g1y] = at(line, R - 16);
  const [g2x, g2y] = at(line, R + 14);
  const [glx, gly] = at(line, R - 50);
  return (
    <svg viewBox="0 0 500 300" role="img" aria-label={ratio === null ? "No open position" : `Health ${ratio.toFixed(1)} times maintenance, guard line ${line} times`}>
      <defs>
        <linearGradient id="arc" x1="0" x2="1">
          <stop offset="0" stopColor="#E07A45" /><stop offset=".25" stopColor="#C9A46A" /><stop offset="1" stopColor="#8DB596" />
        </linearGradient>
      </defs>
      <path d={`M${CX - R} ${CY} A ${R} ${R} 0 0 1 ${CX + R} ${CY}`} fill="none" stroke="#2A251F" strokeWidth="26" />
      <path d={`M${CX - R} ${CY} A ${R} ${R} 0 0 1 ${CX + R} ${CY}`} fill="none" stroke="url(#arc)" strokeWidth="4" />
      {ticks.map((t) => {
        const [ax, ay] = at(t, R - 14);
        const [bx, by] = at(t, R + 12);
        const [lx, ly] = at(t, R + 30);
        return (
          <g key={t}>
            <line x1={ax} y1={ay} x2={bx} y2={by} stroke="#8D8372" strokeWidth="1.5" />
            <text x={lx} y={ly + 4} textAnchor="middle" fontFamily="Space Mono" fontSize="11" fill="#8D8372">{t}×</text>
          </g>
        );
      })}
      <line x1={g1x} y1={g1y} x2={g2x} y2={g2y} stroke="#E07A45" strokeWidth="5" strokeLinecap="round" />
      <text x={glx} y={gly} textAnchor={frac(line) < 0.5 ? "start" : "end"} fontFamily="Space Mono" fontSize="11" fill="#E07A45">GUARD {line}×</text>
      {ratio !== null && <line x1={CX} y1={CY} x2={nx} y2={ny} stroke="#EDE4D3" strokeWidth="3" strokeLinecap="round" />}
      <circle cx={CX} cy={CY} r="12" fill="#C9A46A" /><circle cx={CX} cy={CY} r="4" fill="#14120F" />
      <text x={CX} y={CY - 56} textAnchor="middle" fontFamily="Fraunces" fontSize={ratio === null ? 40 : 54} fill="#EDE4D3">
        {ratio === null ? "Flat" : `${ratio >= 100 ? Math.round(ratio) : ratio.toFixed(1)}×`}
      </text>
    </svg>
  );
}

export function PaddockView({ live, error, events, status }: {
  live: LiveState | null; error: string | null; events: RawEvent[] | null; status: { ok: boolean; error?: string };
}) {
  const m = live?.mandate;
  const expired = !!m && m.expiresAt !== 0 && m.expiresAt * 1000 < Date.now();
  const line = m ? m.guardHealthBps / 10_000 : 1.5;
  const ratio = live && live.mmReq > 0n ? Number((live.equity * 10_000n) / live.mmReq) / 10_000 : null;
  const inside = new Set(live?.markets.map((x) => x.pool.toLowerCase()) ?? []);
  const names = live?.markets.map((x) => marketOf(x.pool)) ?? [];
  const lastCheck = events?.filter((e) => e.name === "GuardChecked" && e.version === CURRENT.version).at(-1);
  const recent = useMemo(() => (events ? toRows(events).slice(0, 5) : []), [events]);
  const outside = Object.keys(MARKETS).length - inside.size;

  return (
    <>
      {error && !live && <div className="notice risk" role="alert" style={{ marginTop: 24 }}>Couldn't read Hideki: {error}. Retrying every 10 seconds.</div>}

      <div className="deck">
        <section className="plate dial" aria-labelledby="h-health">
          <span className="screw l">+</span><span className="screw r">+</span>
          <div className="plate-head"><span className="eng" id="h-health">Margin health · log scale</span>
            {m && m.guardHealthBps >= DEMO_GUARD_BPS && <span className="tag demo">Demo guard line</span>}</div>
          <Dial ratio={ratio} line={line} />
          <div className="readouts">
            <div><div className="eng dim">Equity</div><div className={`v num ${live ? "" : "skeleton"}`}>{live ? usd(live.equity) : "$000.00"}</div></div>
            <div><div className="eng dim">Maintenance</div><div className={`v num ${live ? "" : "skeleton"}`}>{live ? usd(live.mmReq) : "$0.00"}</div></div>
            <div><div className="eng dim">Reactivity sub</div><div className="v clay num">{SUBSCRIPTION_ID}</div></div>
          </div>
          <p className="note">
            {ratio === null ? "No open position, so there's nothing for the guard to cut. " : ""}
            Every epoch (~5 min) the chain itself calls Halter; below the guard line it cuts the position by {m ? m.guardReduceBps / 100 : "…"}%.
            {lastCheck ? ` Last check ${ago(lastCheck.time)}, epoch ${lastCheck.args.epoch}.` : ""}
          </p>
        </section>

        <section className="plate" aria-labelledby="h-paddock">
          <span className="screw l">+</span><span className="screw r">+</span>
          <div className="plate-head">
            <span className="eng" id="h-paddock">Paddock · Halter {CURRENT.version}</span>
            <span className={`tag ${!live ? "owner" : live.revoked || expired ? "block" : "ok"}`}>
              {!live ? "Reading" : live.revoked ? "Revoked" : expired ? "Expired" : "Agent trading"}
            </span>
          </div>
          <h1 className="sentence">
            {!live ? "Reading the paddock from Hideki…" : live.revoked
              ? <>Every agent is stopped. Nothing trades this account through Halter until the owner reopens the paddock.</>
              : <>Agent may trade {names.map((n, i) => <span key={n}>{i ? " and " : ""}<b>{n}</b></span>)}. {outside} other markets are locked out.</>}
          </h1>
          {!live && <div className="skeleton" style={{ height: 80 }} />}
          {live?.markets.map((mk) => {
            const used = mk.mark ? notional(mk.size, mk.mark, mk.oneBase) : 0n;
            const pct = mk.cap > 0n ? Math.min(100, Number((used * 10_000n) / mk.cap) / 100) : 0;
            const side = mk.size > 0n ? "long" : mk.size < 0n ? "short" : "";
            return (
              <div className="cap" key={mk.pool}>
                <span className="eng" style={{ color: "var(--text)" }}>{marketOf(mk.pool)}</span>
                <div className="track" aria-label={`${pct.toFixed(0)}% of cap used`}><i style={{ width: `${pct}%` }} /></div>
                <span className="readout num">{usd(used, 0)} / {usd(mk.cap, 0)}</span>
                {side && <small className="mono dim">{side} {baseAmount(mk.size < 0n ? -mk.size : mk.size, mk.oneBase)} {marketOf(mk.pool)}{mk.mark === null ? " · mark stale" : ""}</small>}
              </div>
            );
          })}
          {m && (
            <div className="specs">
              <div><span className="eng dim">Leverage</span><b className="num">{m.maxLeverageX100 / 100}×</b></div>
              <div><span className="eng dim">Loss / day</span><b className="num">{usd(m.dailyLossCap, 0)}</b></div>
              <div><span className="eng dim">Closes</span><b>{m.expiresAt ? dateOf(m.expiresAt) : "Never"}</b></div>
            </div>
          )}
          <div className="board" role="list" aria-label="dreamDEX perp markets">
            {Object.entries(MARKETS).map(([pool, sym]) => (
              <div role="listitem" key={pool} className={`key ${inside.has(pool) ? "open" : ""}`}>{sym}<small>{inside.has(pool) ? "OPEN" : "LOCKED"}</small></div>
            ))}
          </div>
          <p className="note">
            Linking a bot on dreamDEX opens all {Object.keys(MARKETS).length} markets. Halter narrows it to these, each checked against dreamDEX's pool factory, for account{" "}
            <a className="mono" href={`${EXPLORER}/address/${OWNER}`} target="_blank" rel="noreferrer">{short(OWNER)}</a>.
          </p>
        </section>
      </div>

      <section className="tape" aria-labelledby="h-latest">
        <div className="tape-head"><span className="eng" id="h-latest">Latest on the tape</span><a className="eng dim" href="#activity">All activity</a></div>
        {!status.ok && <p className="dim mono" style={{ padding: "0 4px 12px" }}>Activity history unavailable ({status.error}). Everything above is read straight from chain.</p>}
        {events === null && status.ok && <div className="skeleton" style={{ height: 90, margin: "0 4px 12px" }} />}
        <Tape rows={recent} />
      </section>
    </>
  );
}
