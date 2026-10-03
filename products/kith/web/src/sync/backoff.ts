import { BACKOFF_BASE_MS, BACKOFF_MAX_MS } from "./types";

/** Exponential backoff with ±20% jitter. `attempt` starts at 0 and resets when the room goes live. */
export function backoffDelay(attempt: number, random: () => number): number {
  const base = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** attempt);
  return Math.round(base * (0.8 + 0.4 * random()));
}
