import { useRef, useState } from "react";
import type { LiveState } from "../chain";
import { marketOf, short, type Account } from "../config";
import { stats, type RawEvent } from "../data";

const REPO = "https://github.com/nftkingiii/halter";
const SERIF = "Georgia, 'Times New Roman', serif"; // system fonts keep the PNG export identical
const SANS = "Helvetica, Arial, sans-serif";

export function CardView({ acct, live, events }: { acct: Account; live: LiveState | null; events: RawEvent[] | null }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [busy, setBusy] = useState(false);
  const s = events ? stats(events) : null;
  const m = live?.mandate;
  const names = live?.markets.map((x) => marketOf(x.pool)) ?? [];
  const cap = live?.markets[0] ? `$${(Number(live.markets[0].cap) / 1e18).toFixed(0)} each` : "";
  const lines = live && m
    ? [
        `Paddock: ${names.join(" and ")}, up to ${cap}, ${m.maxLeverageX100 / 100}× leverage max`,
        acct.subscriptionId ? `Guard at ${m.guardHealthBps / 10_000}× maintenance, run every epoch by Somnia Reactivity` : `Every order checked on chain by Halter before it reaches dreamDEX`,
      ]
    : ["Reading the paddock from Hideki…", ""];
  const tiles = [
    { v: s?.allowed, k: "orders allowed" },
    { v: s?.blocked, k: "orders blocked", accent: true },
    { v: s?.checks, k: "guard checks by the chain" },
    { v: s?.fired, k: "times the guard cut risk" },
  ];

  async function download() {
    if (!svgRef.current) return;
    setBusy(true);
    try {
      // Give the copy an explicit size, or the browser rasterises it small and the PNG blurs.
      const copy = svgRef.current.cloneNode(true) as SVGSVGElement;
      copy.setAttribute("width", "2400");
      copy.setAttribute("height", "1350");
      const xml = new XMLSerializer().serializeToString(copy);
      const img = new Image();
      img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`;
      await img.decode();
      const c = document.createElement("canvas");
      c.width = 2400; c.height = 1350; // 2x for crisp posting
      c.getContext("2d")!.drawImage(img, 0, 0, 2400, 1350);
      const a = document.createElement("a");
      a.href = c.toDataURL("image/png");
      a.download = "halter-paddock.png";
      a.click();
    } finally {
      setBusy(false);
    }
  }

  const draft = s
    ? `My bot trades my @DreamDEXSomnia perps account inside a paddock: ${s.allowed} orders allowed, ${s.blocked} blocked on chain, and the guard checked by Somnia Reactivity ${s.checks} times with no keeper.\n\n${REPO}`
    : "";

  return (
    <>
      <section className="plate" style={{ marginTop: 24 }}>
        <span className="screw l">+</span><span className="screw r">+</span>
        <span className="eng">Card · built from Halter's own events on Hideki</span>
        <h1 className="sentence" style={{ marginBottom: 6 }}>Show your paddock. Every number on it can be checked on chain.</h1>
      </section>

      <div className="card-wrap">
        <svg ref={svgRef} className="card-svg" viewBox="0 0 1200 675" xmlns="http://www.w3.org/2000/svg" role="img"
          aria-label={`Halter card: ${s?.allowed ?? 0} orders allowed, ${s?.blocked ?? 0} blocked, ${s?.checks ?? 0} guard checks`}>
          <rect width="1200" height="675" fill="#14120F" /><rect x="10" y="10" width="1180" height="655" rx="8" fill="none" stroke="#C9A46A" strokeOpacity=".18" />
          <g transform="translate(64 54) scale(0.15)">
            <path d="M158 232 Q 256 336 354 232" fill="none" stroke="#D9895B" strokeWidth="26" strokeLinecap="round" />
            <circle cx="256" cy="318" r="30" fill="none" stroke="#D9895B" strokeWidth="20" />
            <rect x="136" y="112" width="44" height="288" rx="22" fill="#F2EBDD" />
            <rect x="332" y="112" width="44" height="288" rx="22" fill="#F2EBDD" />
          </g>
          <text x="144" y="100" fill="#C9A46A" fontFamily={SERIF} fontSize="32">Halter</text>
          <text x="72" y="214" fill="#F6F1E7" fontFamily={SERIF} fontSize="56">My agent trades inside a paddock.</text>
          {lines.map((l, i) => (
            <text key={i} x="72" y={270 + i * 36} fill="#C9A46A" fontFamily={SANS} fontSize="24">{l}</text>
          ))}
          {tiles.map((t, i) => (
            <g key={t.k} transform={`translate(${72 + i * 270} 400)`}>
              <rect width="246" height="160" rx="18" fill="#1F1B16" stroke="#3A342B" />
              <text x="24" y="86" fill={t.accent ? "#E07A45" : "#EDE4D3"} fontFamily={SERIF} fontSize="64">{t.v ?? "–"}</text>
              <text x="24" y="128" fill="#C9A46A" fontFamily={SANS} fontSize="19">{t.k}</text>
            </g>
          ))}
          <text x="72" y="622" fill="#857D70" fontFamily={SANS} fontSize="17">
            {acct.label} · {acct.halterLabel} {short(acct.halter)} · dreamDEX perps · Somnia Hideki testnet · github.com/nftkingiii/halter
          </text>
        </svg>

        <div style={{ display: "grid", gap: 12, alignContent: "start" }}>
          <button className="btn" onClick={download} disabled={busy || !s}>{busy ? "Rendering…" : "Download PNG"}</button>
          {s ? (
            <a className="btn ghost" href={`https://x.com/intent/post?text=${encodeURIComponent(draft)}`} target="_blank" rel="noreferrer">Draft a post on X</a>
          ) : (
            <button className="btn ghost" disabled>Draft a post on X</button>
          )}
          <p className="muted small" style={{ margin: 0 }}>
            Counts include Halter v1 and v2 on Hideki testnet. The X button opens a draft in a new tab; nothing posts until you send it.
          </p>
        </div>
      </div>
    </>
  );
}
