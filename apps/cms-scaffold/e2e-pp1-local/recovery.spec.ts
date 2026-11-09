import { test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { connect, type Socket } from "node:net";
import { readFile } from "node:fs/promises";
import { once } from "node:events";
import { canonicalBytes, parseStrictJson, sha256 } from "../scripts/ops/recovery-protocol.mjs";
let encodeSmokeFrame: (value: unknown) => Buffer;
let validateBrowserInput: (value: unknown) => unknown;
let validateSmokeFrames: (input: unknown, observations: unknown, assertions: unknown) => boolean;
type DiagnosticStep = 'BEFORE_BROWSER'|'ENV_CHECK'|'MODULE_IMPORT'|'BINDINGS'|'INPUT'|'CHANNEL'|'CONTEXTS'|'OLD_ADMIN'|'OLD_OPERATOR'|'ADMIN_LOGIN'|'OPERATOR_LOGIN'|'CONTENT'|'PUBLIC_BYTES'|'PRIVATE_ISOLATION'|'FRAMES'|'CLOSE';
const markStep=(step:DiagnosticStep)=>{process.stderr.write(`PP1C_DIAG:J_${step}\n`);};
let classifySmokePageError: ((error:unknown)=>string|null)|undefined;
function markError(error:unknown){const code=classifySmokePageError?.(error);if(code)process.stderr.write(`PP1C_DIAG:${code}\n`);}
test.beforeAll(()=>{markStep('BEFORE_BROWSER');});
const API = "https://api.cms.test:8443";
type Credential = { principalId: string; username: string; password: string; oldSessionToken: string };
type Credentials = Record<"admin" | "operator", Credential>;
type Input = { operationId: string; targetRunId: string; fixtureSha256: string; fixture: {
  adminPrincipalId: string; operatorPrincipalId: string; publishedEntryId: string; expected: Record<string, string>; media: Record<string, string> } };
type Actor = { context: BrowserContext; page: Page; origin: string; healthy: boolean; logins: number; csrf: number };
type Reply = { status: number; body: unknown; bytes: Buffer; contentType: string };
function failure() { return new Error("SMOKE_FAILED"); }
function check(value: unknown): asserts value { if (!value) throw failure(); }
function object(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
function exact(value: unknown, keys: string): asserts value is Record<string, unknown> {
  check(object(value) && Object.keys(value).sort().join(" ") === keys.split(" ").sort().join(" "));
}
function hash(value: unknown) { return sha256(canonicalBytes(value)); }
async function credentials(input: Input): Promise<{ socket: Socket; actors: Credentials; healthy: () => boolean }> {
  const socket = connect({ path: "/run/pp1/credential.sock", allowHalfOpen: true });
  let received = false, bad = false, buffer: Buffer = Buffer.alloc(0), timer: ReturnType<typeof setTimeout>;
  const value = await new Promise<unknown>((accept, reject) => {
    const fail = () => { bad = true; clearTimeout(timer); buffer.fill(0); socket.destroy(); reject(failure()); };
    timer = setTimeout(fail, 10000); socket.on("error", fail);
    socket.once("connect", () => {
      const frame = encodeSmokeFrame({ version: 1, operationId: input.operationId, targetRunId: input.targetRunId, fixtureSha256: input.fixtureSha256 });
      socket.write(frame, error => { frame.fill(0); if (error) fail(); });
    });
    socket.on("data", (chunk: Buffer) => {
      if (received || buffer.length + chunk.length > 16388) { chunk.fill(0); fail(); return; }
      const previous = buffer; buffer = Buffer.concat([previous, chunk]); previous.fill(0); chunk.fill(0);
      if (buffer.length < 4) return;
      const size = buffer.readUInt32BE(0); if (size < 1 || size > 16384) { fail(); return; }
      if (buffer.length < size + 4) return;
      try {
        check(buffer.length === size + 4); const parsed = parseStrictJson(buffer.subarray(4));
        received = true; clearTimeout(timer); accept(parsed);
      } catch { fail(); } finally { buffer.fill(0); buffer = Buffer.alloc(0); }
    });
    socket.once("end", () => { if (!received) fail(); });
    socket.once("close", () => { if (!received) fail(); });
  });
  exact(value, "version operationId targetRunId fixtureSha256 admin operator");
  check(value.version === 1 && value.operationId === input.operationId && value.targetRunId === input.targetRunId && value.fixtureSha256 === input.fixtureSha256);
  const actors = {} as Credentials;
  for (const actor of ["admin", "operator"] as const) {
    const item = value[actor]; exact(item, "principalId username password oldSessionToken");
    check(item.principalId === input.fixture[actor === "admin" ? "adminPrincipalId" : "operatorPrincipalId"]
      && typeof item.username === "string" && typeof item.password === "string" && item.password.length >= 12
      && typeof item.oldSessionToken === "string" && item.oldSessionToken.length > 0);
    actors[actor] = item as Credential;
  }
  return { socket, actors, healthy: () => !bad };
}
async function actor(browser: Browser, surface: "admin" | "back" | "front", userAgent: string, oldToken?: string): Promise<Actor> {
  const context = await browser.newContext({ ignoreHTTPSErrors: false, userAgent });
  const page = await context.newPage(), value: Actor = { context, page, origin: `https://${surface}.cms.test:8443`, healthy: true, logins: 0, csrf: 0 };
  try {
    if (oldToken) await context.addCookies([{ name: "cms_session", value: oldToken, url: API, secure: true, httpOnly: true, sameSite: "Lax" }]);
    page.on("pageerror", error => { markError(error);value.healthy = false; });
    page.on("request", request => {
      try {
        const url = new URL(request.url()), method = request.method();
        check([value.origin, API].includes(url.origin) && (url.origin !== value.origin || method === "GET" || method === "HEAD"));
        if (url.origin === API && method === "POST") { check(url.pathname === "/api/v1/auth/login"); value.logins++; }
        else check(["GET", "HEAD", "OPTIONS"].includes(method));
        if (url.origin === API && url.pathname === "/api/v1/auth/csrf" && method === "GET") value.csrf++;
      } catch { value.healthy = false; }
    });
    await page.goto(value.origin + (surface === "back" ? "/sign-in" : surface === "admin" ? "/login" : "/"));
    check(value.healthy && await page.evaluate(origin => isSecureContext && location.origin === origin, value.origin));
    return value;
  } catch(error) { markError(error);await context.close(); throw failure(); }
}
async function api(value: Actor, path: string, method = "GET", body?: unknown, csrf?: string): Promise<Reply> {
  check(value.healthy && path.startsWith("/api/v1/") && [10, 13, 92].every(code => !path.includes(String.fromCharCode(code)))
    && ["GET", "POST"].includes(method));
  if (method === "POST") check(path === "/api/v1/auth/login" && typeof csrf === "string");
  const reply = await value.page.evaluate(async ({ origin, path, method, body, csrf }) => {
    if (!isSecureContext || location.origin !== origin) throw new Error("SMOKE_FAILED");
    const headers: Record<string, string> = {};
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (csrf !== undefined) headers["X-CSRF-Token"] = csrf;
    const response = await fetch("https://api.cms.test:8443" + path, { method, credentials: "include", headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length > 16777216) throw new Error("SMOKE_FAILED");
    const contentType = response.headers.get("content-type") ?? "";
    return { status: response.status, bytes: Array.from(bytes), contentType };
  }, { origin: value.origin, path, method, body, csrf });
  check(value.healthy); const bytes = Buffer.from(reply.bytes);
  return { status: reply.status, bytes, contentType: reply.contentType, body: reply.contentType.includes("json") && bytes.length ? JSON.parse(bytes.toString("utf8")) : null };
}
function me(reply: Reply, credential: Credential, actorName: "admin" | "operator") {
  const body = reply.body; check(reply.status === 200 && object(body) && object(body.principal));
  check(body.principal.id === credential.principalId && body.principal.username === credential.username && body.principal.status === "active");
  check(Array.isArray(body.roles) && body.roles.length === 1 && object(body.roles[0]) && body.roles[0].code === actorName);
  check(object(body.surfaces) && body.surfaces[actorName === "admin" ? "admin" : "back"] === true);
  if (actorName === "operator") check(body.surfaces.admin === false && Array.isArray(body.roles[0].contentTypeCodes)
    && [...body.roles[0].contentTypeCodes].sort().join(" ") === "album photo");
}
async function login(value: Actor, credential: Credential, actorName: "admin" | "operator") {
  const csrf = await api(value, "/api/v1/auth/csrf"); check(csrf.status === 200 && object(csrf.body) && typeof csrf.body.csrfToken === "string");
  const before = await value.context.cookies(API); check(before.find(cookie => cookie.name === "cms_csrf")?.value === csrf.body.csrfToken);
  const loginStartedAt = new Date().toISOString();
  const result = await api(value, "/api/v1/auth/login", "POST", { username: credential.username, password: credential.password, surface: actorName === "admin" ? "admin" : "back" }, csrf.body.csrfToken);
  const loginFinishedAt = new Date().toISOString(); me(result, credential, actorName);
  check(object(result.body) && !result.body.forceChangePassword && !result.body.mustChangePassword && value.logins === 1 && value.csrf === 1);
  const cookies = (await value.context.cookies(API)).filter(cookie => cookie.name === "cms_session");
  check(cookies.length === 1 && cookies[0].secure && cookies[0].httpOnly);
  const sessionTokenSha256 = sha256(Buffer.from(cookies[0].value));
  me(await api(value, "/api/v1/auth/me"), credential, actorName);
  return { principalId: credential.principalId, sessionTokenSha256, loginStartedAt, loginFinishedAt };
}

test("PP1-AC03 restored media and sessions remain isolated", async ({ browser }) => {
  let wire: Awaited<ReturnType<typeof credentials>> | undefined; const contexts: Actor[] = [];
  try {
    markStep("ENV_CHECK");
    check(process.env.CMS_PP1_SUITE === "recovery" && process.env.CMS_PP1_TLS_MODE === "trusted"
      && process.env.CMS_PP1_RECOVERY_INPUT === "/fixture/browser.json" && process.env.CMS_PP1_CREDENTIAL_SOCKET === "/run/pp1/credential.sock");
    markStep("MODULE_IMPORT");
    const protocol = await import("../scripts/ops/local-restore-smoke.mjs");
    markStep("BINDINGS");
    ({ encodeSmokeFrame, validateBrowserInput, validateSmokeFrames, classifySmokePageError } = protocol);
    markStep("INPUT");
    const input = validateBrowserInput(parseStrictJson(await readFile("/fixture/browser.json"))) as Input;
    const startedAt = new Date().toISOString();markStep("CHANNEL"); wire = await credentials(input);
    const userAgent = `CMS-PP1C-RESTORE/${input.operationId}`;
    markStep("CONTEXTS");
    for (const [surface, oldToken] of [["admin", wire.actors.admin.oldSessionToken], ["back", wire.actors.operator.oldSessionToken], ["admin", undefined], ["back", undefined], ["front", undefined]] as const) contexts.push(await actor(browser, surface, userAgent, oldToken));
    const rejected: Record<string, string> = {};
    for (const [index, name] of [[0, "admin"], [1, "operator"]] as const) {
      markStep(index===0?"OLD_ADMIN":"OLD_OPERATOR");
      const result = await api(contexts[index], "/api/v1/auth/me");
      check(result.status === 401 && object(result.body) && object(result.body.error) && result.body.error.code === "SESSION_EXPIRED");
      rejected[name] = new Date().toISOString();
    }
    markStep("ADMIN_LOGIN");const admin = await login(contexts[2], wire.actors.admin, "admin");
    markStep("OPERATOR_LOGIN");const operator = await login(contexts[3], wire.actors.operator, "operator");
    check(wire.healthy() && contexts.every(value => value.healthy));
    const [newAdmin, newOperator, front] = [contexts[2], contexts[3], contexts[4]], f = input.fixture;
    const jsonHash = async (owner: Actor, path: string, expected: string) => {
      const value = await api(owner, path); check(value.status === 200 && hash(value.body) === expected);
    };
    const bytesHash = async (owner: Actor, path: string, expected: string, contentType: string) => {
      const value = await api(owner, path); check(value.status === 200 && value.bytes.length > 0
        && sha256(value.bytes) === expected && value.contentType.split(";")[0] === contentType);
    };
    markStep("CONTENT");
    await jsonHash(newAdmin, `/api/v1/entries/${f.publishedEntryId}?include=refs`, f.expected.privateEntrySha256);
    await jsonHash(newAdmin, `/api/v1/entries/${f.publishedEntryId}/revisions`, f.expected.revisionListSha256);
    markStep("PUBLIC_BYTES");
    for (const [variant, key, type] of [["original", "publicOriginalSha256", "image/png"],
      ["thumbnail", "publicThumbnailSha256", "image/jpeg"], ["web", "publicWebSha256", "image/jpeg"]]) {
      await bytesHash(front, `/api/v1/public/media/${f.media.publicImageId}/file/${variant}`, f.expected[key], type);
    }
    await bytesHash(front, `/api/v1/public/media/${f.media.publicPdfId}/file/original`, f.expected.publicPdfSha256, "application/pdf");
    markStep("PRIVATE_ISOLATION");
    for (const [idKey, expected] of [["draftImageId", "draftOriginalSha256"], ["privateImageId", "privateOriginalSha256"],
      ["replacedImageId", "replacedOriginalSha256"], ["deletedImageId", null]]) {
      const mediaId = f.media[idKey!];
      check((await api(front, `/api/v1/public/media/${mediaId}/file/original`)).status === 404);
      if (expected) await bytesHash(newAdmin, `/api/v1/media/${mediaId}/file/original`, f.expected[expected], "image/png");
      else {
        const gone = await api(newAdmin, `/api/v1/media/${mediaId}/file/original`);
        check(gone.status === 410 && object(gone.body) && object(gone.body.error) && gone.body.error.code === "MEDIA_GONE");
      }
    }
    await jsonHash(newOperator, `/api/v1/entries/${f.publishedEntryId}?include=refs`, f.expected.operatorEntrySha256);
    me(await api(newAdmin, "/api/v1/auth/me"), wire.actors.admin, "admin");
    me(await api(newOperator, "/api/v1/auth/me"), wire.actors.operator, "operator");
    await jsonHash(front, `/api/v1/public/content-types/photo/entries/${f.publishedEntryId}`, f.expected.publicEntrySha256);
    check(contexts.every(value => value.healthy) && contexts.reduce((sum, value) => sum + value.logins, 0) === 2
      && contexts.reduce((sum, value) => sum + value.csrf, 0) === 2 && wire.healthy());
    markStep("CLOSE");
    await Promise.all(contexts.map(value => value.context.close())); contexts.length = 0;
    for (const value of Object.values(wire.actors)) { value.password = ""; value.oldSessionToken = ""; value.username = ""; }
    const finishedAt = new Date().toISOString();
    const observations = { version: 1, operationId: input.operationId, targetRunId: input.targetRunId,
      admin: { ...admin, oldRejectedAt: rejected.admin }, operator: { ...operator, oldRejectedAt: rejected.operator } };
    const assertions = { version: 1, operationId: input.operationId, targetRunId: input.targetRunId, fixtureSha256: input.fixtureSha256,
      startedAt, finishedAt, checks: { oldAdminRejected: true, oldOperatorRejected: true, adminLogin: true, operatorLogin: true,
        publishedBytes: true, privateIsolation: true, restoredContent: true, originTls: true }, loginCount: "2", credentialDeliveries: "1" };
    validateSmokeFrames(input, observations, assertions);
    markStep("FRAMES");
    const ended = once(wire.socket, "end");
    for (const value of [observations, assertions]) {
      const frame = encodeSmokeFrame(value);
      try { await new Promise<void>((accept, reject) => wire!.socket.write(frame, error => error ? reject(failure()) : accept())); }
      finally { frame.fill(0); }
    }
    wire.socket.end(); await ended; check(wire.healthy());
  } catch(error) { markError(error);throw failure(); }
  finally {
    markStep("CLOSE");
    await Promise.allSettled(contexts.map(value => value.context.close()));
    if (wire) { for (const value of Object.values(wire.actors)) { value.password = ""; value.oldSessionToken = ""; value.username = ""; } wire.socket.destroy(); }
  }
});
