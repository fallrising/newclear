import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { test } from "node:test";
import {
  assessLaunchSignals, releaseBinary, stopProcess,
  waitForCommand, waitForVisibleWindow, artifactDirectory,
} from "./macos-launch-smoke.mjs";

test("release probe uses Cargo output rather than a stale source binary", () => {
  assert.equal(releaseBinary({ CARGO_TARGET_DIR: "/build output/cargo" }), "/build output/cargo/release/flowshot-tauri");
  assert.equal(releaseBinary({ CARGO_TARGET_DIR: "custom-target" }), resolve("custom-target/release/flowshot-tauri"));
  assert.equal(releaseBinary({ CARGO_TARGET_DIR: "/build", CARGO_BUILD_TARGET: "aarch64-apple-darwin" }), "/build/aarch64-apple-darwin/release/flowshot-tauri");
});

test("shared-workspace launch evidence is preserved by default", () => {
  assert.equal(artifactDirectory({ AGENT_EVIDENCE_DIR: "/evidence" }), "/evidence/macos-launch");
  assert.equal(artifactDirectory({ AGENT_EVIDENCE_DIR: "/evidence", FLOWSHOT_LAUNCH_ARTIFACT_DIR: "/explicit" }), "/explicit");
});

test("malformed timing cannot pass the unchanged acceptance oracle", () => {
  for (const observedAtMs of [undefined, NaN, Infinity, -1, "100", null]) {
    assert.ok(assessLaunchSignals({ command: { observedAtMs }, window: { observedAtMs: 1 } }).length > 0);
  }
});

test("spawn failures return a diagnostic and leave no unhandled error", { timeout: 5000 }, async () => {
  const child = spawn("/nonexistent-flowshot-binary", [], { stdio: ["ignore", "pipe", "pipe"] });
  const outcome = await waitForCommand(child, { stdout: "" }, performance.now() + 1000, performance.now());
  assert.match(outcome.missingReason, /spawn|ENOENT/u);
  await stopProcess(child);
});

test("shutdown waits for and escalates an uncooperative child", { timeout: 5000 }, async () => {
  const child = spawn(process.execPath, ["-e", 'process.on("SIGTERM", () => {}); require("node:fs").writeSync(1, "ready"); setInterval(() => {}, 1000);'], { stdio: ["ignore", "pipe", "pipe"] });
  try {
    await once(child.stdout, "data");
    await stopProcess(child, 50);
    assert.equal(child.signalCode, "SIGKILL");
  } finally {
    child.kill("SIGKILL");
  }
});

test("a hung window probe is bounded and does not block IPC observation", { timeout: 5000 }, async () => {
  const directory = mkdtempSync(join(tmpdir(), "flowshot-probe-test-"));
  const executable = join(directory, "probe");
  writeFileSync(executable, `#!${process.execPath}\nsetInterval(() => {}, 1000);\n`, { mode: 0o700 });
  let ticked = false;
  const timer = setTimeout(() => { ticked = true; }, 20);
  try {
    const started = performance.now();
    const outcome = await waitForVisibleWindow(42, started + 150, started, executable);
    assert.ok(ticked, "IPC/event-loop callbacks must run during the probe");
    assert.match(outcome.missingReason, /timed out/u);
    assert.ok(performance.now() - started < 2000);
  } finally {
    clearTimeout(timer);
    rmSync(directory, { recursive: true });
  }
});

test("IPC completion is observed while the window probe is stalled", { timeout: 5000 }, async () => {
  const directory = mkdtempSync(join(tmpdir(), "flowshot-ipc-test-"));
  const executable = join(directory, "probe");
  writeFileSync(executable, `#!${process.execPath}\nsetInterval(() => {}, 1000);\n`, { mode: 0o700 });
  const record = JSON.stringify({ event: "command_complete", command: "get_build_info", resultCode: "OK", correlationId: "test-1" });
  const child = spawn(process.execPath, ["-e", `require("node:fs").writeSync(1, ${JSON.stringify(record + "\n")}); setInterval(() => {}, 1000);`], { stdio: ["ignore", "pipe", "pipe"] });
  const started = performance.now();
  try {
    const [command, window] = await Promise.all([
      waitForCommand(child, { stdout: "" }, started + 1500, started),
      waitForVisibleWindow(child.pid, started + 1000, started, executable),
    ]);
    assert.ok(command.observedAtMs < 1000, JSON.stringify(command));
    assert.match(window.missingReason, /timed out/u);
  } finally {
    await stopProcess(child, 50);
    rmSync(directory, { recursive: true });
  }
});
