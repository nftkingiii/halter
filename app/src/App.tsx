import { useEffect, useState } from "react";
import { useAgentRuns, useEvents, useLive } from "./data";
import { PaddockView } from "./views/Paddock";
import { ActivityView } from "./views/Activity";
import { AgentView } from "./views/Agent";
import { CardView } from "./views/Card";

const TABS = [
  { id: "paddock", label: "Paddock" },
  { id: "activity", label: "Activity" },
  { id: "agent", label: "Agent" },
  { id: "card", label: "Card" },
] as const;
type Tab = (typeof TABS)[number]["id"];

const fromHash = (): Tab => {
  const h = window.location.hash.slice(1);
  return (TABS.some((t) => t.id === h) ? h : "paddock") as Tab;
};

export default function App() {
  const [tab, setTab] = useState<Tab>(fromHash);
  const { live, error } = useLive();
  const { events, status } = useEvents();
  const agent = useAgentRuns();

  useEffect(() => {
    const on = () => setTab(fromHash());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  const go = (t: Tab) => { window.location.hash = t; setTab(t); };

  return (
    <div className="wrap">
      <header className="bar">
        <a className="brand" href="#paddock" onClick={() => go("paddock")}>
          <img src="/halter-logo.svg" alt="" />
          Halter
        </a>
        <nav className="tabs" role="tablist" aria-label="Halter">
          {TABS.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} aria-controls="view" onClick={() => go(t.id)}>{t.label}</button>
          ))}
        </nav>
        <div className="status" role="status">
          <span className="eng dim">{live ? `Hideki · block ${live.block.toLocaleString()}` : error ? "Hideki unreachable" : "Connecting"}</span>
          <span className={`led ${live ? "on" : error ? "off" : ""}`} aria-hidden="true" />
        </div>
      </header>

      <main id="view" role="tabpanel">
        {tab === "paddock" && <PaddockView live={live} error={error} events={events} status={status} />}
        {tab === "activity" && <ActivityView events={events} status={status} />}
        {tab === "agent" && <AgentView runs={agent.runs} status={agent.status} />}
        {tab === "card" && <CardView live={live} events={events} />}
      </main>
    </div>
  );
}
