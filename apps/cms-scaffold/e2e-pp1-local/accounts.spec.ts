import { test, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { connect } from "node:net";
import { isAbsolute, join, resolve } from "node:path";

const API = "https://api.cms.test:8443", PREFIX = "/api/v1";
const failure = () => new Error("PP1_ACCOUNT_JOURNEY_FAILED");
function check(value: unknown): asserts value { if (!value) throw failure(); }
const uuid = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
type Credential = { runId: string; operationId: string; username: string; password: string };
type Actor = { context: BrowserContext; page: Page; origin: string; healthy: boolean; origins: Promise<boolean>[] };
type Reply = { status: number; body: Record<string, unknown> | null };
let credential: Credential | undefined, consumed = false;
const owned = new Set<string>();
function own(id: unknown): string { check(uuid(id)); owned.add(id); return id; }

async function receiveCredential(path: string): Promise<unknown> {
  check(!consumed); consumed = true;
  return new Promise((accept, reject) => {
    const bytes = Buffer.alloc(4096); let length = 0, finished = false;
    const socket = connect(path), timer = setTimeout(() => finish(false), 10_000);
    function finish(ok: boolean) {
      if (finished) return; finished = true; clearTimeout(timer); socket.destroy();
      try { if (!ok || length === 0) throw failure(); accept(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, length)))); }
      catch { reject(failure()); } finally { bytes.fill(0); }
    }
    socket.on("data", (chunk: Buffer) => {
      if (finished) { chunk.fill(0); return; }
      if (length + chunk.length > bytes.length) { chunk.fill(0); finish(false); return; }
      chunk.copy(bytes, length); length += chunk.length; chunk.fill(0);
    });
    socket.once("end", () => finish(true)); socket.once("error", () => finish(false));
    socket.once("close", () => { if (!finished) finish(false); });
  });
}
test.beforeAll(async () => {
  try {
    check(process.env.CMS_PP1_SUITE === "accounts" && process.env.CMS_PP1_TLS_MODE === "trusted" && !process.argv.includes("--list"));
    const root = process.env.CMS_PP1_RUN_ROOT, runId = process.env.CMS_PP1_RUN_ID, operationId = process.env.CMS_PP1_OPERATION_ID;
    const socket = process.env.CMS_PP1_CREDENTIAL_SOCKET;
    check(root && isAbsolute(root) && resolve(root) === root && typeof runId === "string" && /^[a-f0-9]{32}$/.test(runId) && uuid(operationId));
    check(socket && isAbsolute(socket) && resolve(socket) === socket && !/[\r\n\0]/.test(socket));
    const receipt = JSON.parse(await readFile(join(root, "receipt.json"), "utf8"));
    check(object(receipt) && receipt.version === 1 && receipt.phase === "PREPARED" && receipt.environment === "local-isolated");
    check(receipt.runId === runId && receipt.project === `cms-pp1-local-${runId}` && receipt.apiOrigin === API);
    const value = await receiveCredential(socket);
    check(object(value) && JSON.stringify(Object.keys(value).sort()) === JSON.stringify(["operationId", "password", "runId", "username"]));
    check(value.runId === runId && value.operationId === operationId && typeof value.username === "string" && /^[a-z0-9._-]{3,32}$/.test(value.username));
    check(typeof value.password === "string" && value.password.length >= 12 && value.password.toLowerCase() !== value.username.toLowerCase());
    credential = value as Credential;
  } catch { throw new Error("PP1_ACCOUNT_CREDENTIAL_INPUT_INVALID"); }
});
test.afterAll(() => { if (credential) { credential.password = ""; credential.username = ""; } credential = undefined; owned.clear(); });

