// Live runs through Tong's Lovable Cloud edge function "crashtest-run"
// (supabase/functions/crashtest-run). The function holds the Nebius key and starts a
// Token Factory Sandbox that runs SUMO and Nemotron. A run takes about 1.5 minutes.
//   POST {}      -> { id }
//   POST { id }  -> { status, events, bundle, error }   (poll every ~2 s)
import type { DataSource, Experiment, RunEvent, RunState } from "./types";
import { PRESETS, loadRecorded } from "./replay";

type Poll = {
  status: string;
  events?: RunEvent[];
  bundle?: { scenario?: RunState["scenario"]; run: Omit<RunState, "evidence"> } | null;
  error?: string | null;
};

export function CloudSource(url: string, key: string): DataSource {
  const call = async (body: object): Promise<Poll & { id?: string }> => {
    const r = await fetch(`${url}/functions/v1/crashtest-run`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: key, Authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.error) throw new Error(j.error ?? `Live run failed (${r.status})`);
    return j;
  };
  const results = new Map<string, RunState>();

  return {
    mode: "live",
    async presets() {
      return PRESETS;
    },
    async startRun() {
      const j = await call({});
      if (!j.id) throw new Error("The live run did not start.");
      return j.id;
    },
    subscribe(id, onEvent, onDone) {
      let seen = 0;
      let stopped = false;
      let timer: ReturnType<typeof setTimeout> | null = null;
      const tick = async () => {
        if (stopped) return;
        try {
          const p = await call({ id });
          const ev = p.events ?? [];
          for (; seen < ev.length; seen++) onEvent(ev[seen]!);
          if (p.status === "SUCCESS" && p.bundle) {
            const run = p.bundle.run;
            const scenario = p.bundle.scenario;
            const recorded = await loadRecorded().catch(() => null);
            results.set(id, {
              ...run,
              scenario,
              meta: recorded?.meta,
              evidence: scenario?.evidence ?? run.events.filter((e) => e.type === "evidence_found").map((e) => e["card"]),
            } as RunState);
            stopped = true;
            onDone();
            return;
          }
          if (p.status === "FAILED") throw new Error(p.error ?? "The live run failed.");
        } catch (err) {
          stopped = true;
          onEvent({ type: "run_failed", error: err instanceof Error ? err.message : String(err) });
          onDone();
          return;
        }
        timer = setTimeout(tick, 2000);
      };
      timer = setTimeout(tick, 1500);
      const stop = () => {
        stopped = true;
        if (timer) clearTimeout(timer);
      };
      return { cancel: stop, flush: stop };
    },
    async getRun(id) {
      const r = results.get(id);
      if (!r) throw new Error("The live run did not finish.");
      return r;
    },
    async getExperiment(id, expId): Promise<Experiment | null> {
      // Per-street changes only arrive with the final bundle.
      return results.get(id)?.experiments[expId] ?? null;
    },
  };
}
