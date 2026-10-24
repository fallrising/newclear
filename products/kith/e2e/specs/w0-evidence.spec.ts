import KithReporter from "../harness/reporter.ts";
import { acceptanceId } from "../harness/evidence.ts";
import { createHash } from "node:crypto";
import type { FullResult, TestCase, TestResult } from "@playwright/test/reporter";
import { copyFileSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { test, expect } from "../fixtures/kith.ts";
import { ACCOUNTS, CANARY, canaryBotToken } from "../fixtures/accounts.ts";
import { note, saveFile } from "../harness/evidence.ts";
import { runNested } from "../harness/nested.ts";
import { validateRunDir } from "../harness/validate.ts";

type Manifest = {
  run_id: string;
  status: string;
  base_url: string;
  errors: string[];
  redaction: { hits_after_redaction: number; hits: { file: string; rule: string }[] };
  results: { id: string; project: string; status: string; evidence: { kind: string; text?: string }[] }[];
};

function onlySubdir(dir: string): string {
  const entries = readdirSync(dir).filter((n) => statSync(join(dir, n)).isDirectory());
  expect(entries).toHaveLength(1);
  return join(dir, entries[0]!);
}

function listFiles(dir: string, skip: string[]): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      const rel = relative(dir, p);
      if (skip.some((s) => rel === s || rel.startsWith(s + "/"))) continue;
      if (statSync(p).isDirectory()) walk(p);
      else out.push(p);
    }
  };
  walk(dir);
  return out;
}

test(
  "E2E-W0-02 evidence folder validates and redaction failures fail the run",
  { tag: ["@W0"] },
  async ({}, info) => {
    test.setTimeout(300_000);
    const nestedRoot = join(process.env.KITH_E2E_RUN_DIR!, "nested");

    // 1. Good nested run.
    const good = await runNested({ root: join(nestedRoot, "good"), grep: "@probe-good", timeoutMs: 120_000 });
    saveFile(info, "good-run.log", good.output);
    expect(good.exitCode).toBe(0);

    // 2. It validates.
    const goodDir = onlySubdir(join(nestedRoot, "good"));
    const v = validateRunDir(goodDir);
    expect(v.problems).toEqual([]);
    note(info, "good run manifest, seed and hashes validate");

    // 3. Manifest content.
    const m = JSON.parse(readFileSync(join(goodDir, "manifest.json"), "utf8")) as Manifest;
    expect(m.status).toBe("passed");
    expect(m.errors).toEqual([]);
    expect(m.redaction.hits_after_redaction).toBe(0);
    expect(m.results.some((r) => r.id === "PROBE-W0-01" && r.project === "desktop" && r.status === "passed")).toBe(true);

    if (process.env.KITH_E2E_LOOPBACK_ONLINE === "1") {
      expect(m.results.find((r) => r.id === "PROBE-W0-01")?.evidence).toContainEqual({ kind: "assertion", text: "probe online signal=true" });
    }

    // 4. Summary.
    const summary = readFileSync(join(goodDir, "summary.md"), "utf8");
    expect(summary).toContain(m.run_id);
    expect(summary).toContain("PROBE-W0-01");

    // 5. Independent scan for known secrets.
    const secrets = [CANARY, canaryBotToken(), ...Object.values(ACCOUNTS).map((a) => a.password)];
    for (const file of listFiles(goodDir, ["report", "test-output", "traces"])) {
      const text = readFileSync(file, "utf8");
      for (const s of secrets) expect(text.includes(s), `${relative(goodDir, file)} contains a known secret`).toBe(false);
      expect(/kith_bot_[0-9a-f]{64}/.test(text), `${relative(goodDir, file)} contains a bot token`).toBe(false);
    }
    note(info, "independent scan found no known secret in the good run");

    // 6. API log is redacted.
    const lines = readFileSync(join(goodDir, "api", "PROBE-W0-01.desktop.jsonl"), "utf8")
      .split("\n")
      .filter((l) => l !== "")
      .map((l) => JSON.parse(l) as {
        path: string;
        status: number | null;
        req_body: { password?: string } | null;
        req_headers: Record<string, string>;
      });
    expect(lines.some((l) => l.path === "/api/auth/login" && l.req_body?.password === "[REDACTED]")).toBe(true);
    expect(
      lines.some((l) => l.path === "/api/me" && l.req_headers.authorization === "Bearer [REDACTED]" && l.status === 401),
    ).toBe(true);

    // 7. server.log: ready, and .dev.vars was not loaded (FM-E2E-05).
    const serverLog = readFileSync(join(goodDir, "server.log"), "utf8");
    expect(serverLog).toContain("Ready on http://127.0.0.1:");
    const secretSources = serverLog.split("\n").filter((l) => l.includes("Using secrets defined in"));
    for (const line of secretSources) expect(line.trimEnd()).toMatch(/\/state\/wrangler\.env$/);
    expect(serverLog).not.toContain(".dev.vars");

    // 8. The nested stack is gone (FM-E2E-06).
    await expect(fetch(m.base_url + "/api/csrf")).rejects.toThrow();
    note(info, "nested stack is gone after teardown");

    // 9. Bad nested run: leak, missing id, missing evidence.
    const bad = await runNested({ root: join(nestedRoot, "bad"), grep: "@probe-bad", timeoutMs: 120_000 });
    saveFile(info, "bad-run.log", bad.output);
    const badDir = onlySubdir(join(nestedRoot, "bad"));
    const b = JSON.parse(readFileSync(join(badDir, "manifest.json"), "utf8")) as Manifest;
    expect(bad.exitCode).toBe(1);
    expect(b.status).toBe("failed");
    expect(b.redaction.hits).toContainEqual({ file: "files/PROBE-W0-02/leak.txt", rule: "R06-known-secrets" });
    expect(b.errors).toContain("missing acceptance id: probe without an acceptance id");
    expect(b.errors).toContain("missing evidence file: files/PROBE-W0-02/missing.txt");
    note(info, "leak, missing id and missing evidence fail the run");

    // 10. Run dir collision.
    const collideDir = join(nestedRoot, "collide", "20260101-000000-0000000");
    mkdirSync(collideDir, { recursive: true });
    writeFileSync(join(collideDir, "sentinel.txt"), "keep");
    const c = await runNested({
      root: join(nestedRoot, "collide"),
      grep: "@probe-good",
      runId: "20260101-000000-0000000",
      timeoutMs: 60_000,
    });
    saveFile(info, "collide-run.log", c.output);
    expect(c.exitCode).not.toBe(0);
    expect(c.output).toContain("run dir already exists");
    expect(readdirSync(collideDir)).toEqual(["sentinel.txt"]);
    expect(readFileSync(join(collideDir, "sentinel.txt"), "utf8")).toBe("keep");
    note(info, "run dir collision fails without touching the existing folder");
  },
);


