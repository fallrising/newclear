import { existsSync } from "node:fs";
import { join } from "node:path";
import { readGit } from "./git.ts";
import { artifactsRoot } from "./paths.ts";

export type RunEnv = { runId: string; runDir: string };

function stamp(now: Date): string {
  const iso = now.toISOString(); // YYYY-MM-DDTHH:mm:ss.sssZ
  return iso.slice(0, 4) + iso.slice(5, 7) + iso.slice(8, 10) + "-" + iso.slice(11, 13) + iso.slice(14, 16) + iso.slice(17, 19);
}

/**
 * Called when the config loads (main process and every worker). The first load picks the run id and
 * refuses an existing run folder before Playwright writes anything (FM-E2E-04).
 */
export function ensureRunEnv(): RunEnv {
  if (!process.env.KITH_E2E_RUN_ID) {
    const git = readGit();
    process.env.KITH_E2E_RUN_ID = stamp(new Date()) + "-" + git.short + (git.dirty ? "-dirty" : "");
  }
  const runId = process.env.KITH_E2E_RUN_ID;
  const runDir = join(artifactsRoot(), runId);
  process.env.KITH_E2E_RUN_DIR = runDir;
  if (process.env.KITH_E2E_RUN_DIR_CHECKED !== "1") {
    if (existsSync(runDir)) throw new Error("run dir already exists: " + runDir);
    process.env.KITH_E2E_RUN_DIR_CHECKED = "1";
  }
  return { runId, runDir };
}
