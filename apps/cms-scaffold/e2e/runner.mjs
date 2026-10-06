import process from "node:process";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { redact } from "./redaction.mjs";

const OWNER_LABEL = "cms.w5.e2e.owner";
const TOTAL = 14;
const RESULT_DIR = "test-results/frontend";

export function composeCommand(env) {
  return env.CMS_DOCKER_COMPOSE ? { file: env.CMS_DOCKER_COMPOSE, prefix: [] } : { file: "docker", prefix: ["compose"] };
}

export function seedCredentials(env, root) {
  if (env.CMS_E2E_PASSWORD) return { password: env.CMS_E2E_PASSWORD, secrets: [env.CMS_E2E_PASSWORD], apiEnvironment: { CMS_SEED_PASSWORD: env.CMS_E2E_PASSWORD } };
  const file = resolve(root, env.CMS_E2E_PASSWORD_FILE || "local/seed-passwords.txt");
  if (existsSync(file)) {
    const rows = readFileSync(file, "utf8").split(/\r?\n/).filter((line) => line && !line.startsWith("#"));
    const apiEnvironment = {};
    const secrets = [];
    for (const row of rows) {
      const match = /^(seed-[a-z0-9-]+)=(.+)$/.exec(row);
      if (!match) throw new Error("Invalid private seed password file");
      const key = `CMS_SEED_PASSWORD_${match[1].toUpperCase().replaceAll("-", "_")}`;
      if (key in apiEnvironment) throw new Error("Duplicate private seed password entry");
      apiEnvironment[key] = match[2]; secrets.push(match[2]);
    }
    if (!secrets.length) throw new Error("Empty private seed password file");
    return { file, secrets, apiEnvironment };
  }
  if (env.CMS_E2E_PASSWORD_FILE || env.CMS_E2E_BOOTSTRAP !== "1") throw new Error("Missing seed password; provide CMS_E2E_PASSWORD/private file or opt into CMS_E2E_BOOTSTRAP=1");
  const password = randomBytes(32).toString("base64url");
  return { password, secrets: [password], apiEnvironment: { CMS_SEED_PASSWORD: password } };
}

async function execute(file, args, options) {
  return new Promise((done) => {
    const child = spawn(file, args, { ...options, stdio: ["ignore", "pipe", "pipe"], shell: false });
    let stdout = "", stderr = "";
    child.stdout.on("data", (part) => { stdout += part; });
    child.stderr.on("data", (part) => { stderr += part; });
    child.on("error", () => done({ code: options.signal?.aborted ? 130 : 127, stdout, stderr: "Command could not execute" }));
    child.on("close", (code, signal) => done({ code: code ?? (signal === "SIGTERM" ? 143 : 130), stdout, stderr }));
  });
}

function nextAttempt(root) {
  const directory = join(root, RESULT_DIR, "real-e2e-logs");
  if (!existsSync(directory)) return 1;
  return Math.max(0, ...readdirSync(directory).map((name) => Number(name)).filter(Number.isSafeInteger)) + 1;
}

function nextRecordId(root, measuredAt, attempt) {
  const date = measuredAt.slice(0, 10).replaceAll("-", "");
  const file = join(root, "docs/v2/frontend-records.md");
  const recorded = existsSync(file) ? [...readFileSync(file, "utf8").matchAll(new RegExp(`W5-REAL-${date}-(\\d+)`, "g"))].map((m) => Number(m[1])) : [];
  const attempts = join(root, RESULT_DIR, "real-e2e-logs");
  if (existsSync(attempts)) for (const folder of readdirSync(attempts)) {
    const previous = join(attempts, folder, "real-e2e.json");
    if (!existsSync(previous)) continue;
    const id = JSON.parse(readFileSync(previous, "utf8")).recordId;
    const match = new RegExp(`^W5-REAL-${date}-(\\d+)$`).exec(id);
    if (match) recorded.push(Number(match[1]));
  }
  return `W5-REAL-${date}-${String(Math.max(attempt, Math.max(0, ...recorded) + 1)).padStart(2, "0")}`;
}

