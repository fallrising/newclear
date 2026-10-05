import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { redact } from "./redaction.mjs";
import { run, composeCommand, seedCredentials } from "./runner.mjs";

const secret = "runner-password-$'[]";
function harness(behavior = () => null) {
  const directory = mkdtempSync(join(tmpdir(), "cms-w5-runner-test-"));
  const calls = [];
  const exec = async (file, args, options = {}) => {
    calls.push({ file, args, env: options.env });
    const override = behavior(file, args, options);
    if (override) return override;
    if (args.includes("version")) return { code: 0, stdout: "Docker Compose version v2.40.0", stderr: "" };
    if (args.includes("java")) return { code: 0, stdout: "openjdk 25.0.1 2025-10-21\nOpenJDK Runtime Environment Temurin-25.0.1", stderr: "" };
    if (file === "git") return { code: 0, stdout: args[0] === "rev-parse" ? "a".repeat(40) : "", stderr: "" };
    if (file === "npx" || args[0] === "run") {
      const report = { stats: { expected: 14, unexpected: 0, skipped: 0, flaky: 0 } };
      writeFileSync(join(directory, "test-results/frontend/real-results.json"), JSON.stringify(report));
    }
    return { code: 0, stdout: "", stderr: "" };
  };
  return { directory, calls, exec, dispose: () => rmSync(directory, { recursive: true, force: true }) };
}

test("redaction masks literal secrets, cookies, CSRF and Authorization in plain/JSON logs", () => {
  const source = `${secret}\ncms_session=session-token; HttpOnly\nX-CSRF-Token: csrf-token\nAuthorization: Bearer auth-token\n{"csrfToken":"json-csrf","name":"Cookie","value":"cms_session=json-cookie"}\n{"name":"Authorization","value":"Bearer json-auth"}`;
  const output = redact(source, [secret]);
  for (const value of [secret, "session-token", "csrf-token", "auth-token", "json-csrf", "json-cookie", "json-auth"]) assert.ok(!output.includes(value), value);
  assert.ok(output.includes("[REDACTED]"));
});

test("redaction covers JSON-escaped secret and is idempotent", () => {
  const output = redact(JSON.stringify({ error: secret }), [secret]);
  assert.ok(!output.includes(JSON.stringify(secret).slice(1, -1)));
  assert.equal(redact(output, [secret]), output);
});

test("Compose executable override is one executable, no shell interpolation", () => {
  assert.deepEqual(composeCommand({ CMS_DOCKER_COMPOSE: "/workspace/local/docker-compose" }), { file: "/workspace/local/docker-compose", prefix: [] });
  assert.deepEqual(composeCommand({}), { file: "docker", prefix: ["compose"] });
});

test("missing password fails preflight before Docker and still records failed attempt", async () => {
  const h = harness();
  try {
    assert.equal(await run({ root: h.directory, env: {}, exec: h.exec }), 2);
    assert.equal(h.calls.filter((x) => x.file === "docker" || x.file === "npx").length, 0);
    const record = JSON.parse(readFileSync(join(h.directory, "test-results/frontend/real-e2e.json")));
    assert.equal(record.exitCode, 2); assert.equal(record.total, 14); assert.equal(record.passed, 0); assert.equal(record.attempt, 1);
    assert.equal(record.result, "failed"); assert.equal(record.failureClass, "preflight");
  } finally { h.dispose(); }
});

test("bootstrap generates ephemeral secret only on explicit opt-in", () => {
  assert.throws(() => seedCredentials({}, "/missing"), /password/i);
  const credentials = seedCredentials({ CMS_E2E_BOOTSTRAP: "1" }, "/missing");
  assert.ok(credentials.password.length >= 32);
  assert.equal(credentials.apiEnvironment.CMS_SEED_PASSWORD, credentials.password);
});

test("private per-user password file wires the exact API seed variables", () => {
  const h = harness();
  try {
    const file = join(h.directory, "passwords.txt");
    writeFileSync(file, "# private\nseed-admin=one\nseed-operator-album=two\n", { mode: 0o600 });
    const credentials = seedCredentials({ CMS_E2E_PASSWORD_FILE: file }, h.directory);
    assert.equal(credentials.apiEnvironment.CMS_SEED_PASSWORD_SEED_ADMIN, "one");
    assert.equal(credentials.apiEnvironment.CMS_SEED_PASSWORD_SEED_OPERATOR_ALBUM, "two");
    assert.deepEqual(credentials.secrets, ["one", "two"]);
    assert.throws(() => seedCredentials({ CMS_E2E_PASSWORD_FILE: join(h.directory, "absent") }, h.directory), /password/i);
  } finally { h.dispose(); }
});

