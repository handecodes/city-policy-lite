// Types for the backend contract in PLAN.md section 10.
// Both data sources (recorded replay and live API) speak this shape.

export type Violation = {
  key: string;
  constraint: "C1" | "C2" | "C3" | string;
  street: string | null;
  seeds_hit: number;
  seeds: number;
  robust: boolean;
  base: number;
  value: number;
  delta: number;
  delta_range: [number, number];
  pct: number;
  severity?: string;
};

export type Experiment = {
  goals: Record<string, { met: boolean; drop_pct?: number }>;
  violations: Violation[];
  robust_violations: string[];
  target_volume: { base: number; value: number };
  delay_vehh: { base: number; value: number };
  teleports: number;
  unfinished: number;
  edge_delta: Record<string, number>;
  label?: string;
};

export type EdgeProps = { id: string; street: string; closed: boolean; restricted: boolean };
export type EdgeFeature = { type: "Feature"; properties: EdgeProps; geometry: { type: "LineString"; coordinates: [number, number][] } };
export type EdgeCollection = { type: "FeatureCollection"; features: EdgeFeature[] };

export type EvidenceCard = { id: string; source: string; claim: string; tags?: string[] };

export type Hypothesis = {
  id: string;
  text: string;
  experiment_id: string;
  check?: string;
  expect?: boolean;
  evidence: string[];
  status: "supported" | "refuted" | "open" | string;
};

export type RunEvent = {
  seq?: number;
  t?: number;
  phase?: string;
  type: string;
  experiment_id?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
};

export type RunState = {
  events: RunEvent[];
  experiments: Record<string, Experiment>;
  hypotheses: Hypothesis[];
  evidence: EvidenceCard[];
  verdict: string;
  meta?: RunMeta;
  scenario?: Scenario;
};

/** The case being crash-tested: a copy of the engine's scenario.json. */
export type Scenario = {
  id: string;
  city: string;
  area_name: string;
  bbox: [number, number, number, number];
  policy: { street: string; from: string; to: string; direction: string };
  policy_label: string;
  always_closed_to_cars: string[];
  always_closed_reason?: string;
  demand: { trips_per_hour: number; low: number; high: number };
  checks: { G1_min_drop_pct: number; C1_min_pct: number; C1_min_cars_per_h: number; C2_min_pct: number; C2_min_vehh: number };
  experiment_prefix: string;
  evidence: EvidenceCard[];
};

export type RunMeta = {
  area: string;
  policy: string;
  demand: string;
  budget: number;
  seeds?: number[];
  planner?: string;
  filter_sites?: Record<string, { street: string; edges: string[] }>;
  street_label_anchors?: Record<string, [number, number]>;
};

export type Presets = {
  areas: { id: string; name: string }[];
  policies: { id: string; area: string; name: string; segment?: string }[];
  demand: { id: string; name: string; trips: number }[];
  budgets: number[];
  recorded?: { area: string; policy: string; demand: string; budget: number };
};

export type RunConfig = { area: string; policy: string; demand: string; budget: number };

export type Subscription = { cancel(): void; flush(): void };

export interface DataSource {
  mode: "replay" | "live";
  presets(): Promise<Presets>;
  startRun(config: RunConfig): Promise<string>;
  subscribe(runId: string, onEvent: (e: RunEvent) => void, onDone: () => void): Subscription;
  getRun(runId: string): Promise<RunState>;
  /** One experiment's results, used to colour the map while a run is still going. */
  getExperiment(runId: string, experimentId: string): Promise<Experiment | null>;
}