/** Every operation is injectable for runner contracts; tests never start Docker. */
export async function run({ root = resolve(dirname(fileURLToPath(import.meta.url)), ".."), env = process.env, exec = execute, signal } = {}) {
  const startedAt = Date.now();
  const measuredAt = new Date(startedAt).toISOString();
  const attempt = nextAttempt(root);
  const directory = join(root, RESULT_DIR, "real-e2e-logs", String(attempt).padStart(3, "0"));
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const project = `cms-w5-e2e-${process.pid}-${randomBytes(8).toString("hex")}`;
  const privateDirectory = join(directory, ".private");
  let secrets = [], code = 2, failureClass = "preflight", owned = false, passed = 0, failed = TOTAL;
  let composeVersion = "unavailable", chromium = null, jdk = null;
  // Unrelated historical seed env must never alter disposable credentials.
  const commandEnv = Object.fromEntries(Object.entries(env).filter(([key]) => !key.startsWith("CMS_SEED_PASSWORD") && key !== "COMPOSE_PROJECT_NAME"));
  commandEnv.CMS_E2E_PROJECT = project;
  commandEnv.CMS_E2E_ARTIFACT_DIR = relative(root, join(directory, "artifacts"));
  const compose = composeCommand(commandEnv);
  let composeArgs, browserStarted = false;
  async function invoke(file, args, log, cleanup = false) {
    const result = await exec(file, args, { cwd: root, env: commandEnv, ...(cleanup ? {} : { signal }) });
    if (log) writeFileSync(join(directory, log), redact(`${result.stdout || ""}${result.stderr || ""}`, secrets), { mode: 0o600 });
    return result;
  }
  async function resources() {
    const containers = await invoke("docker", ["ps", "-aq", "--filter", `label=com.docker.compose.project=${project}`], null, true);
    const volumes = await invoke("docker", ["volume", "ls", "-q", "--filter", `label=com.docker.compose.project=${project}`], null, true);
    if (containers.code || volumes.code) throw new Error("Cannot verify disposable project ownership");
    return { containers: containers.stdout.trim().split(/\s+/).filter(Boolean), volumes: volumes.stdout.trim().split(/\s+/).filter(Boolean) };
  }
  async function verifyOwnership() {
    if (!owned || !/^cms-w5-e2e-[a-z0-9-]+$/.test(project)) throw new Error("Refusing unowned cleanup");
    const found = await resources();
    for (const id of found.containers) {
      const result = await invoke("docker", ["inspect", "--format", `{{ index .Config.Labels "${OWNER_LABEL}" }}`, id], null, true);
      if (result.code || result.stdout.trim() !== project) throw new Error("Refusing container with a different ownership label");
    }
    for (const name of found.volumes) {
      const result = await invoke("docker", ["volume", "inspect", "--format", `{{ index .Labels "${OWNER_LABEL}" }}`, name], null, true);
      if (result.code || result.stdout.trim() !== project) throw new Error("Refusing volume with a different ownership label");
    }
  }
  function sanitizeArtifacts(folder) {
    if (!existsSync(folder)) return;
    for (const item of readdirSync(folder, { withFileTypes: true })) {
      const file = join(folder, item.name);
      if (item.isDirectory()) sanitizeArtifacts(file);
      else if (item.isFile() && /\.(?:json|md|txt|log|html)$/i.test(item.name)) writeFileSync(file, redact(readFileSync(file, "utf8"), secrets), { mode: 0o600 });
    }
  }
  async function cleanupBrowser() {
    if (!browserStarted) return;
    const browser = await invoke("docker", ["ps", "-aq", "--filter", `name=^${project}-browser$`], null, true);
    if (browser.code) throw new Error("Cannot verify disposable browser ownership");
    if (!browser.stdout.trim()) return;
    const label = await invoke("docker", ["inspect", "--format", `{{ index .Config.Labels "${OWNER_LABEL}" }}`, `${project}-browser`], null, true);
    if (label.code || label.stdout.trim() !== project) throw new Error("Refusing unowned browser cleanup");
    const stopped = await invoke("docker", ["rm", "--force", `${project}-browser`], "browser-cleanup.log", true);
    if (stopped.code) throw new Error("Disposable browser cleanup failed");
  }

  try {
    const credentials = seedCredentials(commandEnv, root);
    secrets = credentials.secrets;
    mkdirSync(privateDirectory, { mode: 0o700 });
    if (credentials.password) commandEnv.CMS_E2E_PASSWORD = credentials.password;
    else {
      const copy = join(privateDirectory, "seed-passwords.txt");
      writeFileSync(copy, readFileSync(credentials.file), { mode: 0o600 });
      commandEnv.CMS_E2E_PASSWORD_FILE = copy;
    }
    // The generated override contains environment variable references, never values.
    const apiEnvironment = {};
    for (const [name, value] of Object.entries(credentials.apiEnvironment)) {
      const key = `CMS_E2E_${name}`;
      commandEnv[key] = value; apiEnvironment[name] = `\${${key}}`;
    }
    const override = join(privateDirectory, "seed.compose.json");
    writeFileSync(override, JSON.stringify({ services: { "cms-api": { environment: apiEnvironment } } }), { mode: 0o600 });
    composeArgs = [...compose.prefix, "--project-name", project, "-f", "compose.yaml", "-f", "e2e/compose.e2e.yaml", "-f", override];
    const version = await invoke(compose.file, [...compose.prefix, "version", "--short"], "preflight.log");
    if (version.code) throw new Error("Docker Compose unavailable; use a workspace-local CMS_DOCKER_COMPOSE executable");
    composeVersion = version.stdout.trim();
    const found = await resources();
    if (found.containers.length || found.volumes.length) throw new Error("Disposable project already has resources; refusing to adopt them");
    owned = true; failureClass = "stack";
    const stack = await invoke(compose.file, [...composeArgs, "up", "-d", "--wait", "--build"], "startup.log");
    if (stack.code) { code = stack.code; throw new Error("Disposable stack startup failed"); }
    const java = await invoke(compose.file, [...composeArgs, "exec", "-T", "cms-api", "java", "--version"], "java.log");
    if (java.code) throw new Error("Cannot measure disposable API Java version");
    jdk = `${java.stdout || ""}${java.stderr || ""}`.trim().split(/\r?\n/)[0] || null;
    if (!jdk) throw new Error("Disposable API Java version was empty");
    failureClass = "tests";
    const reportPath = join(root, RESULT_DIR, "real-results.json");
    // Avoid reading a previous attempt's report after a startup or test failure.
    rmSync(reportPath, { force: true });
    let browserPath = env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
    if (!browserPath) {
      try { browserPath = (await import("@playwright/test")).chromium.executablePath(); } catch { /* Docker browser fallback. */ }
    }
    const libraries = browserPath && existsSync(browserPath) ? await invoke("ldd", [browserPath], null) : null;
    const hostAvailable = libraries && !libraries.code && !/not found/.test(libraries.stdout);
    if (hostAvailable) {
      commandEnv.PLAYWRIGHT_CHROMIUM_EXECUTABLE = browserPath;
      const version = await invoke(browserPath, ["--version"], null);
      chromium = version.code ? null : version.stdout.trim();
    }
    const testArgs = ["playwright", "test", "--config", "playwright.config.ts", "front.spec.ts", "back.spec.ts", "admin.spec.ts"];
    let tested;
    if (hostAvailable) {
      tested = await invoke("npx", testArgs, "playwright.log");
    } else {
      const image = "mcr.microsoft.com/playwright:v1.63.0-noble";
      const dockerEnv = ["CMS_E2E_PROJECT", "CMS_E2E_ARTIFACT_DIR", "CMS_E2E_PASSWORD", "CMS_E2E_FRONT", "CMS_E2E_BACK", "CMS_E2E_ADMIN", "CMS_E2E_API"].flatMap((key) => ["-e", key]);
      if (commandEnv.CMS_E2E_PASSWORD_FILE) dockerEnv.push("-e", `CMS_E2E_PASSWORD_FILE=/work/${relative(root, commandEnv.CMS_E2E_PASSWORD_FILE)}`);
      chromium = image;
      browserStarted = true;
      tested = await invoke("docker", ["run", "--rm", "--name", `${project}-browser`, "--network=host", "--label", `${OWNER_LABEL}=${project}`, "-v", `${root}:/work`, "-w", "/work", ...dockerEnv, image, "npx", ...testArgs], "playwright.log");
    }
    code = tested.code;
    if (existsSync(reportPath)) {
      const safeReport = redact(readFileSync(reportPath, "utf8"), secrets);
      writeFileSync(reportPath, safeReport, { mode: 0o600 });
      writeFileSync(join(directory, "real-results.json"), safeReport, { mode: 0o600 });
      const report = JSON.parse(safeReport);
      passed = report.stats?.expected ?? 0;
      failed = Math.max(report.stats?.unexpected ?? 0, TOTAL - passed);
      if (passed !== TOTAL || failed || report.stats?.skipped || report.stats?.flaky) code ||= 1;
    } else { code ||= 1; }
    if (!code) failureClass = "none";
  } catch (error) {
    if (owned && code === 2) code = 1;
    writeFileSync(join(directory, "failure.log"), redact(error.message, secrets), { mode: 0o600 });
  } finally {
    sanitizeArtifacts(join(directory, "artifacts"));
    const rawReport = join(root, RESULT_DIR, "real-results.json");
    if (existsSync(rawReport)) writeFileSync(rawReport, redact(readFileSync(rawReport, "utf8"), secrets), { mode: 0o600 });
    if (owned) {
      try {
        await cleanupBrowser();
        await verifyOwnership();
        const logs = await invoke(compose.file, [...composeArgs, "logs", "--no-color"], "compose.log", true);
        const cleanup = await invoke(compose.file, [...composeArgs, "down", "--volumes", "--remove-orphans"], "cleanup.log", true);
        const remaining = await resources();
        if (logs.code || cleanup.code || remaining.containers.length || remaining.volumes.length) {
          writeFileSync(join(directory, "cleanup-error.log"), "Disposable log collection or cleanup failed", { mode: 0o600 });
          code ||= 1; failureClass = "cleanup";
        }
      } catch (error) {
        writeFileSync(join(directory, "cleanup-error.log"), redact(error.message, secrets), { mode: 0o600 });
        code ||= 1; failureClass = "cleanup";
      }
    }
    rmSync(privateDirectory, { recursive: true, force: true });
    const commit = await invoke("git", ["rev-parse", "HEAD"], null, true);
    const dirty = await invoke("git", ["status", "--porcelain"], null, true);
    const artifact = relative(root, join(directory, "real-e2e.json")).replaceAll("\\", "/");
    const record = {
      schemaVersion: 1, measuredAt, gitCommit: commit.stdout.trim() || "unknown", dirty: !!dirty.stdout.trim(), node: process.version,
      chromium, command: "e2e", artifact, result: code ? "failed" : "passed", recordId: nextRecordId(root, measuredAt, attempt),
      attempt, os: process.platform, jdk, dockerCompose: composeVersion, stack: project,
      passed, failed, total: TOTAL, durationSeconds: (Date.now() - startedAt) / 1000, exitCode: code, failureClass,
      notes: "Isolated disposable project; owned cleanup and redacted attempt logs."
    };
    const json = redact(JSON.stringify(record, null, 2) + "\n", secrets);
    writeFileSync(join(directory, "real-e2e.json"), json, { mode: 0o600 });
    writeFileSync(join(root, RESULT_DIR, "real-e2e.json"), json, { mode: 0o600 });
  }
  return code;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const controller = new globalThis.AbortController();
  const interrupt = () => controller.abort();
  process.once("SIGINT", interrupt); process.once("SIGTERM", interrupt);
  process.exitCode = await run({ signal: controller.signal });
}
