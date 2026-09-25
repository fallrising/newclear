import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect } from "../fixtures/kith.ts";
import { buildSeed } from "../fixtures/seed.ts";
import { note, saveFile } from "../harness/evidence.ts";
import { KITH_DIR, WRANGLER_BIN } from "../harness/paths.ts";
import { redactText } from "../harness/redact.ts";
import { wranglerEnv } from "../harness/server.ts";

const DUMP_SQL = `SELECT 'c' AS t, id, name AS a, secret_source || ':' || COALESCE(secret_env, '') AS b, created_at AS c FROM provider_connections
UNION ALL SELECT 'r', agent_id, runtime, COALESCE(connection_id, '') || '/' || COALESCE(model, '') || '/' || COALESCE(adapter_kind, '') || '/' || runtime_epoch, updated_at FROM agent_runtimes
UNION ALL SELECT 'x', id, to_runtime, changed_by || '/' || to_epoch, created_at FROM agent_runtime_changes
ORDER BY 1, 2`;

type DumpRow = { t: string; id: string; a: string; b: string; c: string };

test("E2E-W4-07 the v1→v2 runtime migration is idempotent", { tag: ["@W4"] }, async ({}, info) => {
  test.setTimeout(180_000);
  const rand = randomBytes(3).toString("hex");
  const runDir = process.env.KITH_E2E_RUN_DIR;
  if (!runDir) throw new Error("KITH_E2E_RUN_DIR is not set");
  const dir = join(runDir, "state", "migrate-" + rand);
  mkdirSync(dir, { recursive: true });
  const logPath = join(runDir, "files", "migrate.log");

  function run(bin: string, args: string[]): { status: number; out: string; err: string } {
    const result = spawnSync(bin, args, { cwd: KITH_DIR, env: wranglerEnv(), encoding: "utf8" });
    const out = redactText(result.stdout ?? "");
    const err = redactText(result.stderr ?? "");
    appendFileSync(logPath, "$ " + [bin, ...args].join(" ") + "\n" + out + err + "\n");
    return { status: result.status ?? 1, out, err };
  }

  function dump(): DumpRow[] {
    const result = run(WRANGLER_BIN, ["d1", "execute", "kith", "--local", "--persist-to", dir, "--json", "--command", DUMP_SQL]);
    expect(result.status).toBe(0);
    const start = result.out.indexOf("[");
    expect(start).toBeGreaterThanOrEqual(0);
    const parsed: unknown = JSON.parse(result.out.slice(start));
    const block = (Array.isArray(parsed) ? parsed[0] : parsed) as { results?: DumpRow[] };
    return block.results ?? [];
  }

  const applied = run(WRANGLER_BIN, ["d1", "migrations", "apply", "kith", "--local", "--persist-to", dir]);
  expect(applied.status).toBe(0);
  expect(applied.out + applied.err).toContain("0003_v2_providers.sql");
  const seed = await buildSeed();
  const seedFile = join(dir, "seed.sql");
  writeFileSync(seedFile, seed.sql);
  const seeded = run(WRANGLER_BIN, ["d1", "execute", "kith", "--local", "--persist-to", dir, "--file", seedFile, "-y"]);
  expect(seeded.status).toBe(0);

  const usage = run("node", ["scripts/migrate-v2-runtimes.mjs", "--local", "--persist-to", dir]);
  expect(usage.status).toBe(2);
  expect(usage.err).toContain("usage:");

  const migrateArgs = ["scripts/migrate-v2-runtimes.mjs", "--local", "--persist-to", dir, "--xai-secret-env", "XAI_API_KEY"];
  const first = run("node", migrateArgs);
  expect(first.status).toBe(0);
  const d1 = dump();
  const connections = d1.filter((row) => row.t === "c");
  expect(connections).toHaveLength(1);
  expect(connections[0]?.id).toBe("conn-xai-default");
  expect(connections[0]?.b).toBe("env:XAI_API_KEY");
  const grok = d1.find((row) => row.t === "r" && row.id === "m-grok");
  expect(grok?.a).toBe("hosted");
  expect(grok?.b).toBe("conn-xai-default/grok-4.5//1");
  const codex = d1.find((row) => row.t === "r" && row.id === "m-codex");
  expect(codex?.a).toBe("runner");
  expect(codex?.b).toBe("//codex/1");
  const changes = d1.filter((row) => row.t === "x");
  expect(changes).toHaveLength(2);
  expect(changes.every((row) => row.b.startsWith("m-ada/"))).toBe(true);

  await new Promise((resolve) => setTimeout(resolve, 1_100));
  const second = run("node", migrateArgs);
  expect(second.status).toBe(0);
  const d2 = dump();
  expect(d2).toEqual(d1);
  saveFile(info, "dump.json", JSON.stringify(d2, null, 2) + "\n");
  note(info, "second run changed nothing");

  const dry = run("node", ["scripts/migrate-v2-runtimes.mjs", "--dry-run", "--local", "--persist-to", dir, "--no-xai"]);
  expect(dry.status).toBe(0);
  expect(dry.out).not.toContain("provider_connections");
  expect(dry.out).toContain("'codex'");
});
