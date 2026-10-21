import { EXPLORER } from "../config";
import type { Kind, Row } from "../data";

const TAG: Record<Kind, [string, string]> = {
  allowed: ["ok", "Allowed"],
  pair: ["ok", "Pair"],
  blocked: ["block", "Blocked"],
  guard: ["guard", "Guard"],
  owner: ["owner", "Owner"],
};

const when = (t: number) => {
  const d = new Date(t * 1000);
  return `${d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" })} ${d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;
};

/** The event tape: one line per Halter event, each linked to its transaction. */
export function Tape({ rows }: { rows: Row[] }) {
  return (
    <ul className="rows">
      {rows.map((r) => {
        const [cls, label] = TAG[r.kind];
        return (
          <li key={r.key}>
            <span className="when dim num">{when(r.time)}</span>
            <span><span className={`tag ${cls}`}>{r.kind === "guard" && r.count ? `Check ×${r.count}` : label}</span></span>
            <span className="what">
              {r.title} {r.demo && <span className="tag demo">Demo threshold</span>}
              {r.detail && <small>{r.detail}</small>}
            </span>
            <a className="tx" href={`${EXPLORER}/tx/${r.tx}`} target="_blank" rel="noreferrer" title={`Halter ${r.version} · ${r.tx}`}>
              {r.tx.slice(0, 10)}… {r.version}
            </a>
          </li>
        );
      })}
    </ul>
  );
}
