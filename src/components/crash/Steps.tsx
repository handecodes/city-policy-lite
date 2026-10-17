import type { ReactNode } from "react";
import type { RunEvent, Hypothesis, EvidenceCard, Violation } from "@/lib/source";
import { PHASE, SCENARIOS, fmt, lc } from "./model";

type Item = { what: string; why?: string | undefined; res?: ReactNode; exp?: string | undefined };

function itemsFor(phase: string, ev: RunEvent[]): Item[] {
  const out: Item[] = [];
  if (phase === "research") {
    const n = ev.filter((e) => e.type === "evidence_found").length;
    out.push({ what: n ? `Collected ${n} evidence cards` : "Searching for evidence" });
  }
  if (phase === "hypotheses") {
    const nb = ev.find((e) => e.type === "network_brief");
    const hs = ev.filter((e) => e.type === "hypothesis_created");
    const top = nb ? nb["brief"].detour_ranking.slice(0, 3).map((r: { street: string }) => r.street).join(", ") : "";
    out.push({ what: hs.length ? `Wrote ${hs.length} testable hypotheses` : "Reading the street network", why: top ? "Likely detours: " + top : undefined });
  }
  if (phase === "baseline") {
    const f = ev.filter((e) => e.type === "simulation_finished");
    if (f.length) f.forEach((e) => out.push({ what: "Simulated today's traffic", res: `Total delay ${fmt(e["delay_vehh"])} veh·h, no stuck vehicles.` }));
    else out.push({ what: "Simulating today's traffic" });
  }
  ev.forEach((e, i) => {
    if (e.type !== "decision" || e["decision"]?.action !== "run") return;
    const id: string = e["decision"].experiment_id;
    const rest = ev.slice(i);
    const fin = rest.find((x) => x.type === "simulation_finished" && x.experiment_id === id);
    const vs: Violation[] = rest.filter((x) => x.type === "violation_detected" && x.experiment_id === id).map((x) => x["violation"]);
    const rejected = rest.some((x) => x.type === "mitigation_rejected" && x.experiment_id === id);
    const sc = SCENARIOS.find((s) => s.id === id);
    const res = (
      <>
        {vs.length ? (
          <span className="bad">
            {vs
              .map((v) =>
                v.street
                  ? `${v.street} +${fmt(v.delta)} cars/h`
                  : v.constraint === "C3"
                    ? `gridlock (${fmt(v.value)} stuck vehicles per run)`
                    : `delay ${fmt(v.base)} → ${fmt(v.value)} veh·h`,
              )
              .join(", ")}
          </span>
        ) : fin ? (
          "No limit crossed."
        ) : (
          "Simulating…"
        )}
        {rejected && " Fix rejected."}
      </>
    );
    out.push({ what: sc ? sc.t : id, why: e["decision"].rationale, res, exp: id });
  });
  if (phase === "report") out.push({ what: "Wrote the Policy Failure Report" });
  return out;
}

export function StepList({
  events,
  compact,
  onShow,
  listRef,
}: {
  events: RunEvent[];
  compact?: boolean;
  onShow?: (experimentId: string) => void;
  listRef?: React.Ref<HTMLOListElement>;
}) {
  const phases: { phase: string; t: number; ev: RunEvent[] }[] = [];
  for (const e of events) {
    if (!e.phase) continue;
    const cur = phases[phases.length - 1];
    if (!cur || cur.phase !== e.phase) phases.push({ phase: e.phase, t: e.t ?? 0, ev: [e] });
    else cur.ev.push(e);
  }
  return (
    <ol className={"steps" + (compact ? " compact" : "")} ref={listRef} aria-live={compact ? "polite" : undefined}>
      {phases.map((ph, pi) => (
        <li className="phase" key={ph.phase + pi}>
          <div>
            <h3>{PHASE[ph.phase] ?? ph.phase}</h3>
            <div className="time num">{ph.t.toFixed(1)} s</div>
          </div>
          <ul className="items">
            {itemsFor(ph.phase, ph.ev).map((it, i) => (
              <li className="item" key={i}>
                <div className="what">{it.what}</div>
                {it.why && <div className="why">{it.why}</div>}
                {it.res && <div className="res">{it.res}</div>}
                {!compact && it.exp && onShow && SCENARIOS.some((s) => s.id === it.exp) && (
                  <button type="button" className="show" onClick={() => onShow(it.exp!)}>
                    Show on map
                  </button>
                )}
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ol>
  );
}

export function HypothesisList({ items }: { items: Hypothesis[] }) {
  return (
    <ul className="hyps">
      {items.map((h) => {
        const sc = SCENARIOS.find((s) => s.id === h.experiment_id);
        const yes = h.status === "supported";
        return (
          <li className="hyp" key={h.id}>
            <div className="id">{h.id}</div>
            <div>
              <div>{h.text}</div>
              <div className="ev">
                Settled by: {sc ? lc(sc.t) : h.experiment_id}
                {h.evidence.length ? " · Evidence: " + h.evidence.join(", ") : ""}
              </div>
            </div>
            <div className={"status " + (yes ? "yes" : "no")}>
              {yes ? (
                <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
              ) : (
                <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /></svg>
              )}
              {yes ? "Supported" : "Refuted"}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function EvidenceList({ items }: { items: EvidenceCard[] }) {
  return (
    <ul className="list">
      {items.map((c) => (
        <li key={c.id}>
          <span className="eid">{c.id}</span>
          {c.claim}
          <span className="src">{c.source}</span>
        </li>
      ))}
    </ul>
  );
}
