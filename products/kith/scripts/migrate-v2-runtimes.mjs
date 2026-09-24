#!/usr/bin/env node
// v1 → v2 runtime migration (docs/v2/03-agent-runtime.md §7, W4 §4.6). Idempotent: every INSERT is OR IGNORE
// with deterministic ids, so a second run changes nothing.
//
//   node scripts/migrate-v2-runtimes.mjs (--local [--persist-to DIR] | --remote) (--xai-secret-env NAME | --no-xai) [--dry-run]
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const KITH_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const WRANGLER = join(KITH_DIR, "node_modules", ".bin", "wrangler");
const ENV_RE = /^[A-Z][A-Z0-9_]{0,63}$/;
const USAGE = "usage: migrate-v2-runtimes.mjs (--local [--persist-to DIR] | --remote) (--xai-secret-env NAME | --no-xai) [--dry-run]";

function parseArgs(argv) {
  const out = { target: null, persistTo: null, xaiEnv: undefined, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--local" || a === "--remote") {
      if (out.target) throw new Error(USAGE);
      out.target = a.slice(2);
    } else if (a === "--persist-to") out.persistTo = argv[++i] ?? "";
    else if (a === "--xai-secret-env") out.xaiEnv = argv[++i] ?? "";
    else if (a === "--no-xai") out.xaiEnv = null;
    else if (a === "--dry-run") out.dryRun = true;
    else throw new Error(`unknown argument ${a}\n${USAGE}`);
  }
  if (!out.target || out.xaiEnv === undefined) throw new Error(USAGE);
  if (out.target === "remote" && out.persistTo) throw new Error("--persist-to is only valid with --local");
  if (out.xaiEnv !== null && (!ENV_RE.test(out.xaiEnv) || out.xaiEnv === "KITH_SECRETS_KEY")) {
    throw new Error("--xai-secret-env must be an upper-case Worker secret name");
  }
  return out;
}

export function buildSql(xaiEnv, now) {
  const q = (s) => `'${s.replaceAll("'", "''")}'`;
  const lines = [];
  if (xaiEnv !== null) {
    lines.push(
      `INSERT OR IGNORE INTO provider_connections (id, name, preset, api_format, base_url, secret_source, secret_env, extra_headers_json, default_quota_class, token_param, created_at, updated_at)
VALUES ('conn-xai-default', 'xai-default', 'xai', 'openai_chat', 'https://api.x.ai/v1', 'env', ${q(xaiEnv)}, '{}', 'api_key', 'max_tokens', ${q(now)}, ${q(now)});`,
      `INSERT OR IGNORE INTO agent_runtimes (agent_id, runtime, connection_id, model, params_json, system_prompt_addendum, adapter_kind, runtime_epoch, updated_at)
SELECT id, 'hosted', 'conn-xai-default', 'grok-4.5', '{}', '', NULL, 1, ${q(now)} FROM members WHERE kind = 'agent' AND quota_class = 'api_key';`,
    );
  }
  lines.push(
    `INSERT OR IGNORE INTO agent_runtimes (agent_id, runtime, connection_id, model, params_json, system_prompt_addendum, adapter_kind, runtime_epoch, updated_at)
SELECT id, 'runner', NULL, NULL, '{}', '', 'codex', 1, ${q(now)} FROM members WHERE kind = 'agent' AND quota_class = 'operator_personal';`,
    `INSERT OR IGNORE INTO agent_runtime_changes (id, agent_id, changed_by, from_runtime, to_runtime, from_epoch, to_epoch, created_at)
SELECT 'migrate-v2-' || r.agent_id, r.agent_id, (SELECT id FROM members WHERE is_operator = 1), NULL, r.runtime, NULL, 1, ${q(now)}
FROM agent_runtimes r WHERE r.runtime_epoch = 1 AND EXISTS (SELECT 1 FROM members WHERE is_operator = 1)
  AND NOT EXISTS (SELECT 1 FROM agent_runtime_changes x WHERE x.agent_id = r.agent_id);`,
  );
  return `${lines.join("\n")}\n`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const sql = buildSql(args.xaiEnv, new Date().toISOString());
  if (args.dryRun) {
    process.stdout.write(sql);
    return;
  }
  const dir = mkdtempSync(join(tmpdir(), "kith-migrate-"));
  try {
    const file = join(dir, "migrate-v2.sql");
    writeFileSync(file, sql);
    const wranglerArgs = ["d1", "execute", "kith", `--${args.target}`, "--file", file, "-y"];
    if (args.persistTo) wranglerArgs.push("--persist-to", args.persistTo);
    const run = spawnSync(WRANGLER, wranglerArgs, { cwd: KITH_DIR, stdio: "inherit" });
    if (run.status !== 0) process.exitCode = run.status ?? 1;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    main();
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 2;
  }
}
