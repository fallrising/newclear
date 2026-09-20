import { FANOUT_CHUNK } from "./caps.ts";

/** Yield batches of at most FANOUT_CHUNK covering every id. Silent drop of a tail is a bug. */
export function chunks<T>(ids: readonly T[], size: number = FANOUT_CHUNK): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < ids.length; i += size) {
    batches.push(ids.slice(i, i + size));
  }
  return batches;
}
