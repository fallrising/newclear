import { spawn } from "node:child_process";
import { mkdir, open, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import net from "node:net";

// Operates only on local workerd and its dedicated local persistence directory.
const root = resolve(import.meta.dirname, "..");
const mode = process.argv[2] ?? "all";
if (!["all", "integration", "api", "e2e", "serve"].includes(mode))
  throw new Error("Expected all, integration, api, e2e or serve");
const apiPort = Number(process.env.SP_API_PORT ?? 8818);
const webPort = Number(process.env.SP_WEB_PORT ?? 8817);
const env = {
  ...process.env,
  WRANGLER_SEND_METRICS: "false",
  BROWSER: "none",
  SP_API_URL: `http://127.0.0.1:${apiPort}`,
  SP_WEB_URL: `http://127.0.0.1:${webPort}`,
};
for (const key of Object.keys(env))
  if (
    /CLOUDFLARE_(API_TOKEN|API_KEY|EMAIL|ACCOUNT_ID)|CF_API_(TOKEN|KEY)/.test(
      key,
    )
  )
    delete env[key];
const state = resolve(root, ".wrangler/test-state");
const wrangler = resolve(root, "node_modules/.bin/wrangler");
const children = new Map();
let interrupted = false;
await mkdir(resolve(root, "artifacts"), { recursive: true });
async function free(port) {
  const s = net.createServer();
  await new Promise((yes, no) => {
    s.once("error", no);
    s.listen(port, "127.0.0.1", yes);
  });
  await new Promise((yes) => s.close(yes));
}
async function run(cmd, args, log) {
  if (interrupted) throw new Error("Local run interrupted");
  const fd = log ? await open(resolve(root, "artifacts", log), "a") : null;
  const child = spawn(cmd, args, {
    cwd: root,
    env,
    stdio: fd ? ["ignore", fd.fd, fd.fd] : "inherit",
    detached: true,
  });
  const result = new Promise((yes, no) => {
    child.once("error", (error) => {
      children.delete(child);
      no(error);
    });
    child.once("exit", (code, signal) => {
      children.delete(child);
      yes({ code, signal });
    });
  });
  children.set(child, { child, result });
  if (fd) await fd.close();
  return { child, result };
}
async function command(cmd, args) {
  const { result } = await run(cmd, args);
  const { code, signal } = await result;
  if (code !== 0) throw new Error(`${cmd} exited ${code} ${signal ?? ""}`);
}
function stopAll() {
  for (const c of children.keys()) {
    try {
      process.kill(-c.pid, "SIGTERM");
    } catch {
      /* Already stopped. */
    }
  }
}
const interrupt = () => {
  interrupted = true;
  stopAll();
};
process.once("SIGINT", interrupt);
process.once("SIGTERM", interrupt);
async function stop(handle) {
  try {
    process.kill(-handle.child.pid, "SIGTERM");
  } catch {
    /* Already stopped. */
  }
  const timeout = new AbortController();
  try {
    await Promise.race([
      handle.result,
      delay(5000, undefined, { signal: timeout.signal }),
    ]);
  } finally {
    timeout.abort();
  }
  if (children.has(handle.child)) {
    try {
      process.kill(-handle.child.pid, "SIGKILL");
    } catch {
      /* Already stopped. */
    }
    await handle.result;
  }
}
async function ready(url, processHandle) {
  for (let i = 0; i < 120; i++) {
    if (interrupted) throw new Error("Local run interrupted");
    if (processHandle.exitCode !== null || processHandle.signalCode !== null)
      throw new Error(
        `Worker exited ${processHandle.exitCode ?? processHandle.signalCode} while waiting for ${url}; inspect artifacts/*-local.log`,
      );
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(1000) });
      if (r.ok) return;
    } catch {
      /* Startup only. */
    }
    await delay(500);
  }
  throw new Error(`Local Worker did not become ready: ${url}`);
}
try {
  await free(apiPort);
  if (mode !== "api") await free(webPort);
  await command(wrangler, [
    "d1",
    "migrations",
    "apply",
    "DB",
    "--local",
    "--config",
    "api/wrangler.toml",
    "--persist-to",
    state,
  ]);
  let api = await run(
    wrangler,
    [
      "dev",
      "--local",
      "--config",
      "api/wrangler.toml",
      "--ip",
      "127.0.0.1",
      "--port",
      String(apiPort),
      "--inspector-port",
      "0",
      "--persist-to",
      state,
      "--show-interactive-dev-session=false",
    ],
    "api-local.log",
  );
  await ready(`${env.SP_API_URL}/v1/health`, api.child);
  let web;
  if (mode !== "api") {
    web = await run(
      wrangler,
      [
        "dev",
        "--local",
        "--config",
        "web/wrangler.jsonc",
        "--ip",
        "127.0.0.1",
        "--port",
        String(webPort),
        "--inspector-port",
        "0",
        "--var",
        "LOCAL_OWNER_EMAIL:owner@example.test",
        "--show-interactive-dev-session=false",
      ],
      "web-local.log",
    );
    await ready(`${env.SP_WEB_URL}/healthz`, web.child);
  }
  if (mode === "serve") {
    console.log(
      `Local app: ${env.SP_WEB_URL}; API test URL: ${env.SP_API_URL}`,
    );
    const result = await Promise.race([
      api.result.then((result) => ({ worker: "API", ...result })),
      web.result.then((result) => ({ worker: "Web", ...result })),
    ]);
    if (!interrupted)
      throw new Error(
        `${result.worker} worker exited unexpectedly: ${result.code ?? result.signal}`,
      );
  } else {
    if (mode === "all" || mode === "integration" || mode === "api") {
      const files = (await readdir(resolve(root, "tests/integration")))
        .filter(
          (name) =>
            name.endsWith(".test.mjs") &&
            name !== "persistence.test.mjs" &&
            (mode !== "api" || name !== "web.test.mjs"),
        )
        .sort()
        .map((name) => `tests/integration/${name}`);
      await command(process.execPath, [
        "--test",
        "--test-concurrency=1",
        ...files,
      ]);
      env.SP_PERSIST_STATE = resolve(
        root,
        "artifacts/persistence-fixture.json",
      );
      env.SP_PERSIST_PHASE = "seed";
      await command(process.execPath, [
        "--test",
        "tests/integration/persistence.test.mjs",
      ]);
      await stop(api);
      api = await run(
        wrangler,
        [
          "dev",
          "--local",
          "--config",
          "api/wrangler.toml",
          "--ip",
          "127.0.0.1",
          "--port",
          String(apiPort),
          "--inspector-port",
          "0",
          "--persist-to",
          state,
          "--show-interactive-dev-session=false",
        ],
        "api-local.log",
      );
      await ready(`${env.SP_API_URL}/v1/health`, api.child);
      env.SP_PERSIST_PHASE = "verify";
      await command(process.execPath, [
        "--test",
        "tests/integration/persistence.test.mjs",
      ]);
      delete env.SP_PERSIST_PHASE;
      if (web) await ready(`${env.SP_WEB_URL}/healthz`, web.child);
    }
    if (mode === "all" || mode === "e2e")
      await command(resolve(root, "node_modules/.bin/playwright"), ["test"]);
  }
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
} finally {
  await Promise.all([...children.values()].map(stop));
}
