import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { PROVIDER_CANARY } from "../fixtures/accounts.ts";
import { startFakeProvider, type FakeProvider } from "./fake-provider.ts";
import { KITH_DIR, WEB_DIR, WEB_DIST_DIR, WRANGLER_BIN } from "./paths.ts";
import { recordObservedSecret, redactText } from "./redact.ts";

// Starts and stops the isolated stack (docs/v2/milestones/W0.md §5.1.6). Only process groups this module
// started are ever signalled: no pkill, no killall, nothing by name.

export type StackStarted = { apiOrigin: string; baseUrl: string; webMode: "build" | "dev"; fakeProviderUrl: string };

const children: ChildProcess[] = [];
let pidsFile: string | null = null;
let fakeProvider: FakeProvider | null = null;

export function wranglerEnv(): NodeJS.ProcessEnv {
  return { ...process.env, CLOUDFLARE_CF_FETCH_ENABLED: "false", WRANGLER_SEND_METRICS: "false", FORCE_COLOR: "0" };
}

export async function getFreePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr !== null ? addr.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

/** Readiness polling, not a correctness proof. */
export async function waitForHttp(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.status === 200) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`not ready within ${timeoutMs} ms: ${url}`);
}

/** Pipe a child's output into a log file, line by line, without ANSI codes and redacted. */
function lineWriter(file: string): (chunk: Buffer) => void {
  let pending = "";
  return (chunk) => {
    pending += chunk.toString("utf8");
    const lines = pending.split("\n");
    pending = lines.pop() ?? "";
    for (const line of lines) appendFileSync(file, redactText(line.replace(/\x1b\[[0-9;]*m/g, "")) + "\n");
  };
}

function track(child: ChildProcess, stateDir: string): void {
  children.push(child);
  pidsFile = join(stateDir, "pids.json");
  const pids: { pid: number }[] = existsSync(pidsFile) ? (JSON.parse(readFileSync(pidsFile, "utf8")) as { pid: number }[]) : [];
  if (child.pid !== undefined) pids.push({ pid: child.pid });
  writeFileSync(pidsFile, JSON.stringify(pids));
}

export async function startStack(runDir: string, stateDir: string): Promise<StackStarted> {
  const webMode = process.env.E2E_WEB === "dev" ? "dev" : "build";
  const env = wranglerEnv();
  const apiPort = await getFreePort();
  const inspectorPort = await getFreePort();

  let assetsDir = WEB_DIST_DIR;
  if (webMode === "dev") {
    assetsDir = join(stateDir, "empty-assets");
    mkdirSync(assetsDir, { recursive: true });
    writeFileSync(join(assetsDir, "index.html"), "<!doctype html><title>assets placeholder</title>");
  }
  fakeProvider = await startFakeProvider(PROVIDER_CANARY);
  const serverLogPath = join(runDir, "server.log");
  const prior = existsSync(serverLogPath) ? readFileSync(serverLogPath, "utf8") : "";
  writeFileSync(serverLogPath, JSON.stringify({ fake_provider: fakeProvider.url }) + "\n" + prior);

  // --env-file keeps wrangler from loading a developer's .dev.vars (FM-E2E-05).
  const secretsKey = randomBytes(32).toString("base64url");
  recordObservedSecret(secretsKey);
  writeFileSync(join(stateDir, "wrangler.env"), `KITH_E2E=1\nKITH_SECRETS_KEY=${secretsKey}\n`);

  const args = [
    "dev", "--local", "--ip", "127.0.0.1", "--port", String(apiPort), "--inspector-port", String(inspectorPort),
    "--persist-to", stateDir, "--assets", assetsDir, "--env-file", join(stateDir, "wrangler.env"),
    "--show-interactive-dev-session=false",
    "--var", "ff_mcp:on", "--var", "ff_hosted_agent:on", "--var", "ff_sidecar:off", "--var", "ff_ambient:off",
    "--var", "ff_providers:on", "--var", "KITH_DEV_ALLOW_HTTP_PROVIDERS:on",
  ];
  const wrangler = spawn(WRANGLER_BIN, args, { cwd: KITH_DIR, env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
  const serverLog = lineWriter(join(runDir, "server.log"));
  wrangler.stdout?.on("data", serverLog);
  wrangler.stderr?.on("data", serverLog);
  track(wrangler, stateDir);

  const apiOrigin = `http://127.0.0.1:${apiPort}`;
  await waitForHttp(apiOrigin + "/api/csrf", 60_000);

  if (webMode === "build") return { apiOrigin, baseUrl: apiOrigin, webMode, fakeProviderUrl: fakeProvider.url };

  const webPort = await getFreePort();
  const vite = spawn("npm", ["run", "dev", "--", "--port", String(webPort), "--strictPort"], {
    cwd: WEB_DIR,
    env: { ...process.env, KITH_API_ORIGIN: apiOrigin },
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const webLog = lineWriter(join(runDir, "web-dev.log"));
  vite.stdout?.on("data", webLog);
  vite.stderr?.on("data", webLog);
  track(vite, stateDir);
  const webUrl = `http://127.0.0.1:${webPort}`;
  await waitForHttp(webUrl + "/login", 60_000);
  return { apiOrigin, baseUrl: webUrl, webMode, fakeProviderUrl: fakeProvider.url };
}

function signalGroup(pid: number, signal: NodeJS.Signals): boolean {
  try {
    process.kill(-pid, signal);
    return true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ESRCH") return false;
    throw e;
  }
}

function groupAlive(pid: number): boolean {
  try {
    process.kill(-pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function stopStack(): Promise<void> {
  let pids = children.map((c) => c.pid).filter((p): p is number => p !== undefined);
  if (pids.length === 0) {
    const file = pidsFile ?? (process.env.KITH_E2E_RUN_DIR ? join(process.env.KITH_E2E_RUN_DIR, "state", "pids.json") : null);
    if (file && existsSync(file)) pids = (JSON.parse(readFileSync(file, "utf8")) as { pid: number }[]).map((p) => p.pid);
  }
  for (const pid of [...pids].reverse()) {
    if (!signalGroup(pid, "SIGTERM")) continue;
    const deadline = Date.now() + 10_000;
    while (groupAlive(pid) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
    if (groupAlive(pid)) signalGroup(pid, "SIGKILL");
  }
  children.length = 0;
  await fakeProvider?.close();
  fakeProvider = null;
}
