#!/usr/bin/env node
// E2E stand-in for a runner CLI (W6 §5.1.1), speaking the `command` adapter protocol:
// stdin = {version, handle, room_id, trigger, prompt}; stdout = {reply, traces:[{summary, full}]}.
// Directive in the trigger body: [[cli:text=…;sleep_ms=…;exit=…;traces=…;big=1;stderr=…]]
// Every invocation is appended to $KITH_FAKE_CLI_DIR/invocations.jsonl (argv, stdin, cwd) for the spec to inspect.
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const dir = process.env.KITH_FAKE_CLI_DIR;
if (!dir) {
  process.stderr.write("fake-cli: KITH_FAKE_CLI_DIR is required\n");
  process.exit(64);
}
mkdirSync(dir, { recursive: true });
let raw = "";
for await (const chunk of process.stdin) raw += chunk;
appendFileSync(join(dir, "invocations.jsonl"), JSON.stringify({ at: new Date().toISOString(), argv: process.argv.slice(2), cwd: process.cwd(), stdin: raw }) + "\n");
const input = JSON.parse(raw);
const m = /\[\[cli:([^\]]*)\]\]/.exec(input.trigger?.body ?? "");
const d = {};
for (const part of (m?.[1] ?? "").split(";")) {
  const eq = part.indexOf("=");
  if (eq > 0) d[part.slice(0, eq).trim()] = decodeURIComponent(part.slice(eq + 1).trim());
}
if (d.sleep_ms) await new Promise((r) => setTimeout(r, Number(d.sleep_ms)));
if (d.stderr) process.stderr.write(`${d.stderr}\n`);
if (d.exit && d.exit !== "0") process.exit(Number(d.exit));
const traces = [];
for (let i = 1; i <= Number(d.traces ?? 1); i++) {
  traces.push({ summary: `step ${i}: looked at the message`, full: `step ${i} full log\n` + "detail line\n".repeat(50) });
}
const reply = d.big ? "x".repeat(10_000) : d.text ?? `done by ${input.handle}`;
process.stdout.write(JSON.stringify({ reply, traces }) + "\n");
