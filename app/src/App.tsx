import { useEffect, useState } from "react";
import { useEvents, useLive } from "./data";
import { IconActivity, IconCard, IconMandate } from "./icons";
import { PaddockView } from "./views/Paddock";
import { ActivityView } from "./views/Activity";
import { CardView } from "./views/Card";

const TABS = [
  { id: "paddock", label: "Paddock", icon: <IconMandate /> },
  { id: "activity", label: "Activity", icon: <IconActivity /> },
  { id: "card", label: "Card", icon: <IconCard /> },
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

  useEffect(() => {
    const on = () => setTab(fromHash());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  const go = (t: Tab) => { window.location.hash = t; setTab(t); };

  const tabButtons = (cls: string) =>
    TABS.map((t) => (
      <button key={t.id} role="tab" className={cls} aria-selected={tab === t.id} aria-controls="view" onClick={() => go(t.id)}>
        {cls === "rail-tab" && t.icon}
        <span>{t.label}</span>
      </button>
    ));

  return (
    <div className="shell">
      <nav className="rail" aria-label="Halter">
        <a className="rail-logo" href="#paddock" onClick={() => go("paddock")}>
          <img src="/halter-logo.svg" alt="" />
          <span>Halter</span>
        </a>
        <div role="tablist" aria-orientation="vertical" style={{ display: "grid", gap: 4 }}>{tabButtons("rail-tab")}</div>
        <div className="rail-foot">
          <span className="dot" style={{ background: live ? "#7fb08d" : error ? "#d27a66" : "#8f8676" }} />
          <span className="label">{live ? `Hideki · block ${live.block.toLocaleString()}` : error ? "Hideki unreachable" : "Connecting to Hideki"}</span>
        </div>
      </nav>

      <div className="mobile-tabs" role="tablist" aria-label="Halter">{tabButtons("mobile-tab")}</div>

      <main className="main" id="view" role="tabpanel">
        {tab === "paddock" && <PaddockView live={live} error={error} events={events} />}
        {tab === "activity" && <ActivityView events={events} status={status} />}
        {tab === "card" && <CardView live={live} events={events} />}
      </main>
    </div>
  );
}
