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
  type Scenario as Case,
  type EdgeCollection,
  type Subscription,
} from "@/lib/source";
import { MapView } from "./MapView";
import { Plaque } from "./Plaque";
import { EvidenceList, HypothesisList, StepList } from "./Steps";
import { EMPTY, PHASE, SCENARIOS, chipFor, configureScenarios, fmt } from "./model";

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
  const [notice, setNotice] = useState<string | null>(null);
  const [kase, setKase] = useState<Case | undefined>();
  const [startedAt, setStartedAt] = useState(0);
  const [now, setNow] = useState(0);
  const failedLive = useRef<string | null>(null);
  const [activeMode, setActiveMode] = useState<"replay" | "live">("replay");

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
      if (r.scenario) setKase(r.scenario);
      configureScenarios(r.scenario?.experiment_prefix, r.meta?.filter_sites, r.scenario?.demand);
      setTotalSims(r.events.filter((e) => e.type === "simulation_finished").length);
    }).catch(() => {});
    return () => sub.current?.cancel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceMode]);

  const replay = source.mode === "replay";
  const E = (current && experiments[current]) || EMPTY;
  const sc = SCENARIOS.find((s) => s.id === current);
  const simsDone = events.filter((e) => e.type === "simulation_finished").length;

  // Elapsed-seconds clock for live runs.
  useEffect(() => {
    if (phase !== "running") return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [phase]);

  const start = async (ev?: React.FormEvent, from: DataSource = source) => {
    ev?.preventDefault();
    setError(null);
    failedLive.current = null;
    setActiveMode(from.mode);
    setStartedAt(Date.now());
    setNow(Date.now());
    if (from === ReplaySource) setNotice((n) => (n && n.startsWith("Live") ? n : null));
    else setNotice(null);
    setEvents([]);
    setExperiments({});
    setCurrent(null);
    setResult(null);
    finished.current = false;
    setPhase("running");
    try {
      const area = presets?.recorded?.area ?? "paris-hdv";
      const policy = presets?.recorded?.policy ?? "quays:FC";
      const id = await from.startRun({ area, policy, demand, budget });
      runId.current = id;
      const handlers = from === source ? [onEvent, onDone] as const : [makeOnEvent(from), makeOnDone(from)] as const;
      sub.current = from.subscribe(id, handlers[0], handlers[1]);
    } catch (err) {
      if (from.mode === "live") {
        fallBack(err instanceof Error ? err.message : "the run could not start");
        return;
      }
      setError(err instanceof Error ? err.message : "The run could not start.");
      setPhase("setup");
    }
  };

  // Live runs can fail (quota, outage). Show a short notice and play the recorded run instead.
  const fallBack = (why: string) => {
    sub.current?.cancel();
    setNotice(`Live runs are unavailable right now (${why}). Showing the recorded run instead.`);
    setEvents([]);
    finished.current = false;
    start(undefined, ReplaySource);
  };

  const makeOnEvent = (from: DataSource) => (e: RunEvent) => {
    if (e.type === "run_failed") {
      failedLive.current = String(e["error"] ?? "the run failed");
      return;
    }
    setEvents((prev) => [...prev, e]);
    const id = e.experiment_id;
    if (e.type === "simulation_finished" && id && !String(id).includes("BASE")) {
      from.getExperiment(runId.current!, id).then((x) => {
        if (!x || finished.current) return;
        setExperiments((prev) => ({ ...prev, [id]: x }));
        setCurrent(id);
      });
    }
  };

  const makeOnDone = (from: DataSource) => async () => {
    if (failedLive.current) {
      fallBack(failedLive.current);
      return;
    }
    finished.current = true;
    try {
      const R = await from.getRun(runId.current!);
      if (R.scenario) {
        setKase(R.scenario);
        configureScenarios(R.scenario.experiment_prefix, R.meta?.filter_sites, R.scenario.demand);
      }
      setResult(R);
      if (R.meta) setMeta(R.meta);
      setExperiments(R.experiments);
      setCurrent(SCENARIOS.find((s) => R.experiments[s.id])?.id ?? Object.keys(R.experiments)[0] ?? null);
      setPhase("done");
      setTab("map");
    } catch (err) {
      if (from.mode === "live") return fallBack(err instanceof Error ? err.message : "no results");
      setError(err instanceof Error ? err.message : "The results could not load.");
      setPhase("setup");
    }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const onEvent = useCallback(makeOnEvent(source), [source]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const onDone = useCallback(makeOnDone(source), [source]);

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
      fixes: fixes.length ? (fixesJam ? (fixes.length === 2 ? "both fixes gridlock" : "every fix gridlocks") : `${fixes.length} fixes tried`) : "no fixes tried",
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
          <h1>{kase ? `${kase.policy.street} closed to ${kase.policy.direction} cars` : "Loading the case…"}</h1>
          <div className="meta">
            {kase ? `${kase.policy.from} to ${kase.policy.to} · ${kase.city}, ${kase.area_name} · ${fmt(kase.demand.trips_per_hour)} trips/h · 3 seeds` : "\u00a0"}
          </div>
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
                {(kase?.always_closed_to_cars ?? ["Rue de Rivoli"]).join(", ")}, no through cars
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
                <dl className="case">
                  <div><dt>Study area</dt><dd>{kase ? `${kase.city} · ${kase.area_name}` : "…"}</dd></div>
                  <div><dt>Policy</dt><dd>{kase?.policy_label ?? "…"}</dd></div>
                  <div><dt>Demand</dt><dd>Normal, {fmt(kase?.demand.trips_per_hour ?? 1200)} car trips/h. The agent also tests low and high demand.</dd></div>
                  <div><dt>Simulation budget</dt><dd>6 simulations, 3 seeds each</dd></div>
                </dl>
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
                    ? liveSource
                      ? "Plays back a recorded run, step by step. Pick Live agent to run SUMO and Nemotron for real."
                      : "Plays back a recorded run, step by step. Live runs unlock when Lovable Cloud is connected."
                    : "Starts a fresh run in a Nebius sandbox: SUMO simulates, Nemotron picks each experiment. Takes about 1.5 minutes."}
                </p>
                <div className="checks">
                  <span>The agent checks</span>
                  <ul>
                    <li>Residential streets: over +{kase?.checks.C1_min_pct ?? 30}% and +{kase?.checks.C1_min_cars_per_h ?? 100} cars/h</li>
                    <li>Total delay: over +{kase?.checks.C2_min_pct ?? 10}% and +{kase?.checks.C2_min_vehh ?? 20} veh·h</li>
                    <li>Gridlock: stuck vehicles or unfinished trips</li>
                  </ul>
                </div>
                {notice && <p className="notice" role="status">{notice}</p>}
                {error && <p className="err" role="alert">{error}</p>}
                <button type="submit" className="run" disabled={!presets || !kase}>Run crash-test</button>
              </form>
            )}

            {phase === "running" && (
              <div className="feed">
                <div className="fhead">
                  <b>{PHASE[events[events.length - 1]?.phase ?? ""] ?? "Starting"}</b>
                  <span className="num">
                    {simsDone} of {totalSims || "…"} simulations
                    {activeMode === "live" && ` · ${Math.max(0, Math.round((now - startedAt) / 1000))} s`}
                  </span>
                  {activeMode === "replay" && (
                    <button type="button" className="ghost" onClick={() => sub.current?.flush()}>Skip to results</button>
                  )}
                </div>
                <div className="pbar" aria-hidden="true"><i style={{ width: totalSims ? `${Math.min(100, (simsDone / totalSims) * 100)}%` : "0%" }} /></div>
                {notice && <p className="notice" role="status">{notice}</p>}
                {activeMode === "live" && events.length === 0 && <p className="hint">Starting a Nebius sandbox. The first steps show up after about 20 seconds.</p>}
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
                ? "In this recorded run, NVIDIA Nemotron on Nebius Token Factory chose each experiment."
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
              <p className="pnote">Evidence cards come with the case file and are written by the team, not searched live.</p>
            </div>
            <div>
              <h3>Assumptions</h3>
              <ul className="list">
                <li>The study area is a small box around {kase?.area_name ?? "the closed street"}, so longer detours are invisible.</li>
                <li>Demand is synthetic, not yet calibrated to {kase?.city ?? "local"} traffic counts.</li>
                <li>
                  {(kase?.always_closed_to_cars ?? ["Rue de Rivoli"]).join(", ")} {kase?.always_closed_to_cars.length === 1 ? "is" : "are"} closed to through cars
                  {kase?.always_closed_reason ? ` (${kase.always_closed_reason})` : ""}. Buses, taxis, bikes and pedestrians aren't simulated.
                </li>
                <li>No traffic disappears: nobody switches to the metro or travels later.</li>
                <li>Over the limit means more than +{kase?.checks.C1_min_pct ?? 30}% and +{kase?.checks.C1_min_cars_per_h ?? 100} cars/h, in at least 2 of 3 seeds.</li>
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
