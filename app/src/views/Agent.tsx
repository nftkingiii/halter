import { Fragment, type ReactNode } from "react";
import { EXPLORER } from "../config";
import type { AgentRun } from "../data";

/** Bold and bullet lists only, built as React nodes: the agent's text is never injected as HTML. */
function bold(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") ? <b key={i}>{part.slice(2, -2)}</b> : <Fragment key={i}>{part}</Fragment>,
  );
}
function Said({ text }: { text: string }) {
  const blocks = text.split(/\n{2,}/);
  return (
    <>
      {blocks.map((b, i) => {
        const lines = b.split("\n");
        if (lines.every((l) => /^\s*[-*] /.test(l))) {
          return <ul key={i}>{lines.map((l, j) => <li key={j}>{bold(l.replace(/^\s*[-*] /, ""))}</li>)}</ul>;
        }
        return <p key={i}>{bold(b)}</p>;
      })}
    </>
  );
}

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

const callLine = (s: AgentRun["steps"][number]) => {
  if (!s.tool) return null;
  const args = s.input && Object.keys(s.input).length ? Object.values(s.input).join(", ") : "";
  const verdict = s.error ? `failed: ${s.error}` : s.result?.halter_says ?? s.result?.result ?? "";
  return `${s.tool}(${args})${verdict ? ` → ${verdict}` : ""}`;
};

export function AgentView({ runs, status }: { runs: AgentRun[] | null; status: { ok: boolean; error?: string } }) {
  const total = runs?.reduce((a, r) => a + (r.cost_usd ?? 0), 0) ?? 0;
  const orders = runs?.reduce((a, r) => a + r.orders.length, 0) ?? 0;
  const latest = runs?.[0];

  return (
    <>
      <section className="plate" style={{ marginTop: 24 }}>
        <span className="screw l">+</span><span className="screw r">+</span>
        <div className="plate-head">
          <span className="eng">Agent · Claude Sonnet 5.5, trading only through Halter</span>
          {latest && <span className="tag agent">Last cycle {when(latest.started)}</span>}
        </div>
        <h1 className="sentence" style={{ marginBottom: 6 }}>
          {runs === null ? "Loading the agent's log…" : runs.length === 0 ? "The agent hasn't run a cycle yet."
            : <>The agent has run <b>{runs.length}</b> decision cycle{runs.length === 1 ? "" : "s"} and sent <b>{orders}</b> order{orders === 1 ? "" : "s"}.</>}
        </h1>
        <p className="note" style={{ marginTop: 0 }}>
          Each cycle it reads the paddock and the markets from chain, previews any order against Halter, then decides. Its reasoning is
          off chain and shown as written; its orders are on chain and linked. {runs?.length ? `Model cost so far: about $${total.toFixed(2)}.` : ""}
        </p>
      </section>

      {!status.ok && <div className="notice risk" style={{ marginTop: 16 }}>The agent log is unavailable right now ({status.error}).</div>}

      <section className="tape">
        <div className="tape-head"><span className="eng">Decision cycles · newest first</span></div>
        {runs === null && status.ok && <div className="skeleton" style={{ height: 160, margin: "0 4px 12px" }} />}
        {runs?.map((r) => {
          const said = r.steps.filter((s) => s.say).map((s) => s.say).join("\n\n");
          return (
            <article className="cycle" key={r.started}>
              <div>
                <div className="mono num">{when(r.started)}</div>
                <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {r.orders.length === 0 && <span className="tag owner">No trade</span>}
                  {r.orders.map((o, i) => <span key={i} className={`tag ${o.result === "placed" ? "ok" : "block"}`}>{o.result === "placed" ? "Order placed" : `Blocked: ${o.reason}`}</span>)}
                  {r.note && <span className="tag demo">Operator note</span>}
                </div>
                <div className="eng dim" style={{ marginTop: 10 }}>~${(r.cost_usd ?? 0).toFixed(3)}</div>
              </div>
              <div>
                {r.note && <p className="mono dim" style={{ margin: "0 0 10px" }}>Note: “{r.note}”</p>}
                <div className="said">{said ? <Said text={said} /> : "(no summary)"}</div>
                <ul className="calls">
                  {r.steps.map((s, i) => { const l = callLine(s); return l ? <li key={i}><b>{l}</b></li> : null; })}
                  {r.orders.map((o, i) => o.tx && (
                    <li key={`o${i}`}>tx <a href={`${EXPLORER}/tx/${o.tx}`} target="_blank" rel="noreferrer">{o.tx.slice(0, 18)}…</a></li>
                  ))}
                </ul>
              </div>
            </article>
          );
        })}
      </section>
    </>
  );
}
