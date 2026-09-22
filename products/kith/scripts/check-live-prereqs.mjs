#!/usr/bin/env node
/**
 * Print what is still needed before Cloudflare / real-model go-live.
 * Does not print secret values.
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const KITH_HOME = join(homedir(), ".local", "kith-dev", "codex-home");

function hasNonEmpty(path, key) {
  if (!existsSync(path)) return false;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.startsWith(`${key}=`)) continue;
    return line.slice(key.length + 1).trim().length > 0;
  }
  return false;
}

const wrangler = spawnSync("npx", ["wrangler", "whoami"], {
  cwd: ROOT,
  encoding: "utf8",
  env: process.env,
});
const wranglerOk = /associated with the email|Account Name/i.test(`${wrangler.stdout}\n${wrangler.stderr}`);

const xai = hasNonEmpty(join(ROOT, ".dev.vars"), "XAI_API_KEY");
const kithCodexAuth = existsSync(join(KITH_HOME, "auth.json"));
const defaultCodex = existsSync(join(homedir(), ".codex", "auth.json"));

const rows = [
  ["Cloudflare wrangler login", wranglerOk, "在本機跑: cd products/kith && npx wrangler login"],
  ["XAI_API_KEY in .dev.vars", xai, "把 xAI key 寫進 products/kith/.dev.vars（不要 commit）"],
  ["Kith CODEX_HOME login", kithCodexAuth, `CODEX_HOME=${KITH_HOME} codex login  （不要共用 ~/.codex 給 fanzloud）`],
];

process.stdout.write("Kith go-live prereqs (local already works with fake LLM/CLI):\n");
let missing = 0;
for (const [name, ok, how] of rows) {
  process.stdout.write(`${ok ? "OK " : "NEED"}  ${name}\n`);
  if (!ok) {
    process.stdout.write(`      ${how}\n`);
    missing += 1;
  }
}
if (defaultCodex && !kithCodexAuth) {
  process.stdout.write(
    "note: ~/.codex is logged in, but kith uses a disjoint CODEX_HOME. Do not copy auth.json; login again into the kith home.\n",
  );
}
process.exit(missing === 0 ? 0 : 2);