async function actors(browser: Browser) {
  const created: Actor[] = [];
  try {
    for (const surface of ["admin", "back", "admin", "front"]) {
      const context = await browser.newContext({ ignoreHTTPSErrors: false }), page = await context.newPage();
      const actor: Actor = { context, page, origin: `https://${surface}.cms.test:8443`, healthy: true, origins: [] }; created.push(actor);
      page.on("pageerror", () => { actor.healthy = false; });
      page.on("request", request => {
        if (request.url().includes("localhost:8080")) actor.healthy = false;
        if (request.url().includes("/api/v1/")) {
          if (!request.url().startsWith(`${API}${PREFIX}/`)) actor.healthy = false;
          actor.origins.push(request.allHeaders().then(headers => headers.origin === actor.origin, () => false));
        }
      });
      await page.goto(`${actor.origin}${surface === "back" ? "/sign-in" : "/login"}`);
      check(await page.evaluate(origin => window.isSecureContext && location.origin === origin, actor.origin));
    }
    return { admin: created[0], operator: created[1], guard: created[2], anonymous: created[3],
      close: async () => { await Promise.all(created.map(actor => actor.context.close())); },
      healthy: async () => { for (const actor of created) check(actor.healthy && (await Promise.all(actor.origins)).every(Boolean)); } };
  } catch { await Promise.allSettled(created.map(actor => actor.context.close())); throw failure(); }
}
async function api(actor: Actor, path: string, method = "GET", body?: unknown): Promise<Reply> {
  try {
    check(["GET", "POST", "PUT", "PATCH"].includes(method) && path.startsWith("/") && !/[?#\\]/.test(path));
    const ids = path.match(/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}/g) ?? [];
    check(ids.every(id => owned.has(id)));
    const target = /\/(?:principals|entries)\/([^/]+)/.exec(path)?.[1]; if (target) check(uuid(target) && owned.has(target));
    if (method !== "GET" && path.startsWith("/roles/")) check(/^\/roles\/(?:operator|anonymous)\/permissions$/.test(path));
    const permitted = /^\/(?:auth\/(?:me|login)|roles(?:\/(?:operator|anonymous|admin|member|editor)\/permissions)?|principals(?:\/[a-f0-9-]+(?:\/(?:roles|disable|effective-permissions|password))?)?|admin\/content-types|admin\/entries\/[a-f0-9-]+\/purge|content-types\/(?:page|project|issue)\/entries|entries\/[a-f0-9-]+(?:\/publish)?|public\/content-types\/page\/entries\/[a-f0-9-]+)$/;
    check(permitted.test(path));
    return await actor.page.evaluate(async ({ origin, url, method, body }) => {
      if (!window.isSecureContext || location.origin !== origin) throw new Error("PP1_ACCOUNT_JOURNEY_FAILED");
      const headers: Record<string, string> = {};
      if (method !== "GET") {
        const response = await fetch("https://api.cms.test:8443/api/v1/auth/csrf", { credentials: "include" });
        const csrf = await response.json();
        if (response.status !== 200 || typeof csrf.csrfToken !== "string") throw new Error("PP1_ACCOUNT_JOURNEY_FAILED");
        headers["X-CSRF-Token"] = csrf.csrfToken;
      }
      if (body !== undefined) headers["Content-Type"] = "application/json";
      const response = await fetch(url, { method, credentials: "include", headers, body: body === undefined ? undefined : JSON.stringify(body) });
      const text = await response.text(); return { status: response.status, body: text ? JSON.parse(text) : null };
    }, { origin: actor.origin, url: `${API}${PREFIX}${path}`, method, body });
  } catch { throw failure(); }
}
function status(reply: Reply, expected: number, code?: string) {
  check(reply.status === expected); if (code) check(object(reply.body?.error) && reply.body.error.code === code);
}
async function mutation(actor: Actor, method: string, path: string, trigger: () => Promise<unknown>, expected: number, code?: string) {
  try {
    const [response] = await Promise.all([actor.page.waitForResponse(res => res.url() === `${API}${PREFIX}${path}` && res.request().method() === method), trigger()]);
    check(response.status() === expected);
    if (code) { const body: unknown = await response.json(); check(object(body) && object(body.error) && body.error.code === code); }
  } catch { throw failure(); }
}
async function login(actor: Actor, username: string, password: string) {
  try {
    await actor.page.locator("#login-password").waitFor({ state: "visible" });
    // Secret is an evaluate argument, never a locator.fill value or an assertion diagnostic.
    check(await actor.page.evaluate(({ username, password }) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      if (!setter) return false;
      for (const [id, value] of [["login-username", username], ["login-password", password]]) {
        const input = document.getElementById(id); if (!(input instanceof HTMLInputElement)) return false;
        setter.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true }));
      }
      return true;
    }, { username, password }));
    await mutation(actor, "POST", "/auth/login", () => actor.page.getByTestId("login-submit").click(), 200);
    await actor.page.waitForURL(url => url.origin === actor.origin && !["/login", "/sign-in"].includes(url.pathname));
    const me = await api(actor, "/auth/me"); status(me, 200); check(object(me.body?.principal)); return own(me.body.principal.id);
  } catch { throw failure(); }
}
async function oncePassword(actor: Actor): Promise<string> {
  try {
    const dialog = actor.page.getByTestId("password-dialog"); await dialog.getByTestId("temp-password").waitFor({ state: "visible" });
    const password = await dialog.getByTestId("temp-password").textContent(); check(typeof password === "string" && password.length >= 12);
    await dialog.getByTestId("password-done").click(); return password;
  } catch { throw failure(); }
}
async function createPrincipal(actor: Actor, username: string, role: "operator" | "admin") {
  try {
    await actor.page.goto(`${actor.origin}/principals/new`);
    await actor.page.getByTestId("new-username").fill(username); await actor.page.getByTestId("new-name").fill(role === "admin" ? "PP1 guard" : "PP1 operator");
    await actor.page.getByTestId(`role-${role}`).check(); if (role === "operator") await actor.page.getByTestId("role-operator-type-page").check();
    await mutation(actor, "POST", "/principals", () => actor.page.getByTestId("new-submit").click(), 201);
    const password = await oncePassword(actor); await actor.page.waitForURL(url => /^\/principals\/[a-f0-9-]{36}$/.test(url.pathname));
    return { id: own(new URL(actor.page.url()).pathname.split("/").at(-1)), username, password };
  } catch { throw failure(); }
}
async function purgeDialog(actor: Actor, id: string) {
  check(owned.has(id)); await actor.page.goto(`${actor.origin}/entries/${id}`);
  await actor.page.getByTestId("page-more-actions").click(); await actor.page.getByTestId("entry-purge").click(); return actor.page.getByRole("alertdialog");
}
async function confirmPurge(actor: Actor, target: string) {
  const dialog = actor.page.getByRole("alertdialog");
  await dialog.getByTestId("confirm-input").fill(target); await dialog.getByTestId("confirm-word").fill("DELETE");
  await dialog.getByTestId("confirm-acknowledgement").check();
}
async function step(name: "PP1-FM05/06 minimum Q25 journey" | "PP1-FM15 password reset invalidates old sessions", run: () => Promise<void>) {
  await test.step(name, async () => { try { await run(); } catch {
    throw failure();
  } });
}

