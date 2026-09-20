#!/usr/bin/env node
/**
 * L4 local sidecar: fake Codex CLI, gitignored toml under .wrangler/.
 * Override executable later with official CLI path in sidecar.local.toml.
 */
import { homedir } from "node:os";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ACCOUNTS = join(ROOT, ".dev.accounts");
const TOML = join(ROOT, ".wrangler", "sidecar.local.toml");
const FAKE_CLI = join(ROOT, "sidecar", "fake-cli.mjs");
const INDEX = join(ROOT, "sidecar", "index.ts");
const BASE = join(homedir(), ".local", "kith-dev");
const HOME = join(BASE, "codex-home");
const WORK = join(BASE, "workspace");
const FAKE_DIR = join(BASE, "fake-cli");

function loadAccounts() {
  if (!existsSync(ACCOUNTS)) {
    process.stderr.write("missing .dev.accounts; run npm run db:bootstrap:local\n");
    process.exit(1);
  }
  const out = {};
  for (const line of readFileSync(ACCOUNTS, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#") || !t.includes("=")) continue;
    const eq = t.indexOf("=");
    out[t.slice(0, eq)] = t.slice(eq + 1);
  }
  return out;
}

mkdirSync(HOME, { recursive: true, mode: 0o700 });
mkdirSync(WORK, { recursive: true });
mkdirSync(FAKE_DIR, { recursive: true });
mkdirSync(join(ROOT, ".wrangler"), { recursive: true });

if (!existsSync(TOML)) {
  writeFileSync(
    TOML,
    [
      "# Generated for local wrangler. Gitignored. Point executable at official CLI later.",
      'agent_handle = "codex"',
      'room_id = "room-1"',
      'operator_member_id = "operator"',
      'quota_class = "operator_personal"',
      `codex_home = "${HOME}"`,
      `workspace = "${WORK}"`,
      `executable = "${FAKE_CLI}"`,
      'mcp_base_url = "http://127.0.0.1:8787"',
      "",
    ].join("\n"),
    { mode: 0o600 },
  );
}

const acc = loadAccounts();
const token = acc.KITH_CODEX_BOT_TOKEN;
if (!token) {
  process.stderr.write("KITH_CODEX_BOT_TOKEN missing; re-run npm run db:bootstrap:local\n");
  process.exit(1);
}

const child = spawn(
  process.execPath,
  ["--experimental-strip-types", INDEX, "--config", TOML, ...process.argv.slice(2)],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      KITH_BOT_TOKEN: token,
      KITH_FAKE_CLI_DIR: FAKE_DIR,
    },
  },
);
child.on("exit", (code) => process.exit(code ?? 1));
