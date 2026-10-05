import process from "node:process";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { seedPassword, waitForHttp } from "./helpers.ts";
import { prepareOwnedMember } from "./prepare-owned.ts";

const savedEnv = { ...process.env };
function restore() { for (const name of Object.keys(process.env)) if (!(name in savedEnv)) delete process.env[name]; Object.assign(process.env, savedEnv); }

test("browser credentials ignore CMS_SEED_PASSWORD fallback and read only explicit source", () => {
  const directory = mkdtempSync(join(tmpdir(), "cms-w5-helper-test-"));
  try {
    delete process.env.CMS_E2E_PASSWORD;
    process.env.CMS_SEED_PASSWORD = "must-not-use";
    process.env.CMS_E2E_PASSWORD_FILE = join(directory, "missing");
    assert.throws(() => seedPassword("seed-admin"), /Missing private/);
    writeFileSync(join(directory, "passwords"), "seed-admin=private-secret\n", { mode: 0o600 });
    process.env.CMS_E2E_PASSWORD_FILE = join(directory, "passwords");
    assert.equal(seedPassword("seed-admin"), "private-secret");
    assert.throws(() => seedPassword("seed-operator-album"), /No password/);
    process.env.CMS_E2E_PASSWORD = "explicit-shared";
    assert.equal(seedPassword("seed-admin"), "explicit-shared");
  } finally { restore(); rmSync(directory, { recursive: true, force: true }); }
});

test("HTTP readiness polls non-OK responses and returns on successful GET", async () => {
  const fetch = globalThis.fetch; const calls = [];
  try {
    globalThis.fetch = async (url, options) => { calls.push({ url, options }); return new globalThis.Response("", { status: calls.length === 1 ? 503 : 200 }); };
    await waitForHttp("http://localhost:8080/actuator/health");
    assert.equal(calls.length, 2); assert.ok(calls[0].options.signal instanceof globalThis.AbortSignal);
  } finally { globalThis.fetch = fetch; }
});

test("HTTP readiness times out explicitly after sixty seconds", async () => {
  const now = Date.now; let tick = 0;
  try { Date.now = () => (tick++ * 60_001); await assert.rejects(waitForHttp("http://localhost:8080"), /60 seconds/); }
  finally { Date.now = now; }
});

function fakeSetup({ existing = false, denied = false, foreign = false } = {}) {
  const calls = []; let index = 0;
  const leo = { title: "Leo", payload: { title: "Leo", name: "Leo", petType: "cat", owner: "owner-id", ownerPrincipalId: "member-id" } };
  const result = (data, status = 200) => ({ ok: () => status < 400, status: () => status, json: async () => data });
  const factory = async (options) => {
    const current = index++;
    return {
      post: async (url, data) => { calls.push({ url, data, options }); return url.endsWith("/login") ? result({ csrfToken: "private-csrf" }) : result({}, denied ? 403 : 201); },
      get: async (url) => {
        calls.push({ url, options });
        if (current === 0) return result({ items: [leo, ...(existing ? [{ title: "Mochi", payload: { ownerPrincipalId: foreign ? "other-id" : "member-id" } }] : [])], total: existing ? 2 : 1 });
        return result({ items: [{ title: "Leo" }, { title: "Mochi" }] });
      },
      dispose: async () => { calls.push({ disposed: current }); },
    };
  };
  return { factory, calls };
}

test("disposable member setup refuses absent/shared project markers before API requests", async () => {
  const h = fakeSetup();
  for (const marker of [undefined, "cms-scaffold", "cms-w5-e2e-user-chosen"]) await assert.rejects(prepareOwnedMember(marker, h.factory), /disposable project/);
  assert.equal(h.calls.length, 0);
});

test("disposable Mochi setup clones Leo binding through authorized API and verifies owned list", async () => {
  const h = fakeSetup(); process.env.CMS_E2E_PASSWORD = "private-secret";
  try {
    await prepareOwnedMember("cms-w5-e2e-123-0123456789abcdef", h.factory);
    const create = h.calls.find((c) => c.url?.endsWith("/content-types/pet/entries"));
    assert.equal(create.data.data.payload.owner, "owner-id"); assert.equal(create.data.data.payload.ownerPrincipalId, "member-id");
    assert.equal(create.data.data.payload.title, "Mochi"); assert.equal(create.data.headers["X-CSRF-Token"], "private-csrf");
    assert.ok(h.calls.some((c) => c.url?.includes("/api/v1/me/content-types/pet/entries")));
    assert.equal(h.calls.filter((c) => "disposed" in c).length, 2);
  } finally { restore(); }
});

test("existing owned Mochi is not duplicated, wrong binding and API denial fail setup", async () => {
  process.env.CMS_E2E_PASSWORD = "private-secret";
  try {
    const existing = fakeSetup({ existing: true });
    await prepareOwnedMember("cms-w5-e2e-123-0123456789abcdef", existing.factory);
    assert.ok(!existing.calls.some((c) => c.url?.endsWith("/content-types/pet/entries")));
    await assert.rejects(prepareOwnedMember("cms-w5-e2e-123-0123456789abcdef", fakeSetup({ existing: true, foreign: true }).factory), /different principal/);
    await assert.rejects(prepareOwnedMember("cms-w5-e2e-123-0123456789abcdef", fakeSetup({ denied: true }).factory), /creation failed \(403\)/);
  } finally { restore(); }
});