test("E2E-W0-03 VIS evidence retains comparison PNGs and fails closed", { tag: ["@W0"] }, async ({}, info) => {
  const outer = process.env.KITH_E2E_RUN_DIR!;
  const original = { ...process.env };
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6SAAAAABJRU5ErkJggg==", "base64");
  expect(acceptanceId({ title: "E2E-VIS-01 login" } as typeof info)).toBe("E2E-VIS-01");
  expect(acceptanceId({ title: "E2E-VIS-99 unknown" } as typeof info)).toBeNull();
  for (const fault of ["good", "unknown", "missing", "outside", "partial"] as const) {
    const dir = info.outputPath("reporter-" + fault);
    for (const part of ["screenshots", "api", "ws", "files", "traces", "test-output"]) mkdirSync(join(dir, part), { recursive: true });
    copyFileSync(join(outer, "seed.json"), join(dir, "seed.json"));
    copyFileSync(join(outer, "run-context.json"), join(dir, "run-context.json"));
    const attachments = ["expected", "actual", "diff"].map((role) => {
      const path = join(dir, "test-output", "login-" + role + ".png");
      writeFileSync(path, png);
      return { name: "login-" + role + ".png", contentType: "image/png", path };
    });
    if (fault === "outside") attachments[0]!.path = join(outer, "seed.json");
    if (fault === "partial") attachments.pop();
    const title = fault === "unknown" ? "E2E-VIS-99 unknown" : "E2E-VIS-01 login";
    const annotations = fault === "missing" ? [{ type: "evidence", description: JSON.stringify({ kind: "file", path: "files/E2E-VIS-01/missing.png" }) }] : [];
    const reporter = new KithReporter();
    let verdict: { status?: FullResult["status"] };
    try {
      process.env.KITH_E2E_RUN_DIR = dir;
      process.env.KITH_E2E_RUN_DIR_OWNED = "1";
      process.env.KITH_E2E_SETUP_OK = "1";
      delete process.env.KITH_E2E_SECRET_FILE;
      reporter.onTestEnd({ title, annotations, tags: [], location: { file: info.file }, parent: { project: () => ({ name: "desktop" }) } } as unknown as TestCase,
        { attachments, status: fault === "partial" ? "failed" : "passed", duration: 0, retry: 0 } as TestResult);
      verdict = await reporter.onEnd({ status: "passed" } as FullResult);
    } finally {
      for (const key of Object.keys(process.env)) if (!(key in original)) delete process.env[key];
      Object.assign(process.env, original);
    }
    const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")) as { results: { evidence: { kind: string; path: string; sha256: string }[] }[]; errors: string[] };
    expect(verdict!.status).toBe(fault === "good" ? "passed" : "failed");
    if (fault === "good") {
      expect(validateRunDir(dir).problems).toEqual([]);
      const retained = manifest.results[0]!.evidence.filter((e) => e.kind.startsWith("visual-"));
      expect(retained.map((e) => e.kind).sort()).toEqual(["visual-actual", "visual-diff", "visual-expected"]);
      for (const e of retained) {
        expect(readFileSync(join(dir, e.path))).toEqual(png);
        expect(e.sha256).toBe(createHash("sha256").update(png).digest("hex"));
      }
      const invalid = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
      invalid.results[0].id = "E2E-VIS-99";
      writeFileSync(join(dir, "manifest.json"), JSON.stringify(invalid));
      expect(validateRunDir(dir).problems.some((p) => p.includes("schema"))).toBe(true);
    }
    if (fault === "unknown") expect(manifest.errors).toContain("missing acceptance id: " + title);
    if (fault === "missing") expect(manifest.errors).toContain("missing evidence file: files/E2E-VIS-01/missing.png");
    if (fault === "outside") expect(manifest.errors.some((e) => e.includes("invalid visual attachment"))).toBe(true);
    if (fault === "partial") expect(manifest.errors).toContain("incomplete visual comparison bundle: E2E-VIS-01/login");
  }
  note(info, "VIS IDs, PNG role retention/hashes, unknown IDs, missing evidence and outside paths checked independently");
});


