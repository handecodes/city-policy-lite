import { ApiSource } from "./api";
import { CloudSource } from "./cloud";
import { ReplaySource } from "./replay";

export * from "./types";
export { ReplaySource, PRESETS, loadRecorded } from "./replay";
export { ApiSource } from "./api";
export { CloudSource } from "./cloud";

const env = import.meta.env;
const SUPABASE_URL: string = env["VITE_SUPABASE_URL"] ?? "";
const SUPABASE_KEY: string = env["VITE_SUPABASE_PUBLISHABLE_KEY"] ?? env["VITE_SUPABASE_ANON_KEY"] ?? "";

/** Optional standalone backend (PLAN.md section 10). Empty means unused. */
export const API_BASE: string = (env["VITE_API_BASE_URL"] ?? "").replace(/\/$/, "");

/** Live runs go through Lovable Cloud when it is connected, otherwise through API_BASE if set. */
export const liveSource =
  SUPABASE_URL && SUPABASE_KEY ? CloudSource(SUPABASE_URL.replace(/\/$/, ""), SUPABASE_KEY) : API_BASE ? ApiSource(API_BASE) : null;
export const defaultSource = ReplaySource;