const typeActions = ["read_published", "read_draft", "create", "update", "publish", "unpublish", "delete", "archive"];
const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical) : object(value)
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const same = (a: unknown, b: unknown) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
function items(reply: Reply): Record<string, unknown>[] {
  status(reply, 200); const rows = reply.body?.items; check(Array.isArray(rows) && rows.every(object)); return rows;
}
function grantRows(rows: Record<string, unknown>[]) {
  return rows.map(row => ({ action: row.action, contentTypeCode: row.contentTypeCode, predicateJson: row.predicateJson, allowedSurfaces: row.allowedSurfaces }))
    .sort((a, b) => String(a.action).localeCompare(String(b.action)));
}
async function readEntry(actor: Actor, id: string) {
  const reply = await api(actor, `/entries/${id}`); status(reply, 200); check(reply.body?.id === id && object(reply.body.payload)); return reply.body;
}
async function createPage(actor: Actor, slug: string, title: string) {
  await actor.page.goto(`${actor.origin}/entries/page/new`);
  await actor.page.locator("#field-title").fill(title); await actor.page.locator("#field-body").fill("fixture"); await actor.page.locator("#field-slug").fill(slug);
  await mutation(actor, "POST", "/content-types/page/entries", () => actor.page.getByTestId("save-bar-save").click(), 201);
  await actor.page.waitForURL(url => /^\/entries\/page\/[a-f0-9-]{36}$/.test(url.pathname));
  const id = own(new URL(actor.page.url()).pathname.split("/").at(-1)), entry = await readEntry(actor, id);
  check(entry.contentType === "page" && entry.slug === slug && entry.publicationState === "draft" && same(entry.payload, { title, body: "fixture" })); return id;
}
async function emptyConfirmation(actor: Actor) {
  const dialog = actor.page.getByRole("alertdialog"); await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId("confirm-input")).toHaveValue(""); await expect(dialog.getByTestId("confirm-word")).toHaveValue("");
  await expect(dialog.getByTestId("confirm-acknowledgement")).not.toBeChecked(); await expect(dialog.getByTestId("confirm-submit")).toBeDisabled();
}
async function session(actor: Actor, id: string) {
  const reply = await api(actor, "/auth/me"); status(reply, 200); check(object(reply.body?.principal) && reply.body.principal.id === id); return reply.body;
}

