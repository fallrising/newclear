import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { chromium } from "@playwright/test";
import { buildSeed } from "./fixtures/seed.ts";
import { readGit } from "./harness/git.ts";
import { E2E_DIR, KITH_DIR, WEB_DIR, WEB_DIST_DIR, WRANGLER_BIN } from "./harness/paths.ts";
import { redactText } from "./harness/redact.ts";
import { ensureRunEnv } from "./harness/run-env.ts";
import { startStack, stopStack, wranglerEnv } from "./harness/server.ts";

// Builds the isolated environment (docs/v2/milestones/W0.md §5.1.7).

function versionOf(pkgJson: string): string {
  return (JSON.parse(readFileSync(pkgJson, "utf8")) as { version: string }).version;
}

export default async function globalSetup(): Promise<void> {
  const { runId, runDir } = ensureRunEnv();
  mkdirSync(dirname(runDir), { recursive: true });
  try {
    mkdirSync(runDir, { recursive: false });
  } catch {
    throw new Error("run dir already exists: " + runDir); // second line of defence (FM-E2E-04)
  }
  const stateDir = join(runDir, "state");
  process.env.KITH_E2E_RUN_DIR_OWNED = "1";
  process.env.KITH_E2E_SECRET_FILE = join(tmpdir(), "kith-e2e-" + runId + ".secrets");
  writeFileSync(process.env.KITH_E2E_SECRET_FILE, "", { mode: 0o600 });
  for (const d of ["screenshots", "api", "ws", "files", "traces", "state"]) mkdirSync(join(runDir, d));

  const serverLog = join(runDir, "server.log");
  const logOutput = (r: { stdout: string; stderr: string }): void => {
    appendFileSync(serverLog, redactText((r.stdout ?? "") + (r.stderr ?? "")));
  };

  // Playwright skips global teardown when setup throws, so setup cleans up after itself.
  try {
    if (!existsSync(WRANGLER_BIN)) throw new Error("missing wrangler: run npm ci in products/kith");

    if (process.env.E2E_WEB !== "dev") {
      if (process.env.KITH_E2E_SKIP_WEB_BUILD === "1") {
        if (!existsSync(join(WEB_DIST_DIR, "index.html"))) {
          throw new Error("KITH_E2E_SKIP_WEB_BUILD=1 but web/dist/index.html is missing");
        }
      } else {
        const b = spawnSync("npm", ["run", "build"], { cwd: WEB_DIR, encoding: "utf8" });
        writeFileSync(join(runDir, "web-build.log"), redactText((b.stdout ?? "") + (b.stderr ?? "")));
        if (b.status !== 0) throw new Error("web build failed; see web-build.log");
      }
    }

    const env = wranglerEnv();
    const migrate = spawnSync(WRANGLER_BIN, ["d1", "migrations", "apply", "kith", "--local", "--persist-to", stateDir], {
      cwd: KITH_DIR,
      env,
      encoding: "utf8",
    });
    logOutput(migrate);
    if (migrate.status !== 0) throw new Error("d1 migrations failed; see server.log");

    const seed = await buildSeed();
    const seedFile = join(stateDir, "seed.sql");
    writeFileSync(seedFile, seed.sql);
    const exec = spawnSync(WRANGLER_BIN, ["d1", "execute", "kith", "--local", "--persist-to", stateDir, "--file", seedFile, "-y"], {
      cwd: KITH_DIR,
      env,
      encoding: "utf8",
    });
    logOutput(exec);
    if (exec.status !== 0) throw new Error("seed failed; see server.log");
    writeFileSync(join(runDir, "seed.json"), JSON.stringify(seed.description, null, 2) + "\n");

    const stack = await startStack(runDir, stateDir);

    const browser = await chromium.launch();
    const chromiumVersion = browser.version();
    await browser.close();
    const versions = {
      node: process.versions.node,
      wrangler: versionOf(join(KITH_DIR, "node_modules", "wrangler", "package.json")),
      playwright: versionOf(join(E2E_DIR, "node_modules", "@playwright", "test", "package.json")),
      chromium: chromiumVersion,
    };
    const context = {
      run_id: runId,
      git: readGit(),
      scope: process.env.KITH_E2E_SCOPE === "full" ? "full" : "partial",
      web_mode: stack.webMode,
      base_url: stack.baseUrl,
      versions,
      seed: { id: seed.id, sha256: seed.sha256 },
      started_at: new Date().toISOString(),
    };
    writeFileSync(join(runDir, "run-context.json"), JSON.stringify(context, null, 2) + "\n");

    process.env.KITH_E2E_BASE_URL = stack.baseUrl;
    process.env.KITH_E2E_SETUP_OK = "1";
  } catch (e) {
    await stopStack();
    throw e;
  }
}
