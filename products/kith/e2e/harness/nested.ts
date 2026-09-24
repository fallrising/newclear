import { spawn } from "node:child_process";
import { E2E_DIR, PLAYWRIGHT_BIN } from "./paths.ts";
import { redactText } from "./redact.ts";

// Runs another Playwright invocation inside a test (E2E-W0-02; docs/v2/milestones/W0.md §5.1.11).

export type NestedRun = { exitCode: number; output: string; root: string };

const DROPPED = new Set(["E2E_WEB", "PLAYWRIGHT_TEST", "TEST_WORKER_INDEX", "TEST_PARALLEL_INDEX", "FORCE_COLOR", "DEBUG_COLORS"]);

function dropped(key: string): boolean {
  return key.startsWith("KITH_E2E_") || DROPPED.has(key);
}

export async function runNested(opts: { root: string; grep: string; runId?: string; timeoutMs: number }): Promise<NestedRun> {
  const env: NodeJS.ProcessEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => !dropped(k)));
  env.KITH_E2E_PROBE = "1";
  env.KITH_E2E_ARTIFACTS_ROOT = opts.root;
  env.KITH_E2E_SKIP_WEB_BUILD = "1";
  if (opts.runId !== undefined) env.KITH_E2E_RUN_ID = opts.runId;

  const child = spawn(PLAYWRIGHT_BIN, ["test", "--grep", opts.grep], { cwd: E2E_DIR, env, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stdout.on("data", (b: Buffer) => (output += b.toString("utf8")));
  child.stderr.on("data", (b: Buffer) => (output += b.toString("utf8")));

  const exitCode = await new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("nested run timed out"));
    }, opts.timeoutMs);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve(code ?? 1);
    });
  });
  return { exitCode, output: redactText(output.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "")), root: opts.root };
}