test("all lifecycle commands use a newly owned project; no pre-start down or shared cleanup", async () => {
  const h = harness();
  try {
    assert.equal(await run({ root: h.directory, env: { CMS_E2E_PASSWORD: secret }, exec: h.exec }), 0);
    const compose = h.calls.filter((x) => x.args.includes("--project-name"));
    const names = compose.map((x) => x.args[x.args.indexOf("--project-name") + 1]);
    assert.ok(names.every((x) => /^cms-w5-e2e-[a-z0-9-]+$/.test(x))); assert.equal(new Set(names).size, 1);
    assert.ok(compose.findIndex((x) => x.args.includes("up")) < compose.findIndex((x) => x.args.includes("down")));
    assert.equal(compose.filter((x) => x.args.includes("down")).length, 1);
    assert.ok(compose.find((x) => x.args.includes("down")).args.includes("--volumes"));
    const override = readFileSync(join(h.directory, "test-results/frontend/real-e2e.json"), "utf8");
    assert.ok(!override.includes(secret));
  } finally { h.dispose(); }
});

test("failed login exit and summary survive owned cleanup; logs contain no secrets", async () => {
  const h = harness((file, args) => (file === "npx" || args[0] === "run") ? { code: 1, stdout: `login failed ${secret}`, stderr: "cms_session=abc; X-CSRF-Token: token" } : null);
  try {
    assert.equal(await run({ root: h.directory, env: { CMS_E2E_PASSWORD: secret }, exec: h.exec }), 1);
    assert.ok(h.calls.some((x) => x.args.includes("down")));
    const record = JSON.parse(readFileSync(join(h.directory, "test-results/frontend/real-e2e.json")));
    assert.equal(record.result, "failed"); assert.equal(record.passed, 0); assert.equal(record.exitCode, 1);
    const logs = readFileSync(join(h.directory, record.artifact.replace("real-e2e.json", "playwright.log")), "utf8");
    assert.ok(!logs.includes(secret)); assert.ok(!logs.includes("cms_session=abc"));
  } finally { h.dispose(); }
});

test("failed stack startup still cleans only owned resources and records the attempt", async () => {
  const h = harness((_file, args) => args.includes("up") ? { code: 1, stdout: "", stderr: `startup ${secret}` } : null);
  try {
    assert.equal(await run({ root: h.directory, env: { CMS_E2E_PASSWORD: secret }, exec: h.exec }), 1);
    assert.ok(h.calls.some((x) => x.args.includes("down")));
    assert.ok(!h.calls.some((x) => x.file === "npx"));
    const record = JSON.parse(readFileSync(join(h.directory, "test-results/frontend/real-e2e.json")));
    assert.equal(record.failureClass, "stack");
  } finally { h.dispose(); }
});

test("existing project resources cause refusal, never cleanup or start", async () => {
  const h = harness((_file, args) => args[0] === "ps" ? { code: 0, stdout: "someone-else\n", stderr: "" } : null);
  try {
    assert.equal(await run({ root: h.directory, env: { CMS_E2E_PASSWORD: secret }, exec: h.exec }), 2);
    assert.ok(!h.calls.some((x) => x.args.includes("down") || x.args.includes("up")));
  } finally { h.dispose(); }
});

test("wrong ownership label blocks teardown even after our startup attempt", async () => {
  let started = false;
  const h = harness((_file, args) => {
    if (args.includes("up")) started = true;
    if (args[0] === "ps" && started) return { code: 0, stdout: "container-id\n", stderr: "" };
    if (args[0] === "inspect") return { code: 0, stdout: "different-owner\n", stderr: "" };
    return null;
  });
  try {
    assert.equal(await run({ root: h.directory, env: { CMS_E2E_PASSWORD: secret }, exec: h.exec }), 1);
    assert.ok(!h.calls.some((x) => x.args.includes("down")));
    const record = JSON.parse(readFileSync(join(h.directory, "test-results/frontend/real-e2e.json")));
    assert.equal(record.failureClass, "cleanup");
  } finally { h.dispose(); }
});

test("cleanup failure changes an otherwise passing run into a failed record", async () => {
  const h = harness((_file, args) => args.includes("down") ? { code: 1, stdout: "", stderr: "cleanup failed" } : null);
  try {
    assert.equal(await run({ root: h.directory, env: { CMS_E2E_PASSWORD: secret }, exec: h.exec }), 1);
    const record = JSON.parse(readFileSync(join(h.directory, "test-results/frontend/real-e2e.json")));
    assert.equal(record.passed, 14); assert.equal(record.result, "failed"); assert.equal(record.failureClass, "cleanup");
  } finally { h.dispose(); }
});