test("PP1-AC02 formal accounts and explicit grants", async ({ browser }) => {
  test.setTimeout(120_000);
  let group: Awaited<ReturnType<typeof actors>> | undefined;
  let operator: Awaited<ReturnType<typeof createPrincipal>> | undefined, guard: Awaited<ReturnType<typeof createPrincipal>> | undefined, resetPassword = "";
  try {
    check(credential); const suffix = credential.runId.slice(-8); check(/^[a-f0-9]{8}$/.test(suffix));
    // Root has already passed the real initialized-account verifier for this exact run/operation before serving the socket.
    group = await actors(browser); const { admin, operator: back, guard: guardActor, anonymous } = group;
    const adminId = await login(admin, credential.username, credential.password); credential.password = ""; credential.username = ""; credential = undefined;
    const rolesBefore = items(await api(admin, "/roles")), catalogBefore = items(await api(admin, "/admin/content-types"));
    const unchangedGrants: Record<string, Record<string, unknown>[]> = {};
    for (const role of ["anonymous", "member", "editor", "operator", "admin"]) {
      const permissions = items(await api(admin, `/roles/${role}/permissions`));
      if (role !== "admin") check(permissions.length === 0);
      if (["admin", "member", "editor"].includes(role)) unchangedGrants[role] = permissions;
    }
    await admin.page.goto(`${admin.origin}/roles/operator`);
    for (const action of typeActions) await admin.page.getByTestId(`cell-${action}-page`).check();
    await admin.page.getByTestId("cell-manage_media-*").check(); await admin.page.getByTestId("save-bar-save").click();
    await mutation(admin, "PUT", "/roles/operator/permissions", () => admin.page.getByTestId("confirm-submit").click(), 204);
    const expectedGrants = typeActions.map(action => ({ action, contentTypeCode: "page" as string | null, predicateJson: null,
      allowedSurfaces: action === "read_published" ? ["front", "back", "admin"] : ["back", "admin"] }));
    expectedGrants.push({ action: "manage_media", contentTypeCode: null, predicateJson: null, allowedSurfaces: ["back", "admin"] });
    check(same(grantRows(items(await api(admin, "/roles/operator/permissions"))), grantRows(expectedGrants)));
    operator = await createPrincipal(admin, `pp1.operator-${suffix}`, "operator"); check(operator.id !== adminId);
    check(await login(back, operator.username, operator.password) === operator.id);
    const operatorMe = await session(back, operator.id);
    check(same(operatorMe.roles, [{ code: "operator", contentTypeCodes: ["page"] }]) && object(operatorMe.surfaces) && operatorMe.surfaces.back === true && operatorMe.surfaces.admin === false);
    const effective = items(await api(admin, `/principals/${operator.id}/effective-permissions`));
    check(effective.length === 9 && effective.every(row => row.role === "operator" && same(row.allowlist, ["page"])));
    status(await api(back, "/principals"), 403); status(await api(back, "/admin/content-types"), 403);
    const slug = `pp1-page-${suffix}`, title = `PP1 page ${suffix}`, updatedTitle = `${title} updated`;
    const pageId = await createPage(back, slug, title), initialPage = await readEntry(back, pageId);
    await back.page.locator("#field-title").fill(updatedTitle);
    await mutation(back, "PATCH", `/entries/${pageId}`, () => back.page.getByTestId("save-bar-save").click(), 200);
    const updatedPage = await readEntry(back, pageId);
    check(updatedPage.version === Number(initialPage.version) + 1 && same(updatedPage.payload, { title: updatedTitle, body: "fixture" }) && updatedPage.slug === slug);
    await mutation(back, "POST", `/entries/${pageId}/publish`, () => back.page.getByTestId("details-publish").click(), 200);
    const published = await readEntry(back, pageId); check(published.publicationState === "published" && published.dirty === false);
    const draftId = await createPage(back, `pp1-draft-${suffix}`, `PP1 draft ${suffix}`);
    const publicPath = `/public/content-types/page/entries/${pageId}`;
    status(await api(anonymous, publicPath), 403);
    check(items(await api(admin, "/roles/anonymous/permissions")).length === 0);
    const publicGrant = [{ action: "read_published", contentTypeCode: "page", predicateJson: null, allowedSurfaces: ["front"] }];
    status(await api(admin, "/roles/anonymous/permissions", "PUT", publicGrant), 204);
    check(same(grantRows(items(await api(admin, "/roles/anonymous/permissions"))), publicGrant));
    const publicPage = await api(anonymous, publicPath); status(publicPage, 200);
    check(publicPage.body?.id === pageId && publicPage.body?.slug === slug && same(publicPage.body?.payload, { title: updatedTitle, body: "fixture" }));
    status(await api(anonymous, `/public/content-types/page/entries/${draftId}`), 404);
    guard = await createPrincipal(admin, `pp1.guard-${suffix}`, "admin"); check(guard.id !== adminId && guard.id !== operator.id);
    check(await login(guardActor, guard.username, guard.password) === guard.id); guard.password = "";
    const guardId = guard.id;
    await step("PP1-FM05/06 minimum Q25 journey", async () => {
      const beforeMe = await session(guardActor, guardId), beforePrincipal = await api(guardActor, `/principals/${guardId}`);
      status(beforePrincipal, 200); check(same(beforeMe.roles, [{ code: "admin", contentTypeCodes: [] }]));
      await guardActor.page.goto(`${guardActor.origin}/principals/${guardId}`);
      await expect(guardActor.page.getByTestId("principal-self")).toBeVisible(); await expect(guardActor.page.getByTestId("principal-disable")).toHaveCount(0);
      await expect(guardActor.page.getByTestId("role-admin")).toBeChecked(); await expect(guardActor.page.getByTestId("role-admin")).toBeDisabled();
      status(await api(guardActor, `/principals/${guardId}/disable`, "POST"), 403, "SELF_DISABLE_FORBIDDEN");
      status(await api(guardActor, `/principals/${guardId}`, "PATCH", { status: "disabled" }), 403, "SELF_DISABLE_FORBIDDEN");
      status(await api(guardActor, `/principals/${guardId}/roles`, "PUT", []), 403, "SELF_DEMOTION_FORBIDDEN");
      check(same((await api(guardActor, `/principals/${guardId}`)).body, beforePrincipal.body));
      check(same(await session(guardActor, guardId), beforeMe)); await session(admin, adminId);
      const purgeId = await createPage(back, `pp1-purge-${suffix}`, `PP1 purge ${suffix}`), purgeSlug = `pp1-purge-${suffix}`;
      await mutation(back, "POST", `/entries/${purgeId}/publish`, () => back.page.getByTestId("details-publish").click(), 200);
      const publicPurge = await api(anonymous, `/public/content-types/page/entries/${purgeId}`); status(publicPurge, 200); check(publicPurge.body?.id === purgeId);
      const purgePath = `/admin/entries/${purgeId}/purge`, purgeUrl = `${API}${PREFIX}${purgePath}`;
      const beforePurge = await readEntry(admin, purgeId); let preventedPosts = 0;
      const countPrevented = (request: import("@playwright/test").Request) => { if (request.url() === purgeUrl && request.method() === "POST") preventedPosts++; };
      admin.page.on("request", countPrevented);
      const dialog = await purgeDialog(admin, purgeId); await emptyConfirmation(admin);
      for (const [target, word, ack] of [["", "DELETE", true], [purgeSlug, "", true], [purgeSlug, "delete", true], [purgeSlug + " ", "DELETE", true], [purgeSlug, "DELETE", false]] as const) {
        await dialog.getByTestId("confirm-input").fill(target); await dialog.getByTestId("confirm-word").fill(word);
        await dialog.getByTestId("confirm-acknowledgement").setChecked(ack); await expect(dialog.getByTestId("confirm-submit")).toBeDisabled(); check(preventedPosts === 0);
      }
      await dialog.getByTestId("confirm-cancel").click(); check(preventedPosts === 0); admin.page.off("request", countPrevented);
      for (const body of [undefined, {}, { confirmPhrase: "DELETE", confirmId: purgeSlug + " " }, { confirmPhrase: "delete", confirmId: purgeId }]) {
        status(await api(admin, purgePath, "POST", body), 400, "CONFIRMATION_REQUIRED");
      }
      check(same(await readEntry(admin, purgeId), beforePurge));
      const projectReply = await api(admin, "/content-types/project/entries", "POST", { slug: null, payload: { title: `PP1 reference ${suffix}`, visibility: "private", lifecycle: "active" } });
      status(projectReply, 201); const projectId = own(projectReply.body?.id);
      const issueReply = await api(admin, "/content-types/issue/entries", "POST", { slug: null, payload: { title: `PP1 issue ${suffix}`, project: projectId, status: "backlog" } });
      status(issueReply, 201); const issueId = own(issueReply.body?.id);
      const projectBefore = await readEntry(admin, projectId), issueBefore = await readEntry(admin, issueId);
      check(projectBefore.slug === null && projectBefore.publicationState === "draft" && issueBefore.publicationState === "draft");
      await purgeDialog(admin, projectId); await confirmPurge(admin, projectId);
      await mutation(admin, "POST", `/admin/entries/${projectId}/purge`, () => admin.page.getByTestId("confirm-submit").click(), 409, "REF_CONSTRAINT");
      await expect(admin.page.getByText("還有其他條目連到它，請先在 Back 移除這些連結。", { exact: true })).toBeVisible();
      check(same(await readEntry(admin, projectId), projectBefore) && same(await readEntry(admin, issueId), issueBefore));
      await purgeDialog(admin, purgeId); await confirmPurge(admin, purgeSlug);
      let posts = 0, csrf = 0, release!: () => void; const held = new Promise<void>(resolve => { release = resolve; });
      const count = (request: import("@playwright/test").Request) => {
        if (request.url() === purgeUrl && request.method() === "POST") posts++;
        if (request.url() === `${API}${PREFIX}/auth/csrf` && request.method() === "GET") csrf++;
      };
      const intercepted = async (route: import("@playwright/test").Route) => {
        check(route.request().method() === "POST"); await held;
        await route.fulfill({ status: 403, contentType: "application/json", headers: { "Access-Control-Allow-Origin": admin.origin, "Access-Control-Allow-Credentials": "true" }, body: JSON.stringify({ error: { code: "CSRF_FAILED", message: "CSRF validation failed" } }) });
      };
      admin.page.on("request", count); await admin.page.route(purgeUrl, intercepted, { times: 1 });
      let submitted: Promise<void> | undefined;
      try {
        submitted = mutation(admin, "POST", purgePath, () => admin.page.getByTestId("confirm-submit").click(), 403, "CSRF_FAILED");
        await expect.poll(() => posts).toBe(1);
        for (const id of ["confirm-input", "confirm-word", "confirm-acknowledgement", "confirm-submit", "confirm-cancel"]) await expect(admin.page.getByTestId(id)).toBeDisabled();
        release(); await submitted; await expect(admin.page.getByRole("alertdialog")).toHaveCount(0);
        await expect(admin.page.getByText("你沒有執行這個操作的權限。", { exact: true })).toBeVisible(); check(posts === 1 && csrf === 1);
        await admin.page.unroute(purgeUrl, intercepted);
        await admin.page.getByTestId("page-more-actions").click(); await admin.page.getByTestId("entry-purge").click(); await emptyConfirmation(admin);
        check(posts === 1 && csrf === 1); await confirmPurge(admin, purgeSlug);
        await mutation(admin, "POST", purgePath, () => admin.page.getByTestId("confirm-submit").click(), 204);
        await admin.page.waitForURL(url => url.pathname === "/entries" && url.searchParams.get("type") === "page");
        check(Number(posts) === 2 && Number(csrf) === 2); status(await api(admin, `/entries/${purgeId}`), 404);
        status(await api(anonymous, `/public/content-types/page/entries/${purgeId}`), 404);
      } finally { release(); await submitted?.catch(() => {}); await admin.page.unroute(purgeUrl, intercepted); admin.page.off("request", count); }
    });
    await step("PP1-FM15 password reset invalidates old sessions", async () => {
      check(operator && guard); await session(back, operator.id); await session(guardActor, guardId); await session(admin, adminId);
      await admin.page.goto(`${admin.origin}/principals/${operator.id}`); await admin.page.getByTestId("principal-reset").click();
      await mutation(admin, "POST", `/principals/${operator.id}/password`, () => admin.page.getByTestId("confirm-submit").click(), 200);
      resetPassword = await oncePassword(admin); check(resetPassword !== operator.password);
      status(await api(back, "/auth/me"), 401);
      status(await api(back, "/auth/login", "POST", { username: operator.username, password: operator.password }), 401);
      operator.password = "";
      const renewed = await api(back, "/auth/login", "POST", { username: operator.username, password: resetPassword }); status(renewed, 200);
      check(object(renewed.body?.principal) && renewed.body.principal.id === operator.id); resetPassword = "";
      await session(back, operator.id); await session(admin, adminId); await session(guardActor, guardId);
    });
    check(same(items(await api(admin, "/roles")), rolesBefore) && same(items(await api(admin, "/admin/content-types")), catalogBefore));
    for (const [role, permissions] of Object.entries(unchangedGrants)) check(same(items(await api(admin, `/roles/${role}/permissions`)), permissions));
    check(same(grantRows(items(await api(admin, "/roles/operator/permissions"))), grantRows(expectedGrants)));
    check(same(grantRows(items(await api(admin, "/roles/anonymous/permissions"))), publicGrant)); await group.healthy();
  } catch { throw failure(); }
  finally {
    if (credential) { credential.password = ""; credential.username = ""; } credential = undefined;
    if (operator) operator.password = ""; if (guard) guard.password = ""; resetPassword = "";
    try { await group?.close(); } catch { throw failure(); }
  }
});
