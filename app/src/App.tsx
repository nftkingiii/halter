import { useEffect, useMemo, useState } from "react";
import { forAccount, useAgentRuns, useEvents, useLive } from "./data";
import { ACCOUNTS, accountById, type Account } from "./config";
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
const accountFromUrl = (): Account => accountById(new URLSearchParams(window.location.search).get("account"));

export default function App() {
  const [tab, setTab] = useState<Tab>(fromHash);
  const [acct, setAcct] = useState<Account>(accountFromUrl);
  const { live, error } = useLive(acct);
  const { events: allEvents, status } = useEvents();
  const agent = useAgentRuns();
  const events = useMemo(() => forAccount(allEvents, acct), [allEvents, acct]);
  const runs = useMemo(() => agent.runs?.filter((r) => (r as { halter?: string }).halter?.toLowerCase() === acct.halter.toLowerCase()) ?? null, [agent.runs, acct]);

  useEffect(() => {
    const on = () => setTab(fromHash());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  const go = (t: Tab) => { window.location.hash = t; setTab(t); };
  const pick = (a: Account) => {
    const url = new URL(window.location.href);
    if (a.id === ACCOUNTS[0].id) url.searchParams.delete("account"); else url.searchParams.set("account", a.id);
    window.history.replaceState(null, "", url);
    setAcct(a);
  };

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

      <div className="accounts" role="radiogroup" aria-label="Account">
        {ACCOUNTS.map((a) => (
          <button key={a.id} role="radio" aria-checked={acct.id === a.id} onClick={() => pick(a)}>
            <b>{a.label}</b>
            <small>{a.note}</small>
          </button>
        ))}
      </div>

      <main id="view" role="tabpanel">
        {tab === "paddock" && <PaddockView acct={acct} live={live} error={error} events={events} status={status} />}
        {tab === "activity" && <ActivityView acct={acct} events={events} status={status} />}
        {tab === "agent" && <AgentView runs={runs} status={agent.status} />}
        {tab === "card" && <CardView acct={acct} live={live} events={events} />}
      </main>
    </div>
  );
}
