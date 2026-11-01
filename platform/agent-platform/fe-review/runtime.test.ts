import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assertSafeDatabase,
  confirmedFixtureShutdown,
  cleanupAll,
  publicText,
} from "./runtime.ts";

test("database precondition rejects non-loopback and non-dedicated state", () => {
  assert.doesNotThrow(() =>
    assertSafeDatabase(
      "postgresql://synthetic:random@127.0.0.1:5432/agent_platform_test",
    ),
  );
  for (const url of [
    "postgresql://synthetic:random@db:5432/agent_platform_test",
    "postgresql://synthetic:random@127.0.0.1:5432/production",
    "postgresql://synthetic@127.0.0.1:5432/agent_platform_test",
  ])
    assert.throws(() => assertSafeDatabase(url));
});
test("public guard excludes credentials, database URLs and private paths", () => {
  assert.equal(
    publicText({ state: "queued" }, ["secret-value"]),
    '{"state":"queued"}',
  );
  for (const value of [
    "secret-value",
    "postgresql://hidden",
    "/home/private/state",
    { csrf_token: "hidden" },
  ])
    assert.throws(() => publicText(value, ["secret-value"]));
});
test("a failed browser close never prevents owned child cleanup", async () => {
  const called: string[] = [];
  const errors = await cleanupAll([
    async () => {
      called.push("browser");
      throw Error("injected close failure");
    },
    async () => {
      called.push("producer");
    },
    async () => {
      called.push("server");
    },
  ]);
  assert.deepEqual(called, ["browser", "producer", "server"]);
  assert.deepEqual(errors, ["cleanup_0_failed"]);
});

test("Uvicorn re-raised SIGTERM requires completed graceful shutdown evidence", () => {
  const completed =
    "Application shutdown complete.\nFinished server process [1]";
  assert.equal(
    confirmedFixtureShutdown({ code: null, signal: "SIGTERM" }, completed),
    true,
  );
  assert.equal(
    confirmedFixtureShutdown({ code: 0, signal: null }, completed),
    true,
  );
  assert.equal(
    confirmedFixtureShutdown(
      { code: null, signal: "SIGTERM" },
      "Shutting down",
    ),
    false,
  );
  assert.equal(
    confirmedFixtureShutdown({ code: null, signal: "SIGKILL" }, completed),
    false,
  );
  assert.equal(
    confirmedFixtureShutdown({ code: 1, signal: null }, completed),
    false,
  );
});
