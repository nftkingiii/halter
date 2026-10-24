import { useMemo, useState } from "react";
import { toRows, type Kind, type RawEvent } from "../data";
import type { Account } from "../config";
import { Tape } from "./Tape";

const FILTERS: { id: "all" | "orders" | Kind; label: string }[] = [
  { id: "all", label: "Everything" },
  { id: "orders", label: "Allowed" },
  { id: "blocked", label: "Blocked" },
  { id: "guard", label: "Guard" },
  { id: "owner", label: "Owner" },
];

export function ActivityView({ acct, events, status }: { acct: Account; events: RawEvent[] | null; status: { ok: boolean; behind: number; error?: string } }) {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["id"]>("all");
  const rows = useMemo(() => (events ? toRows(events, acct) : []), [events, acct]);
  const shown = rows.filter((r) => filter === "all" || (filter === "orders" ? r.kind === "allowed" || r.kind === "pair" : r.kind === filter));
  const counts = useMemo(() => ({
    blocked: rows.filter((r) => r.kind === "blocked").length,
    allowed: rows.filter((r) => r.kind === "allowed" || r.kind === "pair").length,
  }), [rows]);

  return (
    <>
      <section className="plate" style={{ marginTop: 24 }}>
        <span className="screw l">+</span><span className="screw r">+</span>
        <span className="eng">Activity · {acct.label} · every Halter event on Hideki</span>
        <h1 className="sentence" style={{ marginBottom: 6 }}>
          What the agent did, and what it tried: <b>{counts.allowed}</b> orders through, <b>{counts.blocked}</b> stopped at the fence.
        </h1>
        <p className="note" style={{ marginTop: 0 }}>Blocked orders are recorded with the rule that stopped them. Every line links to its transaction.</p>
      </section>

      <section className="tape">
        <div className="tape-head">
          <div className="filters" role="group" aria-label="Filter activity">
            {FILTERS.map((f) => <button key={f.id} aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>{f.label}</button>)}
          </div>
          {status.ok && status.behind > 50 && <span className="eng dim">Catching up · {status.behind.toLocaleString()} blocks</span>}
        </div>
        {!status.ok && <div className="notice risk" role="status" style={{ margin: "0 4px 12px" }}>Activity history is unavailable right now ({status.error}). The Paddock tab reads straight from chain and still works.</div>}
        {events === null && status.ok && <div className="skeleton" style={{ height: 160, margin: "0 4px 12px" }} />}
        {events !== null && shown.length === 0 && <p className="dim mono" style={{ padding: "8px 4px 16px" }}>Nothing here yet.</p>}
        <Tape rows={shown} />
      </section>
    </>
  );
}