test("each repeated attempt retains an immutable separate record and increments attempt", async () => {
  const h = harness();
  try {
    await run({ root: h.directory, env: { CMS_E2E_PASSWORD: secret }, exec: h.exec });
    const first = JSON.parse(readFileSync(join(h.directory, "test-results/frontend/real-e2e.json")));
    await run({ root: h.directory, env: { CMS_E2E_PASSWORD: secret }, exec: h.exec });
    const second = JSON.parse(readFileSync(join(h.directory, "test-results/frontend/real-e2e.json")));
    assert.equal(second.attempt, first.attempt + 1); assert.notEqual(first.artifact, second.artifact);
    assert.ok(existsSync(join(h.directory, first.artifact))); assert.ok(existsSync(join(h.directory, second.artifact)));
    assert.notEqual(first.stack, second.stack);
  } finally { h.dispose(); }
});

test("cleanup returning success with remaining owned resources still fails acceptance", async () => {
  let down = false;
  const h = harness((_file, args) => {
    if (args.includes("down")) down = true;
    if (args[0] === "volume" && args[1] === "ls" && down) return { code: 0, stdout: "remaining-owned-volume\n", stderr: "" };
    return null;
  });
  try {
    assert.equal(await run({ root: h.directory, env: { CMS_E2E_PASSWORD: secret }, exec: h.exec }), 1);
    const record = JSON.parse(readFileSync(join(h.directory, "test-results/frontend/real-e2e.json")));
    assert.equal(record.failureClass, "cleanup"); assert.equal(record.result, "failed");
  } finally { h.dispose(); }
});

test("a skipped journey or missing report cannot be accepted despite process exit zero", async () => {
  for (const missing of [true, false]) {
    const h = harness((file, args) => {
      if (file !== "npx" && args[0] !== "run") return null;
      if (!missing) writeFileSync(join(h.directory, "test-results/frontend/real-results.json"), JSON.stringify({ stats: { expected: 13, unexpected: 0, skipped: 1, flaky: 0 } }));
      return { code: 0, stdout: "", stderr: "" };
    });
    try {
      assert.equal(await run({ root: h.directory, env: { CMS_E2E_PASSWORD: secret }, exec: h.exec }), 1);
      assert.ok(h.calls.some((call) => call.args.includes("down")));
    } finally { h.dispose(); }
  }
});

test("interrupted browser execution retains failure and completes owned cleanup without the aborted signal", async () => {
  const controller = new globalThis.AbortController();
  const h = harness((file, args, options) => {
    if (file === "npx" || args[0] === "run") { controller.abort(); return { code: 130, stdout: "interrupted", stderr: "" }; }
    if (args.includes("down")) assert.equal(options.signal, undefined);
    return null;
  });
  try {
    assert.equal(await run({ root: h.directory, env: { CMS_E2E_PASSWORD: secret }, exec: h.exec, signal: controller.signal }), 130);
    assert.ok(h.calls.some((call) => call.args.includes("down")));
    const record = JSON.parse(readFileSync(join(h.directory, "test-results/frontend/real-e2e.json")));
    assert.equal(record.exitCode, 130); assert.equal(record.result, "failed");
  } finally { h.dispose(); }
});

test("attempt artifacts are separate and text evidence is redacted before handoff", async () => {
  const h = harness((file, args, options) => {
    if (file !== "npx" && args[0] !== "run") return null;
    const artifacts = join(h.directory, options.env.CMS_E2E_ARTIFACT_DIR);
    mkdirSync(artifacts, { recursive: true });
    writeFileSync(join(artifacts, "error-context.md"), `password ${secret} cms_session=artifact-cookie`);
    writeFileSync(join(h.directory, "test-results/frontend/real-results.json"), JSON.stringify({ stats: { expected: 14, unexpected: 0, skipped: 0, flaky: 0 } }));
    return { code: 0, stdout: "", stderr: "" };
  });
  try {
    assert.equal(await run({ root: h.directory, env: { CMS_E2E_PASSWORD: secret }, exec: h.exec }), 0);
    const record = JSON.parse(readFileSync(join(h.directory, "test-results/frontend/real-e2e.json")));
    const context = readFileSync(join(h.directory, record.artifact.replace("real-e2e.json", "artifacts/error-context.md")), "utf8");
    assert.ok(!context.includes(secret)); assert.ok(!context.includes("artifact-cookie"));
  } finally { h.dispose(); }
});
