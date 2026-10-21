import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { APIRequestContext, Page } from "@playwright/test";
import { test, expect } from "../fixtures/kith.ts";
import { ACCOUNTS } from "../fixtures/accounts.ts";
import { loginViaUi, openActor } from "../fixtures/actors.ts";
import { fakeProviderLog } from "../fixtures/console.ts";
import { note, shot } from "../harness/evidence.ts";
import { KITH_DIR, WRANGLER_BIN } from "../harness/paths.ts";
import { wranglerEnv } from "../harness/server.ts";

// Only inspect the SQLite backing this run's isolated local D1. No production binding or data.
function stateDir(): string {
  const dir = process.env.KITH_E2E_RUN_DIR;
  if (process.env.KITH_E2E_SETUP_OK !== "1" || !dir) throw new Error("isolated E2E setup required");
  return join(dir, "state");
}
function databaseFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? databaseFiles(path) : entry.name.endsWith(".sqlite") ? [path] : [];
  });
}
function query(sql: string, ...values: string[]): Record<string, unknown>[] {
  for (const file of databaseFiles(join(stateDir(), "v3", "d1"))) {
    const db = new DatabaseSync(file, { readOnly: true });
    try {
      if (!db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'members'").get()) continue;
      return db.prepare(sql).all(...values) as Record<string, unknown>[];
    } finally { db.close(); }
  }
  throw new Error("isolated Kith D1 database not found");
}
function captures(key: string): Record<string, unknown>[] {
  return query("SELECT id, body, source, client_key, exported_commit FROM captures WHERE client_key = ?", key);
}
function snapshot(): Record<string, unknown> {
  // Compare complete rows, not merely counts, so an accidental edit also fails.
  return {
    messages: query("SELECT * FROM messages ORDER BY id"),
    captures: query("SELECT * FROM captures ORDER BY id"),
    notes: query("SELECT * FROM notes ORDER BY id"),
  };
}
async function request(request: APIRequestContext, method: string, path: string, body?: unknown) {
  const csrf = method === "GET" ? null : await (await request.get("/api/csrf")).json() as { csrf: string };
  return request.fetch(path, {
    method,
    headers: csrf ? { "X-CSRF-Token": csrf.csrf } : {},
    ...(body === undefined ? {} : { data: body }),
  });
}
async function openCapture(page: Page): Promise<void> {
  await loginViaUi(page, ACCOUNTS.ada);
  await expect(page.getByTestId("capture-link")).toBeVisible();
  await page.getByTestId("capture-link").click();
  await expect(page).toHaveURL(/\/captures$/);
  await expect(page.getByTestId("capture-body")).toBeVisible();
}
const SAVED = /已保存|saved/i;
const LOCAL = /本機草稿|local draft/i;
const UNKNOWN = /未知|不確定|unknown|uncertain/i;
const NOT_STORED = /未存妥|無法.*儲存|未能.*儲存|could not.*save|unable.*save|not.*saved|storage/i;

test("E2E-RC-01 raw capture persists in D1 and the paginated inbox @mobile", { tag: ["@RC"] }, async ({ page }, info) => {
  test.setTimeout(180_000);
  await openCapture(page);
  const messagesBefore = query("SELECT * FROM messages ORDER BY id");
  const providersBefore = (await fakeProviderLog()).length;
  const raw = "  快記 café 👩🏽‍💻\n\n  <script>synthetic only</script>\t\n尾端  ";
  await page.getByTestId("capture-body").fill(raw);
  const responsePromise = page.waitForResponse((res) => new URL(res.url()).pathname === "/api/captures" && res.request().method() === "POST");
  await page.getByTestId("capture-save").click();
  const response = await responsePromise;
  expect(response.status()).toBe(201);
  expect(response.headers()["cache-control"]).toContain("no-store");
  const { capture_id: id } = await response.json() as { capture_id: string };
  expect(id).toBeTruthy();
  const sent = response.request().postDataJSON() as { client_key: string };
  expect(captures(sent.client_key)).toEqual([{ id, body: raw, source: "web", client_key: sent.client_key, exported_commit: null }]);
  await expect(page.getByTestId("capture-status")).toContainText(SAVED);
  await expect(page.getByTestId("capture-body")).toHaveValue("");
  await page.reload();
  // Match the actual row directly: preserve textContent, including leading/trailing whitespace.
  const savedRow = page.getByTestId("capture-inbox").locator(`[data-capture-id="${id}"]`);
  await expect(savedRow).toContainText(SAVED);
  await expect(savedRow).toContainText(/待匯出|pending export/i);
  expect(await savedRow.textContent()).toContain(raw);
  expect(await savedRow.locator("script").count()).toBe(0);
  await shot(page, info, "raw-saved");

  // Two pages share a stable keyset even when captures have the same timestamp.
  for (let i = 0; i < 21; i++) {
    const added = await request(page.request, "POST", "/api/captures", { body: `page ${i}`, client_key: randomUUID() });
    expect(added.status()).toBe(201);
  }
  const seen = new Set<string>();
  let cursor: string | null = null;
  for (let pages = 0; ; pages++) {
    expect(pages, "pagination terminates").toBeLessThan(100);
    const result = await request(page.request, "GET", "/api/captures?limit=2" + (cursor === null ? "" : "&cursor=" + encodeURIComponent(cursor)));
    expect(result.status()).toBe(200);
    expect(result.headers()["cache-control"]).toContain("no-store");
    const data = await result.json() as { captures: { id: string }[]; next_cursor: string | null };
    expect(data.captures.length).toBeLessThanOrEqual(2);
    for (const capture of data.captures) { expect(seen.has(capture.id)).toBe(false); seen.add(capture.id); }
    cursor = data.next_cursor;
    if (cursor === null) break;
    expect(typeof cursor).toBe("string");
    expect(cursor.length).toBeLessThanOrEqual(1024);
  }
  expect(seen.size).toBe(query("SELECT id FROM captures").length);
  expect(seen.has(id)).toBe(true);
  await page.reload();
  await expect(page.getByTestId("capture-inbox").locator("[data-capture-id]")).toHaveCount(20);
  await page.getByTestId("capture-more").click();
  await expect(page.getByTestId("capture-inbox").locator(`[data-capture-id="${id}"]`)).toBeVisible();
  expect(await page.getByTestId("capture-inbox").locator("[data-capture-id]").count()).toBeLessThanOrEqual(20);
  expect(query("SELECT * FROM messages ORDER BY id")).toEqual(messagesBefore);
  expect((await fakeProviderLog()).length).toBe(providersBefore);
  note(info, "Raw UTF-8/newlines/whitespace survived HTTP, local D1 and reload; finite keyset pages cover each capture once; no provider calls or message changes.");
});

test("E2E-RC-02 lost response preserves the key and replay never overwrites @mobile", { tag: ["@RC"] }, async ({ page }, info) => {
  test.setTimeout(180_000);
  await openCapture(page);
  const messagesBefore = query("SELECT * FROM messages ORDER BY id");
  const providersBefore = (await fakeProviderLog()).length;
  const raw = "RC02 synthetic uncertain 原文\n  ";
  const sent: { body: string; client_key: string }[] = [];
  let committedId = "";
  let cut = true;
  await page.route("**/api/captures", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    sent.push(route.request().postDataJSON() as { body: string; client_key: string });
    if (!cut) return route.continue();
    cut = false;
    const upstream = await route.fetch();
    expect(upstream.status()).toBe(201);
    committedId = (await upstream.json() as { capture_id: string }).capture_id;
    // Read persistence before dropping the response. A pre-commit abort cannot satisfy RC-02.
    expect(captures(sent[0]!.client_key)).toHaveLength(1);
    expect(captures(sent[0]!.client_key)[0]?.id).toBe(committedId);
    await route.abort("connectionreset");
  });
  await page.getByTestId("capture-body").fill(raw);
  await page.getByTestId("capture-save").click();
  await expect(page.getByTestId("capture-status")).toContainText(UNKNOWN);
  await expect(page.getByTestId("capture-body")).toHaveValue(raw);
  expect(sent).toHaveLength(1);
  await page.reload();
  await expect(page.getByTestId("capture-body")).toHaveValue(raw);
  await expect(page.getByTestId("capture-status")).toContainText(UNKNOWN);
  const retry = page.waitForResponse((res) => new URL(res.url()).pathname === "/api/captures" && res.request().method() === "POST");
  await page.getByTestId("capture-save").click();
  expect((await retry).status()).toBe(200);
  expect(await (await retry).json()).toEqual({ capture_id: committedId });
  expect(sent).toHaveLength(2);
  expect(sent[1]).toEqual(sent[0]);
  await expect(page.getByTestId("capture-status")).toContainText(SAVED);
  expect(captures(sent[0]!.client_key)).toHaveLength(1);

  const key = randomUUID();
  // Obtain CSRF once before parallel requests; rotating it independently would test CSRF races.
  const csrf = await (await page.request.get("/api/csrf")).json() as { csrf: string };
  const post = (body: string, client_key = key) => page.request.post("/api/captures", { headers: { "X-CSRF-Token": csrf.csrf }, data: { body, client_key } });
  const concurrent = await Promise.all([post(raw), post(raw)]);
  expect(concurrent.map((r) => r.status()).sort()).toEqual([200, 201]);
  const identities = await Promise.all(concurrent.map((r) => r.json() as Promise<{ capture_id: string }>));
  expect(identities[0]).toEqual(identities[1]);
  expect(captures(key)).toHaveLength(1);
  const conflict = await post("different synthetic body");
  expect(conflict.status()).toBe(409);
  expect((await conflict.json() as { error: { code: string } }).error.code).toBe("capture_conflict");
  expect(captures(key)[0]?.body).toBe(raw);
  const distinct = await post(raw, randomUUID());
  expect(distinct.status()).toBe(201);
  expect((await distinct.json() as { capture_id: string }).capture_id).not.toBe(identities[0]?.capture_id);

  // A competing payload wins this browser's key: display conflict, preserve its unsaved text.
  await page.unroute("**/api/captures");
  let conflictKey = "";
  await page.route("**/api/captures", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    const payload = route.request().postDataJSON() as { body: string; client_key: string };
    conflictKey = payload.client_key;
    // Keep the cookie/header pair from the real browser submission. Rotating CSRF here
    // would introduce a fixture-only mismatch before the intended key conflict.
    const rival = await page.request.post("/api/captures", {
      headers: { "X-CSRF-Token": route.request().headers()["x-csrf-token"]! },
      data: { ...payload, body: "winning synthetic body" },
    });
    expect(rival.status()).toBe(201);
    const result = await route.fetch();
    expect(result.status()).toBe(409);
    await route.fulfill({ response: result });
  });
  const unsaved = "browser conflict must remain unsaved";
  await page.getByTestId("capture-body").fill(unsaved);
  await page.getByTestId("capture-save").click();
  await expect(page.getByTestId("capture-status")).toContainText(/衝突|conflict/i);
  await expect(page.getByTestId("capture-body")).toHaveValue(unsaved);
  expect(captures(conflictKey)[0]?.body).toBe("winning synthetic body");
  expect(query("SELECT * FROM messages ORDER BY id")).toEqual(messagesBefore);
  expect((await fakeProviderLog()).length).toBe(providersBefore);
  await shot(page, info, "conflict-preserved");
  await page.unroute("**/api/captures");
  const priorResolution = query("SELECT id FROM captures").length;
  await page.getByTestId("capture-conflict-new").click();
  await expect(page.getByTestId("capture-body")).toHaveValue(unsaved);
  await expect(page.getByTestId("capture-body")).toBeEditable();
  await expect(page.getByTestId("capture-status")).toContainText(LOCAL);
  expect(query("SELECT id FROM captures")).toHaveLength(priorResolution);
  const resolved = page.waitForResponse((res) => new URL(res.url()).pathname === "/api/captures" && res.request().method() === "POST");
  await page.getByTestId("capture-save").click();
  expect((await resolved).status()).toBe(201);
  const resolutionKey = ((await resolved).request().postDataJSON() as {client_key: string}).client_key;
  expect(resolutionKey).not.toBe(conflictKey);
  expect(captures(resolutionKey)[0]?.body).toBe(unsaved);
  expect(captures(conflictKey)[0]?.body).toBe("winning synthetic body");
  note(info, "Response aborted only after D1 commit; reload/retry kept the original key/body/id. Concurrent replay, changed-payload conflict and distinct keys checked against D1.");
});

