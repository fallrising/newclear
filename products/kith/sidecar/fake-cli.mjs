#!/usr/bin/env node
/**
 * Test-only Codex stand-in. Records argv/stdin/count under KITH_FAKE_CLI_DIR.
 * Not a login; does not read CODEX_HOME.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = process.env.KITH_FAKE_CLI_DIR;
if (!dir) {
  process.stderr.write("fake-cli: KITH_FAKE_CLI_DIR is required\n");
  process.exit(1);
}

mkdirSync(dir, { recursive: true });

const chunks = [];
for await (const chunk of process.stdin) {
  chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
}
const stdin = Buffer.concat(chunks).toString("utf8");

const file = join(dir, "invocations.json");
let data = { count: 0, invocations: [] };
if (existsSync(file)) {
  data = JSON.parse(readFileSync(file, "utf8"));
}
data.count += 1;
data.invocations.push({
  argv: process.argv.slice(2),
  stdin,
  count: data.count,
});
writeFileSync(file, JSON.stringify(data), "utf8");
process.stdout.write("ok\n");
