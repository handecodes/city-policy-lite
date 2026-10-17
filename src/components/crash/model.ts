import type { Experiment } from "@/lib/source";

export type Scenario = { id: string; t: string; d: string; filter?: string };

export const SCENARIOS: Scenario[] = [
  { id: "quays:FC.M0.DN", t: "The closure", d: "Normal demand" },
  { id: "quays:FC.F2.DN", t: "With a filter on Rue de Brosse", d: "Fix tried by the agent", filter: "F2" },
  { id: "quays:FC.F1.DN", t: "With a filter on Rue François Miron", d: "Fix tried by the agent", filter: "F1" },
  { id: "quays:FC.M0.DH", t: "At high demand", d: "15% more trips" },
  { id: "quays:FC.M0.DL", t: "At low demand", d: "15% fewer trips" },
];

export const PHASE: Record<string, string> = {
  research: "Research",
  hypotheses: "Hypotheses",
  baseline: "Baseline",
  policy_test: "Policy test",
  mitigation: "Mitigation",
  robustness: "Robustness",
  report: "Report",
};

export const EMPTY: Experiment = {
  goals: {},
  violations: [],
  robust_violations: [],
  target_volume: { base: 0, value: 0 },
  delay_vehh: { base: 0, value: 0 },
  teleports: 0,
  unfinished: 0,
  edge_delta: {},
};

// Light-theme tokens, mirrored in styles.css. The map needs raw values.
export const C = {
  ink: "#1A1F24",
  ink2: "#56606B",
  bg: "#F4F5F7",
  up: "#C23B22",
  down: "#2C6FA3",
  mid: "#B5BCC4",
  plaque: "#1B4B72",
};

export const fmt = (n: number) => Math.round(n).toLocaleString("en-US");
export const lc = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
export const signed = (d: number) => (d > 0 ? "+" : "−") + fmt(Math.abs(d));

function hex(h: string) {
  const s = h.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16));
}
function mix(a: string, b: string, t: number) {
  const A = hex(a);
  const B = hex(b);
  return "rgb(" + A.map((v, i) => Math.round(v + (B[i]! - v) * t)).join(",") + ")";
}
export function colour(d: number, thr: number) {
  if (Math.abs(d) < thr) return C.mid;
  const t = Math.min(Math.abs(d), 200) / 200;
  return mix(C.mid, d > 0 ? C.up : C.down, 0.35 + 0.65 * t);
}
export function width(d: number, thr: number) {
  return Math.abs(d) < thr ? 2 : 2.5 + 6.5 * (Math.min(Math.abs(d), 200) / 200);
}

export function chipFor(E: Experiment) {
  const r = E.robust_violations;
  if (r.includes("C3")) return "Gridlock";
  if (r.some((k) => k.startsWith("C1"))) return "Spillover";
  if (r.includes("C2")) return "Delay";
  return "Passes";
}