test("E2E-RC-03 offline draft and storage failure never claim server persistence @mobile", { tag: ["@RC"] }, async ({ page, context }, info) => {
  test.setTimeout(180_000);
  await openCapture(page);
  const before = snapshot();
  const providersBefore = (await fakeProviderLog()).length;
  const raw = "  離線本機草稿\nRC03 📝  ";
  const submissions: { body: string; client_key: string }[] = [];
  page.on("request", (req) => {
    if (new URL(req.url()).pathname === "/api/captures" && req.method() === "POST") submissions.push(req.postDataJSON() as { body: string; client_key: string });
  });
  await context.setOffline(true);
  await page.getByTestId("capture-body").fill(raw);
  await expect(page.getByTestId("capture-status")).toContainText(LOCAL);
  expect(snapshot()).toEqual(before);
  // This MVP has no service worker. A real offline reload may show Chromium's offline page.
  // It must never erase the persisted draft; assert its recovery on the first reconnect/reload.
  await page.reload({ waitUntil: "domcontentloaded" }).catch((error: unknown) => {
    expect(String(error)).toMatch(/ERR_INTERNET_DISCONNECTED|ERR_NETWORK_CHANGED|ERR_FAILED/);
  });
  await context.setOffline(false);
  await page.goto("/captures");
  await expect(page.getByTestId("capture-body")).toHaveValue(raw);
  await expect(page.getByTestId("capture-status")).toContainText(LOCAL);
  expect(submissions).toHaveLength(0);
  expect(snapshot()).toEqual(before);

  // Isolate capture API loss while the authenticated shell can reload normally.
  await page.route("**/api/captures**", (route) => route.abort("internetdisconnected"));
  await page.reload();
  await expect(page.getByTestId("capture-body")).toHaveValue(raw);
  await page.getByTestId("capture-save").click();
  await expect(page.getByTestId("capture-status")).toContainText(UNKNOWN);
  expect(snapshot()).toEqual(before);
  await page.reload();
  await expect(page.getByTestId("capture-body")).toHaveValue(raw);
  await expect(page.getByTestId("capture-status")).toContainText(UNKNOWN);
  expect(submissions).toHaveLength(1);
  await page.unroute("**/api/captures**");
  const saved = page.waitForResponse((res) => new URL(res.url()).pathname === "/api/captures" && res.request().method() === "POST");
  await page.getByTestId("capture-save").click();
  expect((await saved).status()).toBe(201);
  expect(submissions).toHaveLength(2);
  expect(submissions[1]).toEqual(submissions[0]);
  expect(captures(submissions[0]!.client_key)[0]?.body).toBe(raw);
  await expect(page.getByTestId("capture-body")).toHaveValue("");

  // Throw on localStorage only. Leave sessionStorage and the HTTP request path untouched.
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key: string, value: string) {
      if (this === window.localStorage) throw new DOMException("synthetic quota failure", "QuotaExceededError");
      return original.call(this, key, value);
    };
  });
  await page.getByTestId("capture-body").fill("RC03 synthetic storage failure");
  await expect(page.getByTestId("capture-status")).toContainText(NOT_STORED);
  await expect(page.getByTestId("capture-status")).not.toContainText(LOCAL);
  await page.getByTestId("capture-save").click();
  await expect(page.getByTestId("capture-status")).toContainText(NOT_STORED);
  expect(submissions).toHaveLength(2);
  expect(query("SELECT * FROM messages ORDER BY id")).toEqual(before.messages);
  expect((await fakeProviderLog()).length).toBe(providersBefore);
  await shot(page, info, "storage-failure");
  note(info, "Full offline reload/reconnect restored draft; capture-API-only interruption restored uncertain snapshot and reused its key. Storage failure was explicit. No automatic queue/send was observed.");
});

