import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReplaySource,
  liveSource,
  loadRecorded,
  type DataSource,
  type Experiment,
  type Presets,
  type RunEvent,
  type RunMeta,
  type RunState,
  type EdgeCollection,
  type Subscription,
} from "@/lib/source";
import { MapView } from "./MapView";
import { Plaque } from "./Plaque";
import { EvidenceList, HypothesisList, StepList } from "./Steps";
import { EMPTY, PHASE, SCENARIOS, chipFor, fmt } from "./model";

type Phase = "setup" | "running" | "done";
type Tab = "map" | "steps" | "hypotheses" | "limits";

export function CrashTest() {
  const [phase, setPhase] = useState<Phase>("setup");
  const [presets, setPresets] = useState<Presets | null>(null);
  const [sourceMode, setSourceMode] = useState<"replay" | "live">("replay");
  const [demand, setDemand] = useState("DN");
  const [budget, setBudget] = useState(6);
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [experiments, setExperiments] = useState<Record<string, Experiment>>({});
  const [current, setCurrent] = useState<string | null>(null);
  const [result, setResult] = useState<RunState | null>(null);
  const [meta, setMeta] = useState<RunMeta | undefined>();
  const [totalSims, setTotalSims] = useState(0);
  const [threshold, setThreshold] = useState(10);
  const [street, setStreet] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("map");
  const [error, setError] = useState<string | null>(null);

  const source: DataSource = sourceMode === "live" && liveSource ? liveSource : ReplaySource;
  const sub = useRef<Subscription | null>(null);
  const runId = useRef<string | null>(null);
  const finished = useRef(false);
  const feedRef = useRef<HTMLOListElement>(null);

  useEffect(() => {
    source.presets().then((p) => {
      setPresets(p);
      if (p.recorded) {
        setDemand(p.recorded.demand);
        setBudget(p.recorded.budget);
      }
    }).catch(() => setError("Could not load the study areas."));
    // Recorded run gives the map its label anchors before any run starts.
    loadRecorded().then((r) => {
      setMeta(r.meta);
      setTotalSims(r.events.filter((e) => e.type === "simulation_finished").length);
    }).catch(() => {});
    return () => sub.current?.cancel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceMode]);

  const replay = source.mode === "replay";
  const E = (current && experiments[current]) || EMPTY;
  const sc = SCENARIOS.find((s) => s.id === current);
  const simsDone = events.filter((e) => e.type === "simulation_finished").length;

  const start = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setError(null);
    setEvents([]);
    setExperiments({});
    setCurrent(null);
    setResult(null);
    finished.current = false;
    setPhase("running");
    try {
      const area = presets?.recorded?.area ?? "paris-hdv";
      const policy = presets?.recorded?.policy ?? "quays:FC";
      const id = await source.startRun({ area, policy, demand, budget });
      runId.current = id;
      sub.current = source.subscribe(id, onEvent, onDone);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The run could not start.");
      setPhase("setup");
    }
  };

  const onEvent = useCallback(
    (e: RunEvent) => {
      setEvents((prev) => [...prev, e]);
      if (e.type === "run_started" && e["budget"] && source.mode === "live") setTotalSims(e["budget"] + 1);
      const id = e.experiment_id;
      if (e.type === "simulation_finished" && id && !String(id).includes("BASE")) {
        source.getExperiment(runId.current!, id).then((x) => {
          if (!x || finished.current) return;
          setExperiments((prev) => ({ ...prev, [id]: x }));
          setCurrent(id);
        });
      }
    },
    [source],
  );

  const onDone = useCallback(async () => {
    finished.current = true;
    try {
      const R = await source.getRun(runId.current!);
      setResult(R);
      if (R.meta) setMeta(R.meta);
      setExperiments(R.experiments);
      setCurrent(SCENARIOS.find((s) => R.experiments[s.id])?.id ?? Object.keys(R.experiments)[0] ?? null);
      setPhase("done");
      setTab("map");
    } catch (err) {
      setError(err instanceof Error ? err.message : "The results could not load.");
      setPhase("setup");
    }
  }, [source]);

  useEffect(() => {
    const el = feedRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [events]);

  const newRun = () => {
    sub.current?.cancel();
    setCurrent(null);
    setExperiments({});
    setPhase("setup");
    setTab("map");
  };

  const showOnMap = (id: string) => {
    setCurrent(id);
    setTab("map");
    window.scrollTo({ top: 0 });
  };

  const scenarios = SCENARIOS.filter((s) => experiments[s.id]);
  const summary = useMemo(() => {
    if (!result) return null;
    const over = new Set<string>();
    Object.values(result.experiments).forEach((x) => x.violations.filter((v) => v.robust && v.street).forEach((v) => over.add(v.street!)));
    const fixes = SCENARIOS.filter((s) => s.filter && result.experiments[s.id]);
    const fixesJam = fixes.length > 0 && fixes.every((s) => result.experiments[s.id]?.robust_violations.includes("C3"));
    return {
      failed: String(result.verdict).startsWith("FAILS"),
      over: over.size,
      fixes: fixes.length ? (fixesJam ? "both fixes gridlock" : `${fixes.length} fixes tried`) : "no fixes tried",
      sims: result.events.filter((e) => e.type === "simulation_finished").length,
      supported: result.hypotheses.filter((h) => h.status === "supported").length,
    };
  }, [result]);

  const tabs: { id: Tab; label: string; count?: string | undefined }[] = [
    { id: "map", label: "Map" },
    { id: "steps", label: "Agent steps", count: summary ? `${summary.sims} runs` : undefined },
    { id: "hypotheses", label: "Hypotheses", count: result ? `${summary?.supported}/${result.hypotheses.length}` : undefined },
    { id: "limits", label: "Evidence and limits", count: result ? `${result.evidence.length} · 5` : undefined },
  ];
  const onTabKey = (e: React.KeyboardEvent, i: number) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const k = (i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length;
    const t = tabs[k]!;
    setTab(t.id);
    document.getElementById("t-" + t.id)?.focus();
  };

  return (
    <div className="wrap">
      <header className="app">
        <div>
          <div className="brand">City Policy Crash-Test</div>
          <h1>Quai de l'Hôtel de Ville closed to eastbound cars</h1>
          <div className="meta">Rue de Brosse to Pont Louis-Philippe · Paris 4e · {fmt(presets?.demand.find((d) => d.id === demand)?.trips ?? 1200)} trips/h · 3 seeds</div>
        </div>
        <div className="hright">
          <div className="vpill" role="status">
            {phase === "setup" && <b className="neutral">Not run yet</b>}
            {phase === "running" && <b className="running">Running · {simsDone}/{totalSims || "…"}</b>}
            {phase === "done" && summary && (
              <>
                <b className={summary.failed ? "" : "okv"}>{summary.failed ? "Fails" : "Passes"}</b>
                <span>{summary.over} streets over the limit · {summary.fixes}</span>
              </>
            )}
          </div>
          {phase === "done" && (
            <button type="button" className="ghost" onClick={newRun}>New run</button>
          )}
        </div>
      </header>

      {phase === "done" && (
        <div className="tabs" role="tablist" aria-label="Views">
          {tabs.map((t, i) => (
            <button
              key={t.id}
              id={"t-" + t.id}
              type="button"
              role="tab"
              aria-controls={"p-" + t.id}
              aria-selected={tab === t.id}
              tabIndex={tab === t.id ? 0 : -1}
              onClick={() => setTab(t.id)}
              onKeyDown={(e) => onTabKey(e, i)}
            >
              {t.label}
              {t.count && <span className="cnt">{t.count}</span>}
            </button>
          ))}
        </div>
      )}

      <section className="tabp" role="tabpanel" id="p-map" aria-labelledby="t-map" hidden={tab !== "map"}>
        <div className="bench">
          <div>
            <MapView
              experiment={E}
              hasResult={!!current}
              filterSite={sc?.filter}
              threshold={threshold}
              selectedStreet={street}
              onSelectStreet={setStreet}
              meta={meta}
            >
              {phase === "setup" && !street && (
                <div className="idle">Closed segment shown dashed. Run the crash-test to see where traffic goes. Scroll to zoom, drag to move, click a street for details.</div>
              )}
              {E.robust_violations.includes("C3") && <div className="jam">Gridlock: flows drop because traffic is stuck, not because it went away.</div>}
              {street && <StreetCard name={street} experiments={experiments} current={current} onClose={() => setStreet(null)} />}
            </MapView>
            <div className="legend">
              <div className="ramp"><span>Fewer cars</span><i /><span>More cars</span></div>
              <div className="key">
                <svg viewBox="0 0 34 10" aria-hidden="true"><line x1="1" y1="5" x2="33" y2="5" stroke="var(--ink)" strokeWidth="4" strokeDasharray="6 3" /></svg>
                Closed to cars
              </div>
              <div className="key">
                <svg viewBox="0 0 34 10" aria-hidden="true"><line x1="1" y1="5" x2="33" y2="5" stroke="var(--ink-2)" strokeWidth="2" strokeDasharray="1.5 3" strokeLinecap="round" /></svg>
                Rue de Rivoli, no through cars
              </div>
              <div className="thr" role="group" aria-label="Show changes of at least">
                <span>Show changes from</span>
                {[10, 50, 100].map((v) => (
                  <button key={v} type="button" aria-pressed={threshold === v} onClick={() => setThreshold(v)}>{v}</button>
                ))}
                <span>cars/h</span>
              </div>
              {sc?.filter && (
                <div className="key">
                  <svg viewBox="0 0 34 10" aria-hidden="true"><rect x="12" y="0" width="10" height="10" fill="var(--ink)" /><rect x="14" y="2" width="6" height="6" fill="var(--bg)" /></svg>
                  Street filter
                </div>
              )}
            </div>
          </div>

          <div className="side">
            {phase === "setup" && (
              <form className="setup" onSubmit={start} noValidate>
                <h2 className="ph">Set up a crash-test</h2>
                <label className="fld">
                  Study area
                  <select defaultValue={presets?.recorded?.area}>
                    {presets?.areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                </label>
                <label className="fld">
                  Policy
                  <select defaultValue={presets?.recorded?.policy}>
                    {presets?.policies.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </label>
                <fieldset className="fld seg">
                  <legend>Demand</legend>
                  <div className="opts">
                    {presets?.demand.map((d) => (
                      <label key={d.id} title={`${fmt(d.trips)} car trips/h`}>
                        <input type="radio" name="demand" value={d.id} checked={demand === d.id} disabled={replay} onChange={() => setDemand(d.id)} />
                        <span>{d.name}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
                <label className="fld">
                  Simulation budget
                  <select value={budget} disabled={replay} onChange={(e) => setBudget(+e.target.value)}>
                    {presets?.budgets.map((b) => <option key={b} value={b}>{b} simulations</option>)}
                  </select>
                </label>
                <fieldset className="fld seg">
                  <legend>Run from</legend>
                  <div className="opts">
                    <label>
                      <input type="radio" name="source" value="replay" checked={sourceMode === "replay"} onChange={() => setSourceMode("replay")} />
                      <span>Recorded sample</span>
                    </label>
                    <label title={liveSource ? "" : "Backend not connected yet"}>
                      <input type="radio" name="source" value="live" checked={sourceMode === "live"} disabled={!liveSource} onChange={() => setSourceMode("live")} />
                      <span>Live agent</span>
                    </label>
                  </div>
                </fieldset>
                <p className="hint">
                  {replay
                    ? "Plays back a recorded run of this policy at normal demand with 6 simulations. Live runs unlock when the backend is connected."
                    : "Starts a new run on the backend with Nemotron on Nebius Token Factory."}
                </p>
                <div className="checks">
                  <span>The agent checks</span>
                  <ul>
                    <li>Residential streets: over +30% and +100 cars/h</li>
                    <li>Total delay: over +10% and +20 veh·h</li>
                    <li>Gridlock: stuck vehicles or unfinished trips</li>
                  </ul>
                </div>
                {error && <p className="err" role="alert">{error}</p>}
                <button type="submit" className="run" disabled={!presets}>Run crash-test</button>
              </form>
            )}

            {phase === "running" && (
              <div className="feed">
                <div className="fhead">
                  <b>{PHASE[events[events.length - 1]?.phase ?? ""] ?? "Starting"}</b>
                  <span className="num">{simsDone} of {totalSims || "…"} simulations</span>
                  <button type="button" className="ghost" onClick={() => sub.current?.flush()}>Skip to results</button>
                </div>
                <div className="pbar" aria-hidden="true"><i style={{ width: totalSims ? `${(simsDone / totalSims) * 100}%` : "0%" }} /></div>
                {events.length === 0 ? (
                  <div className="feedskel" aria-hidden="true"><i /><i /><i /></div>
                ) : (
                  <StepList events={events} compact listRef={feedRef} />
                )}
              </div>
            )}

            {phase === "done" && (
              <div className="results">
                <div className="scen" role="radiogroup" aria-label="Scenarios">
                  <span className="scen-label">Scenarios</span>
                  {scenarios.map((s, i) => {
                    const on = s.id === current;
                    return (
                      <button
                        key={s.id}
                        id={"opt-" + i}
                        type="button"
                        className="opt"
                        role="radio"
                        aria-checked={on}
                        tabIndex={on ? 0 : -1}
                        onClick={() => setCurrent(s.id)}
                        onKeyDown={(e) => {
                          if (!["ArrowDown", "ArrowRight", "ArrowUp", "ArrowLeft"].includes(e.key)) return;
                          e.preventDefault();
                          const k = (i + (e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : scenarios.length - 1)) % scenarios.length;
                          setCurrent(scenarios[k]!.id);
                          document.getElementById("opt-" + k)?.focus();
                        }}
                      >
                        <span className="t">{s.t}</span>
                        <span className="chip">{chipFor(experiments[s.id]!)}</span>
                      </button>
                    );
                  })}
                </div>
                {current && <Readout E={E} />}
              </div>
            )}
          </div>
        </div>
      </section>

      {result && (
        <>
          <section className="tabp" role="tabpanel" id="p-steps" aria-labelledby="t-steps" hidden={tab !== "steps"}>
            <p className="pnote">
              Verdicts are computed by code from the simulation results.{" "}
              {replay
                ? "This sample used the rule-based stand-in planner; the live version uses NVIDIA Nemotron on Nebius Token Factory."
                : "The planner is NVIDIA Nemotron on Nebius Token Factory."}
            </p>
            <StepList events={result.events} onShow={showOnMap} />
          </section>
          <section className="tabp" role="tabpanel" id="p-hypotheses" aria-labelledby="t-hypotheses" hidden={tab !== "hypotheses"}>
            <HypothesisList items={result.hypotheses} />
          </section>
          <section className="tabp two" role="tabpanel" id="p-limits" aria-labelledby="t-limits" hidden={tab !== "limits"}>
            <div>
              <h3>Evidence</h3>
              <EvidenceList items={result.evidence} />
              {replay && <p className="pnote">Hand-written stand-ins for this sample. The live version finds and quotes sources with Tavily.</p>}
            </div>
            <div>
              <h3>Assumptions</h3>
              <ul className="list">
                <li>Study area is a 1.3 × 1.1 km box around Hôtel de Ville, so longer detours are invisible.</li>
                <li>Demand is synthetic, not yet calibrated to Paris traffic counts.</li>
                <li>Rue de Rivoli is closed to through cars. Buses, taxis, bikes and pedestrians aren't simulated.</li>
                <li>No traffic disappears: nobody switches to the metro or travels later.</li>
                <li>Over the limit means more than +30% and +100 cars/h, in at least 2 of 3 seeds.</li>
              </ul>
            </div>
          </section>
        </>
      )}

      <footer>Street data © OpenStreetMap contributors (ODbL) · Simulation: Eclipse SUMO 1.28</footer>
    </div>
  );
}

function Readout({ E }: { E: Experiment }) {
  const over = E.violations.filter((v) => v.robust && v.street);
  const jam = E.robust_violations.includes("C3");
  const c2 = E.robust_violations.includes("C2");
  const tv = E.target_volume;
  const say =
    (jam ? `Gridlock: ${fmt(E.unfinished)} trips never finish. ` : "") +
    (over.length ? `${over.length} residential street${over.length > 1 ? "s" : ""} over the limit. ` : jam ? "" : "No residential street over the limit. ") +
    `Quay: ${fmt(tv.base)} → ${fmt(tv.value)} cars/h.`;
  return (
    <div className="readout" aria-live="polite">
      <h3>Result</h3>
      <p className="say">{say}</p>
      {over.length > 0 && (
        <ul className="rows">
          {over.map((v) => (
            <li className="row" key={v.key}>
              <Plaque name={v.street!} />
              <div className="fig num">
                <b>+{fmt(v.delta)} cars/h</b>
                <span title={`Across seeds: +${v.delta_range[0]} to +${v.delta_range[1]} cars/h`}>
                  {fmt(v.base)} → {fmt(v.value)} cars/h, +{Math.round(v.pct)}%
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className="sys num">
        <div>
          <div className="k">Total delay</div>
          <div className={"v" + (c2 ? " bad" : "")}>{fmt(E.delay_vehh.base)} → {fmt(E.delay_vehh.value)} veh·h</div>
        </div>
        <div>
          <div className="k">Stuck vehicles</div>
          <div className={"v" + (jam ? " bad" : "")}>{fmt(E.teleports)} per run</div>
        </div>
      </div>
    </div>
  );
}

function StreetCard({
  name,
  experiments,
  current,
  onClose,
}: {
  name: string;
  experiments: Record<string, Experiment>;
  current: string | null;
  onClose: () => void;
}) {
  const [ids, setIds] = useState<{ ids: string[]; closed: boolean } | null>(null);
  useEffect(() => {
    let alive = true;
    fetch("/geo/paris-hdv.geojson")
      .then((r) => r.json())
      .then((g: EdgeCollection) => {
        if (!alive) return;
        const fs = g.features.filter((f) => f.properties.street === name);
        setIds({ ids: fs.map((f) => f.properties.id), closed: fs.some((f) => f.properties.closed) });
      });
    return () => {
      alive = false;
    };
  }, [name]);
  const avail = SCENARIOS.filter((s) => experiments[s.id]);
  const delta = (E: Experiment) => {
    let best = 0;
    ids?.ids.forEach((id) => {
      const d = E.edge_delta[id] || 0;
      if (Math.abs(d) > Math.abs(best)) best = d;
    });
    return best;
  };
  return (
    <div className="scard">
      <div className="sh">
        <b>{name}</b>
        <button type="button" className="x" onClick={onClose}>Close</button>
      </div>
      {ids?.closed && <div className="note">Part of this street is the closed segment.</div>}
      {!avail.length ? (
        <div className="note">Run the crash-test to see how this street changes.</div>
      ) : (
        <>
          <table>
            <tbody>
              {avail.map((s) => {
                const d = delta(experiments[s.id]!);
                const z = Math.abs(d) < 1;
                return (
                  <tr key={s.id} className={s.id === current ? "on" : ""}>
                    <td>{s.t}</td>
                    <td className={z ? "z" : d > 0 ? "u" : "dn"}>{z ? "no change" : `${d > 0 ? "+" : "−"}${fmt(Math.abs(d))} cars/h`}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="note">Change at the busiest point of the street, vs baseline.</div>
        </>
      )}
    </div>
  );
}
