import { ApiSource } from "./api";
import { ReplaySource } from "./replay";

export * from "./types";
export { ReplaySource, PRESETS, loadRecorded } from "./replay";
export { ApiSource } from "./api";

/** Set VITE_API_BASE_URL to the backend URL to unlock live runs. Empty means replay only. */
export const API_BASE: string = (import.meta.env["VITE_API_BASE_URL"] ?? "").replace(/\/$/, "");
export const liveSource = API_BASE ? ApiSource(API_BASE) : null;
export const defaultSource = ReplaySource;
