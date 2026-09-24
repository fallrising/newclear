import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
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
  results: { id: string; project: string; status: string }[];
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
