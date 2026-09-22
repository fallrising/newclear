#!/usr/bin/env node
/**
 * Bind local preview to the Tailscale IPv4 (and keep loopback for Vite→Worker proxy).
 * Usage: node scripts/dev-bind.mjs worker|frontend
 */
import { execSync, spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const which = process.argv[2];

function tailscaleIp4() {
  try {
    const ip = execSync("tailscale ip -4", { encoding: "utf8" }).trim().split("\n")[0];
    if (!ip) throw new Error("empty");
    return ip;
  } catch {
    throw new Error("tailscale ip -4 failed; is tailscale up?");
  }
}

const ts = tailscaleIp4();
process.stderr.write(`kith bind tailscale ${ts}  magicdns hrv.tail43ff5.ts.net\n`);

if (which === "worker") {
  // 0.0.0.0 so Vite can still proxy via 127.0.0.1 and Tailscale peers can hit :8787.
  const child = spawn(
    "npx",
    [
      "wrangler",
      "dev",
      "--port",
      "8787",
      "--ip",
      "0.0.0.0",
      "--var",
      "ff_mcp:on",
      "--var",
      "ff_hosted_agent:on",
      "--var",
      "ff_ambient:on",
    ],
    { cwd: ROOT, stdio: "inherit", env: process.env },
  );
  child.on("exit", (code) => process.exit(code ?? 1));
} else if (which === "frontend") {
  const child = spawn(
    "npm",
    ["run", "dev", "--prefix", "frontend", "--", "--host", ts, "--port", "5173", "--strictPort"],
    { cwd: ROOT, stdio: "inherit", env: { ...process.env, KITH_DEV_HOST: ts } },
  );
  child.on("exit", (code) => process.exit(code ?? 1));
} else {
  process.stderr.write("usage: node scripts/dev-bind.mjs worker|frontend\n");
  process.exit(1);
}
