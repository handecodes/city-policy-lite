// Talks to the FastAPI backend (PLAN.md section 10).
//   GET  /api/presets
//   POST /api/runs                     -> { run_id }
//   GET  /api/runs/{id}/stream         (SSE, one JSON event per message)
//   GET  /api/runs/{id}/events?after=n (polling fallback)
//   GET  /api/runs/{id}                -> RunState
// No API keys live here. The backend holds them.
import type { DataSource, RunEvent, RunState } from "./types";

export function ApiSource(base: string): DataSource {
  const get = <T,>(path: string): Promise<T> =>
    fetch(base + path).then((r) => {
      if (!r.ok) throw new Error(`${path} failed (${r.status})`);
      return r.json() as Promise<T>;
    });

  return {
    mode: "live",
    presets: () => get("/api/presets"),
    startRun: (cfg) =>
      fetch(base + "/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cfg),
      })
        .then((r) => {
          if (!r.ok) throw new Error(`Starting the run failed (${r.status})`);
          return r.json();
        })
        .then((j) => j.run_id as string),
    subscribe(id, onEvent, onDone) {
      let n = 0;
      let es: EventSource | null = null;
      let poll: ReturnType<typeof setInterval> | null = null;
      let stopped = false;
      const stop = () => {
        stopped = true;
        es?.close();
        if (poll) clearInterval(poll);
      };
      const handle = (e: RunEvent) => {
        if (e.seq != null && e.seq < n) return; // already seen
        n = Math.max(n, (e.seq ?? n) + 1);
        onEvent(e);
        if (e.type === "report_ready" || e.type === "run_failed") {
          stop();
          onDone();
        }
      };
      const startPoll = () => {
        if (poll || stopped) return;
        poll = setInterval(() => {
          get<RunEvent[]>(`/api/runs/${id}/events?after=${n}`)
            .then((list) => list.forEach(handle))
            .catch(() => {});
        }, 2000);
      };
      try {
        es = new EventSource(`${base}/api/runs/${id}/stream`);
        es.onmessage = (m) => handle(JSON.parse(m.data));
        es.onerror = () => {
          es?.close();
          startPoll();
        };
      } catch {
        startPoll();
      }
      return { cancel: stop, flush: stop };
    },
    getRun: (id) => get<RunState>(`/api/runs/${id}`),
    async getExperiment(id, expId) {
      const run = await get<RunState>(`/api/runs/${id}`);
      return run.experiments?.[expId] ?? null;
    },
  };
}
