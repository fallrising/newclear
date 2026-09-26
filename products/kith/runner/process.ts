import { spawn } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import type { SpawnSpec } from "./adapters.ts";

export type RunResult = { exitCode: number | null; timedOut: boolean; stdout: string; stderr: string; outputFileText: string | null };
export type SpawnFn = (spec: SpawnSpec, timeoutMs: number) => Promise<RunResult>;

const OUTPUT_CAP = 4 * 1024 * 1024; // keep at most 4 MiB of each stream; the rest is dropped

/** Spawn without a shell; stdin carries the prompt; timeout → SIGTERM, then SIGKILL after 5 s (FM-RUN-03). */
export const defaultSpawn: SpawnFn = (spec, timeoutMs) =>
  new Promise((resolve) => {
    const child = spawn(spec.executable, spec.argv, { cwd: spec.cwd, env: spec.env, stdio: ["pipe", "pipe", "pipe"], shell: false });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (d: string) => {
      if (stdout.length < OUTPUT_CAP) stdout += d;
    });
    child.stderr.on("data", (d: string) => {
      if (stderr.length < OUTPUT_CAP) stderr += d;
    });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 5000).unref();
    }, timeoutMs);
    const finish = (exitCode: number | null) => {
      clearTimeout(timer);
      let outputFileText: string | null = null;
      if (spec.outputFile) {
        try {
          outputFileText = readFileSync(spec.outputFile, "utf8");
          rmSync(spec.outputFile, { force: true });
        } catch {
          outputFileText = null;
        }
      }
      resolve({ exitCode, timedOut, stdout, stderr, outputFileText });
    };
    child.on("error", (e) => {
      stderr += `\nspawn error: ${e.message}`;
      finish(null);
    });
    child.on("close", (code) => finish(code));
    child.stdin.on("error", () => {
      /* child exited before reading stdin */
    });
    child.stdin.end(spec.stdin, "utf8");
  });
