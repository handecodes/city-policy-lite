// Plays back a recorded run from public/replays/. Works with no backend.
import type { DataSource, Presets, RunState, EvidenceCard } from "./types";

export const PRESETS: Presets = {
  areas: [{ id: "paris-hdv", name: "Paris Centre · Hôtel de Ville" }],
  policies: [
    {
      id: "quays:FC",
      area: "paris-hdv",
      name: "Close Quai de l'Hôtel de Ville eastbound",
      segment: "Rue de Brosse to Pont Louis-Philippe",
    },
  ],
  demand: [
    { id: "DL", name: "Low", trips: 1020 },
    { id: "DN", name: "Normal", trips: 1200 },
    { id: "DH", name: "High", trips: 1380 },
  ],
  budgets: [4, 6, 8],
  recorded: { area: "paris-hdv", policy: "quays:FC", demand: "DN", budget: 6 },
};

let cache: Promise<RunState> | null = null;

export function loadRecorded(url = "/replays/sample_run.json"): Promise<RunState> {
  if (!cache) {
    cache = fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`Could not load the recorded run (${r.status})`);
        return r.json();
      })
      .then((raw) => {
        const evidence: EvidenceCard[] =
          raw.evidence ??
          raw.events.filter((e: { type: string }) => e.type === "evidence_found").map((e: { card: EvidenceCard }) => e.card);
        return { ...raw, evidence } as RunState;
      });
    cache.catch(() => {
      cache = null;
    });
  }
  return cache;
}

export const ReplaySource: DataSource = {
  mode: "replay",
  async presets() {
    return PRESETS;
  },
  async startRun() {
    await loadRecorded();
    return "replay-" + Date.now();
  },
  subscribe(_runId, onEvent, onDone) {
    let i = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;
    let events: RunState["events"] = [];
    const step = () => {
      if (stopped) return;
      if (i >= events.length) {
        onDone();
        return;
      }
      const e = events[i++]!;
      onEvent(e);
      const nx = events[i];
      const gap = nx && nx.t != null && e.t != null ? (nx.t - e.t) * 1100 : 0;
      timer = setTimeout(step, Math.max(gap, 170));
    };
    loadRecorded().then((run) => {
      events = run.events;
      if (!stopped) timer = setTimeout(step, 250);
    });
    return {
      cancel() {
        stopped = true;
        if (timer) clearTimeout(timer);
      },
      flush() {
        stopped = true;
        if (timer) clearTimeout(timer);
        while (i < events.length) onEvent(events[i++]!);
        onDone();
      },
    };
  },
  getRun: () => loadRecorded(),
  async getExperiment(_runId, id) {
    const run = await loadRecorded();
    return run.experiments[id] ?? null;
  },
};
