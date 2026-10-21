import type { LiveState } from "../chain";
import { usd, notional, baseAmount } from "../chain";
import { CURRENT, EXPLORER, MARKETS, OWNER, AGENT, SUBSCRIPTION_ID, DEMO_GUARD_BPS, marketOf, short } from "../config";
import type { RawEvent } from "../data";
import { IconCheck, IconStop, IconPulse } from "../icons";

const ago = (t: number) => {
  const s = Math.max(0, Math.round(Date.now() / 1000 - t));
  if (s < 90) return `${s} s ago`;
  if (s < 5400) return `${Math.round(s / 60)} min ago`;
  return `${Math.round(s / 3600)} h ago`;
};
const dateOf = (t: number) => new Date(t * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
const list = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);

/** Position of a health ratio on a log scale from 1x to 200x. */
const pos = (ratio: number) => Math.min(100, Math.max(0, (Math.log(Math.max(ratio, 1)) / Math.log(200)) * 100));

export function PaddockView({ live, error, events }: { live: LiveState | null; error: string | null; events: RawEvent[] | null }) {
  const m = live?.mandate;
  const expired = !!m && m.expiresAt !== 0 && m.expiresAt * 1000 < Date.now();
  const status = !live ? null : live.revoked ? "revoked" : expired ? "expired" : !live.agentAllowed ? "no-agent" : "open";
  const guardLine = m ? m.guardHealthBps / 10_000 : 0;
  const ratio = live && live.mmReq > 0n ? Number((live.equity * 10_000n) / live.mmReq) / 10_000 : null;
  const health = ratio === null ? "flat" : ratio < guardLine ? "below" : ratio < guardLine * 1.5 ? "near" : "healthy";
  const lastCheck = events?.filter((e) => e.name === "GuardChecked" && e.version === CURRENT.version).at(-1);
  const inside = new Set(live?.markets.map((x) => x.pool.toLowerCase()) ?? []);
  const names = live?.markets.map((x) => marketOf(x.pool)) ?? [];
  const caps = live ? [...new Set(live.markets.map((x) => usd(x.cap, 0)))] : [];

  // The hero is one sentence a trader can check against the chain.
  const sentence = !live || !m
    ? "Reading the paddock from Hideki…"
    : status === "revoked"
      ? "The owner revoked every agent. Nothing can trade this account through Halter until the paddock is set again."
      : status === "expired"
        ? `The paddock expired on ${dateOf(m.expiresAt)}. The agent can't open anything new.`
        : `Your agent can trade ${list(names)}, up to ${caps.length === 1 ? `${caps[0]} each` : list(caps)}, at no more than ${m.maxLeverageX100 / 100}× leverage${m.expiresAt ? `, until ${dateOf(m.expiresAt)}` : ""}.`;

  return (
    <>
      <header className="head">
        <div>
          <h1 className="hero-sentence">{sentence}</h1>
          <p>
            That's its paddock: Halter {CURRENT.version} checks every order on chain before it reaches dreamDEX for account{" "}
            <a className="mono" href={`${EXPLORER}/address/${OWNER}`} target="_blank" rel="noreferrer">{short(OWNER)}</a>.
          </p>
        </div>
        {status === "open" && <span className="chip ok"><IconCheck /> Agent trading</span>}
        {status === "revoked" && <span className="chip risk"><IconStop /> Revoked</span>}
        {status === "expired" && <span className="chip risk"><IconStop /> Expired</span>}
        {status === "no-agent" && <span className="chip quiet">No agent allowed</span>}
      </header>

      {error && !live && <div className="notice risk" role="alert" style={{ marginBottom: 18 }}>Couldn't read Hideki: {error}. Retrying every 10 seconds.</div>}

      <div className="grid">
        {/* 1. health against the guard line: the one number that can change on its own */}
        <section className="panel span-7" aria-labelledby="h-health">
          <h2 id="h-health">Margin health and the guard line</h2>
          <div className="stats">
            <div className="stat"><span className="k">Equity</span><span className={`v num ${live ? "" : "skeleton"}`}>{live ? usd(live.equity) : "$000.00"}</span></div>
            <div className="stat"><span className="k">Maintenance margin</span><span className={`v num ${live ? "" : "skeleton"}`}>{live ? usd(live.mmReq) : "$0.00"}</span></div>
            <div className="stat"><span className="k">Health</span><span className="v num">{ratio === null ? "—" : `${ratio.toLocaleString("en-US", { maximumFractionDigits: 1 })}×`}</span></div>
          </div>

          {health === "flat" ? (
            <p className="muted" style={{ marginTop: 18 }}>No open position, so the guard has nothing to protect right now.</p>
          ) : (
            <>
              <div className="gauge" role="img" aria-label={`Health ${ratio?.toFixed(1)} times maintenance; guard line at ${guardLine} times`}>
                <div className="gauge-track" />
                <div className="gauge-line" style={{ left: `${pos(guardLine)}%` }}><span>guard line {guardLine}×</span></div>
                <div className="gauge-dot" style={{ left: `${pos(ratio ?? 1)}%` }} />
              </div>
              <div className="gauge-scale"><span>1×</span><span>10×</span><span>200×</span></div>
            </>
          )}

          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 18 }}>
            {health === "healthy" && <span className="chip ok"><IconCheck /> Healthy</span>}
            {health === "near" && <span className="chip warn">Near the guard line</span>}
            {health === "below" && <span className="chip risk">Below the line: the next epoch reduces it</span>}
            {m && m.guardHealthBps >= DEMO_GUARD_BPS && <span className="chip demo">Demo guard line</span>}
            <span className="chip clay"><IconPulse /> Somnia Reactivity · subscription {SUBSCRIPTION_ID}</span>
          </div>
          <p className="muted" style={{ fontSize: 14, margin: "12px 0 0" }}>
            Every epoch (about 5 minutes) the chain itself calls Halter, which cuts any position below the line by{" "}
            {m ? m.guardReduceBps / 100 : "…"}%. No keeper, and no bot has to be running.
            {lastCheck ? ` Last check ${ago(lastCheck.time)}, epoch ${lastCheck.args.epoch}.` : ""}
          </p>
        </section>

        {/* 2. how much: limits with how much of each is used */}
        <section className="panel span-5" aria-labelledby="h-limits">
          <h2 id="h-limits">How much</h2>
          {!live && <div className="skeleton" style={{ height: 120 }} />}
          {live?.markets.map((mk) => {
            const used = mk.mark ? notional(mk.size, mk.mark, mk.oneBase) : 0n;
            const pct = mk.cap > 0n ? Math.min(100, Number((used * 10_000n) / mk.cap) / 100) : 0;
            const side = mk.size > 0n ? "long" : mk.size < 0n ? "short" : "";
            return (
              <div className="limit" key={mk.pool}>
                <div className="limit-row"><b>{marketOf(mk.pool)}</b><span className="num">{usd(used, 0)} <span className="muted">of {usd(mk.cap, 0)}</span></span></div>
                <div className="bar" aria-hidden="true"><i style={{ width: `${pct}%` }} /></div>
                {side && <div className="muted num small">{side} {baseAmount(mk.size < 0n ? -mk.size : mk.size, mk.oneBase)} {marketOf(mk.pool)}{mk.mark === null ? " · mark price stale" : ""}</div>}
              </div>
            );
          })}
          {m && (
            <dl className="rules num">
              <dt>Account leverage</dt><dd>up to {m.maxLeverageX100 / 100}×</dd>
              <dt>Loss allowed per day</dt><dd>{usd(m.dailyLossCap, 0)}</dd>
              <dt>Paddock ends</dt><dd>{m.expiresAt ? new Date(m.expiresAt * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "never"}</dd>
            </dl>
          )}
        </section>

        {/* 3. where: every dreamDEX market, fenced ones lit (default deny made visible) */}
        <section className="panel span-12" aria-labelledby="h-where">
          <h2 id="h-where">Where</h2>
          <ul className="fence" aria-label="dreamDEX perp markets">
            {Object.entries(MARKETS).map(([pool, sym]) => {
              const isIn = inside.has(pool);
              return (
                <li key={pool} className={isIn ? "in" : "out"}>
                  <span>{sym}</span>
                  <small>{isIn ? "inside" : "blocked"}</small>
                </li>
              );
            })}
          </ul>
          <p className="muted" style={{ fontSize: 14, margin: "14px 0 0" }}>
            Linking a bot on dreamDEX opens all {Object.keys(MARKETS).length} markets to it. Halter narrows that to {inside.size || "the ones you choose"},
            each checked against dreamDEX's own pool factory, so an order anywhere else is blocked and recorded.
          </p>
        </section>

        {/* 4. who */}
        <section className="panel span-12" aria-labelledby="h-who">
          <h2 id="h-who">Who</h2>
          <div className="agent">
            <div>
              <b>Agent key</b>{" "}
              <a className="mono" href={`${EXPLORER}/address/${AGENT}`} target="_blank" rel="noreferrer">{short(AGENT, 6)}</a>
              <div className="muted small">Can place, cancel and reduce orders through Halter. It can't withdraw, and it never holds the account's own link.</div>
            </div>
            {live && (live.agentAllowed && !live.revoked
              ? <span className="chip ok"><IconCheck /> Allowed{m?.expiresAt ? ` until ${dateOf(m.expiresAt)}` : ""}</span>
              : <span className="chip risk"><IconStop /> Stopped</span>)}
          </div>
        </section>
      </div>
    </>
  );
}
