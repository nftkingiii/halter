import { useMemo, useState } from "react";
import { EXPLORER } from "../config";
import { toRows, type Kind, type RawEvent } from "../data";
import { IconCheck, IconStop, IconPulse, IconKey } from "../icons";

const FILTERS: { id: "all" | "orders" | Kind; label: string }[] = [
  { id: "all", label: "Everything" },
  { id: "orders", label: "Allowed" },
  { id: "blocked", label: "Blocked" },
  { id: "guard", label: "Guard" },
  { id: "owner", label: "Owner" },
];

const BADGE: Record<Kind, JSX.Element> = {
  allowed: <span className="chip ok"><IconCheck /> Allowed</span>,
  pair: <span className="chip ok"><IconCheck /> Pair</span>,
  blocked: <span className="chip risk"><IconStop /> Blocked</span>,
  guard: <span className="chip clay"><IconPulse /> Guard</span>,
  owner: <span className="chip quiet"><IconKey /> Owner</span>,
};

const when = (t: number) =>
  new Date(t * 1000).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export function ActivityView({ events, status }: { events: RawEvent[] | null; status: { ok: boolean; behind: number; error?: string } }) {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["id"]>("all");
  const rows = useMemo(() => (events ? toRows(events) : []), [events]);
  const shown = rows.filter((r) => filter === "all" || (filter === "orders" ? r.kind === "allowed" || r.kind === "pair" : r.kind === filter));

  return (
    <>
      <header className="head">
        <div>
          <h1>What the agent did, and what it tried</h1>
          <p>Every row is a Halter event on Hideki, linked to its transaction. Blocked orders are recorded too, with the rule that stopped them.</p>
        </div>
      </header>

      {!status.ok && (
        <div className="notice risk" role="status" style={{ marginBottom: 16 }}>
          Activity history is unavailable right now ({status.error}). The Paddock tab reads straight from chain and still works.
        </div>
      )}
      {status.ok && status.behind > 50 && (
        <div className="notice" role="status" style={{ marginBottom: 16 }}>Catching up with the chain: {status.behind.toLocaleString()} blocks left to scan.</div>
      )}

      <div className="filters" role="group" aria-label="Filter activity">
        {FILTERS.map((f) => (
          <button key={f.id} aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>{f.label}</button>
        ))}
      </div>

      <section className="panel" aria-live="polite">
        {events === null && status.ok && <div className="skeleton" style={{ height: 120 }} />}
        {events !== null && shown.length === 0 && <p className="muted" style={{ margin: 0 }}>Nothing here yet.</p>}
        <ul className="feed">
          {shown.map((r) => (
            <li key={r.key}>
              <span className="when num">{when(r.time)}</span>
              <span>{BADGE[r.kind]}</span>
              <span className="what">
                {r.title} {r.demo && <span className="chip demo" style={{ marginLeft: 6 }}>Demo threshold</span>}
                {r.detail && <small>{r.detail}</small>}
              </span>
              <a className="tx" href={`${EXPLORER}/tx/${r.tx}`} target="_blank" rel="noreferrer" title={`Halter ${r.version} · ${r.tx}`}>
                {r.tx.slice(0, 8)}… <span className="muted">{r.version}</span>
              </a>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
