import process from "node:process";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { seedPassword, waitForHttp } from "./helpers.ts";
import { request } from "@playwright/test";
import { prepareOwnedMember } from "./prepare-owned.ts";
import * as owned from "./prepare-owned.ts";

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

test("default API factory retains Playwright request receiver", async () => {
  const original = request.newContext; const h = fakeSetup();
  process.env.CMS_E2E_PASSWORD = "private-secret";
  try {
    request.newContext = async function (options) {
      assert.ok(this === request, "Playwright APIRequest.newContext requires its receiver");
      return h.factory(options);
    };
    await prepareOwnedMember("cms-w5-e2e-123-0123456789abcdef");
    assert.equal(h.calls.filter((c) => "disposed" in c).length, 2);
  } finally { request.newContext = original; restore(); }
});

const ownedProject = "cms-w5-e2e-123-0123456789abcdef";
const newAlbumId = "00000000-0000-4000-8000-000000000960";
const existingAlbumId = "00000000-0000-4000-8000-000000000001";
function fakeAuditSetup({ failAt, createdId = newAlbumId, mismatch = false, total = 1 } = {}) {
  const calls = [];
  const result = (data, stage) => ({ ok: () => failAt !== stage, status: () => failAt === stage ? 403 : 200, json: async () => data });
  const factory = async (options) => ({
    post: async (url, options) => {
      calls.push({ url, options });
      if (url.endsWith("/login")) return result({ csrfToken: "private-csrf" }, "login");
      if (url.endsWith("/publish")) return result({ id: createdId, publicationState: "published" }, "publish");
      return result({ id: createdId, contentType: "album", slug: mismatch ? "someone-else" : options.data.slug, title: options.data.payload.title, payload: options.data.payload, publicationState: "draft" }, "create");
    },
    get: async (url) => { calls.push({ url, options }); return result({ items: [{ id: existingAlbumId }], total }, "list"); },
    dispose: async () => { calls.push({ disposed: true }); },
  });
  return { factory, calls };
}

test("owned audit setup creates a unique unlisted album and publishes only its validated new ID", async () => {
  assert.equal(typeof owned.prepareOwnedAudit, "function", "owned audit preparation must exist before it can cover real nonempty detail");
  const h = fakeAuditSetup(); process.env.CMS_E2E_PASSWORD = "private-secret";
  try {
    assert.equal(await owned.prepareOwnedAudit(ownedProject, h.factory), newAlbumId);
    const creates = h.calls.filter((c) => c.url?.endsWith("/content-types/album/entries"));
    assert.equal(creates.length, 1);
    assert.match(creates[0].options.data.slug, new RegExp(`^w5-audit-${ownedProject}-[0-9a-f-]{36}$`));
    assert.equal(creates[0].options.data.payload.visibility, "unlisted");
    const publishes = h.calls.filter((c) => c.url?.endsWith("/publish"));
    assert.equal(publishes.length, 1); assert.ok(publishes[0].url.endsWith(`/entries/${newAlbumId}/publish`));
    assert.equal(publishes[0].options.headers["X-CSRF-Token"], "private-csrf");
    assert.equal(h.calls.filter((c) => c.disposed).length, 1);
  } finally { restore(); }
});

test("owned audit setup refuses shared markers before context creation or API requests", async () => {
  const h = fakeAuditSetup(); let contexts = 0;
  for (const project of [undefined, "cms-scaffold", "cms-w5-e2e-shared"]) {
    await assert.rejects(owned.prepareOwnedAudit(project, async (options) => { contexts++; return h.factory(options); }), /disposable project/);
  }
  assert.equal(contexts, 0); assert.equal(h.calls.length, 0);
});

test("owned setup refuses every non-local origin before creating an API context", () => {
  for (const variable of ["CMS_E2E_API", "CMS_E2E_BACK", "CMS_E2E_FRONT", "CMS_E2E_ADMIN"]) {
    const script = `import assert from "node:assert/strict";
      import { prepareOwnedAudit, prepareOwnedMember } from "./e2e/prepare-owned.ts";
      let contexts = 0; const factory = async () => { contexts++; throw new Error("must not create context"); };
      for (const prepare of [prepareOwnedAudit, prepareOwnedMember]) await assert.rejects(prepare("${ownedProject}", factory), /non-local/);
      assert.equal(contexts, 0);`;
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8", env: { ...process.env, [variable]: "https://shared.invalid" } });
    assert.equal(result.status, 0, result.stderr);
  }
});

test("owned audit setup refuses an incomplete existing-ID list before any create or publish", async () => {
  const h = fakeAuditSetup({ total: 101 }); process.env.CMS_E2E_PASSWORD = "private-secret";
  try {
    await assert.rejects(owned.prepareOwnedAudit(ownedProject, h.factory), /list is incomplete/);
    assert.equal(h.calls.filter((c) => c.url && !c.url.endsWith("/login") && !c.url.includes("?size=100")).length, 0);
    assert.equal(h.calls.filter((c) => c.disposed).length, 1);
  } finally { restore(); }
});

test("owned audit setup fails closed and disposes on each API failure", async () => {
  process.env.CMS_E2E_PASSWORD = "private-secret";
  try {
    for (const failAt of ["login", "list", "create", "publish"]) {
      const h = fakeAuditSetup({ failAt });
      await assert.rejects(owned.prepareOwnedAudit(ownedProject, h.factory), /failed \(403\)/);
      assert.equal(h.calls.filter((c) => c.disposed).length, 1);
      if (failAt !== "publish") assert.equal(h.calls.filter((c) => c.url?.endsWith("/publish")).length, 0);
    }
  } finally { restore(); }
});

test("owned audit setup never publishes malformed, existing, or mismatched create responses", async () => {
  process.env.CMS_E2E_PASSWORD = "private-secret";
  try {
    for (const options of [{ createdId: undefined }, { createdId: "not-an-id" }, { createdId: existingAlbumId }, { mismatch: true }]) {
      const h = fakeAuditSetup(options.createdId === undefined && !options.mismatch ? { createdId: null } : options);
      await assert.rejects(owned.prepareOwnedAudit(ownedProject, h.factory), /new owned album/);
      assert.equal(h.calls.filter((c) => c.url?.endsWith("/publish")).length, 0);
      assert.equal(h.calls.filter((c) => c.disposed).length, 1);
    }
  } finally { restore(); }
});

test("owned audit default factory retains Playwright request receiver", async () => {
  const original = request.newContext; const h = fakeAuditSetup();
  process.env.CMS_E2E_PASSWORD = "private-secret";
  try {
    request.newContext = async function (options) { assert.equal(this, request); return h.factory(options); };
    assert.equal(await owned.prepareOwnedAudit(ownedProject), newAlbumId);
    assert.equal(h.calls.filter((c) => c.disposed).length, 1);
  } finally { request.newContext = original; restore(); }
});