const ENDPOINTS = [
  { method: "GET", path: "/api/captures" },
  { method: "POST", path: "/api/captures", body: { body: "RC04 denied synthetic body", client_key: "rc04-denied" } },
  { method: "GET", path: "/api/notes/synthetic-article" },
  { method: "PUT", path: "/api/notes/synthetic-article", body: { body: "RC04 denied note" } },
  { method: "GET", path: "/api/reading-export" },
  { method: "POST", path: "/api/reading-export/ack", body: { capture_id: "synthetic-id", exported_commit: "a".repeat(40) } },
] as const;

test("E2E-RC-04 all private routes enforce session, operator, CSRF and bounded input", { tag: ["@RC"] }, async ({ page, browser, recorder }, info) => {
  test.setTimeout(180_000);
  await loginViaUi(page, ACCOUNTS.ada);
  const sentinel = "RC04-private-sentinel-" + randomUUID();
  expect((await request(page.request, "POST", "/api/captures", { body: sentinel, client_key: randomUUID() })).status()).toBe(201);
  const before = snapshot();
  const providersBefore = (await fakeProviderLog()).length;
  const anonymous = await browser.newContext({ baseURL: process.env.KITH_E2E_BASE_URL });
  const expired = await browser.newContext({ baseURL: process.env.KITH_E2E_BASE_URL });
  const member = await openActor({ browser, info, recorder, account: ACCOUNTS.ben, actor: "rc-member" });
  try {
    await expect(member.page.getByTestId("capture-link")).toHaveCount(0);
    await member.page.goto("/captures");
    await expect(member.page.getByTestId("capture-body")).toHaveCount(0);
    expect(await member.page.content()).not.toContain(sentinel);
    // Explicit expired server-side session, not merely an absent or expired browser cookie.
    const expiredId = "rc-expired-" + randomUUID();
    const seeded = spawnSync(WRANGLER_BIN, ["kv", "key", "put", "session:" + expiredId,
      JSON.stringify({ member_id: ACCOUNTS.ada.id, expires_at: "2000-01-01T00:00:00.000Z" }),
      "--binding", "SESSIONS", "--local", "--persist-to", stateDir()],
    { cwd: KITH_DIR, env: wranglerEnv(), encoding: "utf8", timeout: 30_000 });
    expect(seeded.status, "isolated expired session fixture").toBe(0);
    await expired.addCookies([{ name: "kith_session", value: expiredId, url: process.env.KITH_E2E_BASE_URL!, httpOnly: true, sameSite: "Lax" }]);
    for (const endpoint of ENDPOINTS) {
      const body = "body" in endpoint ? endpoint.body : undefined;
      for (const [label, client, status] of [
        ["anonymous", anonymous.request, 401], ["expired", expired.request, 401], ["member", member.page.request, 403],
      ] as const) {
        const res = await request(client, endpoint.method, endpoint.path, body);
        expect(res.status(), label + " " + endpoint.path).toBe(status);
        expect(await res.text()).not.toContain(sentinel);
        expect(res.headers()["cache-control"]).toContain("no-store");
      }
      if (endpoint.method !== "GET") {
        for (const headers of [{}, { "X-CSRF-Token": "wrong-synthetic-token" }] as Record<string, string>[]) {
          const res = await page.request.fetch(endpoint.path, { method: endpoint.method, data: body, headers });
          expect(res.status()).toBe(401);
          expect(await res.text()).not.toContain(sentinel);
        }
      }
      if (endpoint.path !== "/api/captures") {
        const res = await request(page.request, endpoint.method, endpoint.path, body);
        expect(res.status(), "reserved operator route must not pretend success").toBe(501);
        expect(await res.text()).not.toContain(sentinel);
      }
    }
    expect(snapshot()).toEqual(before);
    for (const body of [
      { body: "", client_key: randomUUID() }, { body: "📝".repeat(4097), client_key: randomUUID() },
      { body: "x\u0000y", client_key: randomUUID() }, { body: "\ud800", client_key: randomUUID() },
      { body: "ok", client_key: "" }, { body: "ok", client_key: "x".repeat(129) },
      { body: "ok", client_key: "../unsafe" }, { body: "ok", client_key: randomUUID(), source: "chat" },
    ]) {
      const res = await request(page.request, "POST", "/api/captures", body);
      expect([400, 413]).toContain(res.status());
      expect(await res.text()).not.toContain(sentinel);
    }
    for (const queryString of ["limit=0", "limit=101", "limit=1.5", "limit=-1", "limit=no", "cursor=invalid", "cursor=" + "x".repeat(2048)]) {
      const res = await request(page.request, "GET", "/api/captures?" + queryString);
      expect(res.status(), queryString.slice(0, 50)).toBe(400);
      expect(await res.text()).not.toContain(sentinel);
    }
    expect(snapshot()).toEqual(before);
    // Boundary and whitespace values are valid and preserved, not trimmed or counted as UTF-16.
    for (const body of [" \n\t ", "📝".repeat(4096)]) {
      const key = randomUUID();
      expect((await request(page.request, "POST", "/api/captures", { body, client_key: key })).status()).toBe(201);
      expect(captures(key)[0]?.body).toBe(body);
    }
    expect(query("SELECT * FROM messages ORDER BY id")).toEqual(before.messages);
    expect(query("SELECT * FROM notes ORDER BY id")).toEqual(before.notes);
    expect((await fakeProviderLog()).length).toBe(providersBefore);
    note(info, "Anonymous/expired 401, member 403, invalid CSRF 401 and operator reserved-route 501 across captures/notes/export; denied requests preserve every D1 row and reveal no sentinel. UTF-8 bounds and pagination rejected malformed input.");
  } finally {
    await anonymous.close();
    await expired.close();
    await member.context.close();
  }
});