test("E2E-W0-04 loopback connectivity signal preserves native offline transitions", { tag: ["@W0"] }, async ({ page, browser }, info) => {
  await page.goto("/login");
  expect(await page.evaluate(() => navigator.onLine)).toBe(true);
  expect(await page.evaluate(async () => (await fetch("/api/csrf")).status)).toBe(200);
  await page.getByTestId("login-handle").fill("ada");
  await page.getByTestId("login-password").fill(ACCOUNTS.ada.password);
  await page.getByTestId("login-submit").click();
  await expect(page.getByTestId("app-shell")).toBeVisible();
  expect(await page.evaluate(() => new Promise<string>((resolve, reject) => {
    const ws = new WebSocket("ws://" + location.host + "/api/rooms/room-lobby/ws");
    ws.onopen = () => { ws.close(); resolve("opened"); };
    ws.onerror = () => reject(new Error("loopback websocket failed"));
  }))).toBe("opened");
  await page.context().setOffline(true);
  expect(await page.evaluate(() => navigator.onLine)).toBe(false);
  expect(await page.evaluate(() => fetch("/api/csrf").then(() => false, () => true))).toBe(true);
  const offlineTab = await page.context().newPage();
  expect(await offlineTab.evaluate(() => navigator.onLine)).toBe(false);
  await offlineTab.close();
  await page.context().setOffline(false);
  expect(await page.evaluate(() => navigator.onLine)).toBe(true);
  expect(await page.evaluate(async () => (await fetch("/api/csrf")).status)).toBe(200);
  const context = await browser.newContext({ baseURL: process.env.KITH_E2E_BASE_URL, offline: true });
  try {
    const explicit = await context.newPage();
    expect(await explicit.evaluate(() => navigator.onLine)).toBe(false);
    await context.setOffline(false);
    expect(await explicit.evaluate(() => navigator.onLine)).toBe(true);
    await explicit.goto("/login");
    expect(await explicit.evaluate(async () => (await fetch("/api/csrf")).status)).toBe(200);
  } finally { await context.close(); }
  note(info, "reachable loopback HTTP/WS, native offline fetch denial, offline tab/context and false-to-true transitions preserved");
});
