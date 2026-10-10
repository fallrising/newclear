import { test, before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const API_BASE = process.env.SP_API_URL ?? "http://127.0.0.1:8788";
const WEB_BASE = process.env.SP_WEB_URL ?? "http://127.0.0.1:8787";
for (const target of [API_BASE, WEB_BASE]) {
  const url = new URL(target);
  if (
    url.protocol !== "http:" ||
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
  )
    throw new Error("Integration tests require local loopback URLs");
}
const ACTOR = "owner@example.test";
const RUN = `t003-${Date.now()}-${randomUUID().slice(0, 8)}`;

async function raw(
  path,
  { method = "GET", actor = ACTOR, body, headers = {} } = {},
) {
  const init = { method, headers: { ...headers }, redirect: "manual" };
  if (actor !== null) init.headers["X-Spring-Pool-Actor"] = actor;
  if (body !== undefined) {
    init.headers["Content-Type"] = "application/json; charset=utf-8";
    init.body = typeof body === "string" ? body : JSON.stringify(body);
  }
  const res = await fetch(`${API_BASE}${path}`, init);
  const text = await res.text();
  let json = null;
  if (text.length > 0) {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }
  return { res, json, text };
}

async function api(path, opts) {
  const r = await raw(path, opts);
  assert.ok(
    r.json !== null,
    `expected JSON from ${opts?.method ?? "GET"} ${path}; got HTTP ${r.res.status}: ${r.text.slice(0, 200)}`,
  );
  return r;
}

async function createScript(overrides = {}) {
  const payload = {
    title: `${RUN}-script-${randomUUID().slice(0, 8)}`,
    description: "",
    tags: [],
    language: "bash",
    body: "echo hi\n",
    ...overrides,
  };
  const { res, json } = await api("/v1/scripts", {
    method: "POST",
    body: payload,
  });
  assert.equal(res.status, 201, `createScript failed: ${JSON.stringify(json)}`);
  return json;
}

async function createRunbook({ steps, ...overrides } = {}) {
  assert.ok(Array.isArray(steps), "createRunbook requires steps");
  const payload = {
    title: `${RUN}-runbook-${randomUUID().slice(0, 8)}`,
    description: "",
    steps,
    ...overrides,
  };
  const { res, json } = await api("/v1/runbooks", {
    method: "POST",
    body: payload,
  });
  assert.equal(
    res.status,
    201,
    `createRunbook failed: ${JSON.stringify(json)}`,
  );
  return json;
}

before(async () => {
  try {
    const res = await fetch(`${API_BASE}/v1/health`);
    const text = await res.text();
    if (res.status !== 200)
      throw new Error(
        `health returned HTTP ${res.status}: ${text.slice(0, 120)}`,
      );
  } catch (err) {
    throw new Error(
      `spring-pool API is not reachable at ${API_BASE} (override with SP_API_URL). ` +
        `Start the local workerd pair against the compiled API and real D1 before running the integration suite. ` +
        `Original error: ${err.message}`,
    );
  }
});

test("T-BOUND-3: the web worker does not proxy API paths and serves /healthz", async () => {
  let healthz;
  try {
    healthz = await fetch(`${WEB_BASE}/healthz`);
  } catch (err) {
    throw new Error(
      `spring-pool web is not reachable at ${WEB_BASE} (override with SP_WEB_URL). Start the local workerd pair. Original error: ${err.message}`,
    );
  }
  if (healthz.status === 401) {
    throw new Error(
      `web is behind Access at ${WEB_BASE} (expected local auth mode for integration). Run wrangler dev in local mode.`,
    );
  }
  if (healthz.status === 503) {
    throw new Error(
      `web at ${WEB_BASE} is up but its API binding is unreachable. Check the local workerd pair.`,
    );
  }
  assert.equal(
    healthz.status,
    200,
    `GET ${WEB_BASE}/healthz -> ${healthz.status}`,
  );
  const body = await healthz.json();
  assert.equal(body.status, "ok");
  assert.equal(body.service, "spring-pool-web");
  assert.equal(typeof body.build, "string");
  assert.ok(
    body.api && body.api.status === "ok",
    `healthz api section: ${JSON.stringify(body.api)}`,
  );

  for (const path of ["/v1/scripts", "/api/v1/scripts", "/v1/health"]) {
    const r = await fetch(`${WEB_BASE}${path}`);
    assert.equal(
      r.status,
      404,
      `GET ${WEB_BASE}${path} -> ${r.status} (expected 404, not a proxy)`,
    );
  }
});

test("T-CSRF-1: state-changing web POSTs must pass Origin and double-submit checks; failures never reach the API", async () => {
  const uniq = randomUUID().slice(0, 8);
  const webOrigin = new URL(WEB_BASE).origin;

  let healthz;
  try {
    healthz = await fetch(`${WEB_BASE}/healthz`);
  } catch (err) {
    throw new Error(
      `spring-pool web is not reachable at ${WEB_BASE} (override with SP_WEB_URL). Start the local workerd pair. Original error: ${err.message}`,
    );
  }
  if (healthz.status !== 200) {
    throw new Error(
      `web at ${WEB_BASE} not healthy for CSRF testing (expected local auth mode); /healthz -> ${healthz.status}`,
    );
  }

  await createScript(); // Own fixture; this check runs independently of API test ordering.
  const before = await api("/v1/audit?limit=1");
  assert.ok(
    before.json.items.length >= 1,
    "audit must contain this test's fixture",
  );
  const topId = before.json.items[0].id;

  const initial = await fetch(`${WEB_BASE}/scripts`);
  assert.equal(
    initial.status,
    200,
    `GET ${WEB_BASE}/scripts -> ${initial.status}`,
  );
  const setCookie = initial.headers.get("set-cookie") ?? "";
  const cookieName = setCookie.match(/^([^=;]+)=/)?.[1];
  const cookieValue = setCookie.match(/=([^;]+)/)?.[1];
  assert.ok(
    cookieName && cookieValue,
    `CSRF middleware must set a cookie; got Set-Cookie: ${setCookie}`,
  );
  const cookieHeader = `${cookieName}=${cookieValue}`;

  const form = (csrfValue) => {
    const f = new FormData();
    f.append("title", `${RUN}-csrf-${uniq}`);
    f.append("description", "");
    f.append("tags", "");
    f.append("language", "bash");
    f.append("body", "echo hi\n");
    f.append("csrf", csrfValue);
    return f;
  };

  const attempt = async ({
    origin = webOrigin,
    cookie = cookieHeader,
    withCsrf = true,
    csrfValue = cookieValue,
  } = {}) => {
    const headers = {};
    if (origin !== null) headers["Origin"] = origin;
    if (cookie !== null) headers["Cookie"] = cookie;
    const f = form(csrfValue);
    if (!withCsrf) f.delete("csrf");
    return fetch(`${WEB_BASE}/scripts`, {
      method: "POST",
      headers,
      body: f,
      redirect: "manual",
    });
  };

  const rejected = [
    await attempt({ origin: null }),
    await attempt({ origin: "https://evil.example" }),
    await attempt({ withCsrf: false }),
    await attempt({ cookie: null }),
    await attempt({ csrfValue: "not-the-cookie-value" }),
  ];
  for (const r of rejected) {
    const text = await r.text();
    assert.equal(
      r.status,
      403,
      `expected 403, got ${r.status}: ${text.slice(0, 120)}`,
    );
    assert.ok(
      text.includes("Request rejected (CSRF)."),
      `expected the CSRF page, got: ${text.slice(0, 120)}`,
    );
  }

  const ok = await attempt({});
  assert.equal(
    ok.status,
    303,
    `valid CSRF request should create a script; got ${ok.status}`,
  );
  const location = ok.headers.get("location") ?? "";
  assert.ok(location.startsWith("/scripts/"), `Location: ${location}`);

  const after = await api("/v1/audit?limit=2");
  assert.equal(
    after.json.items[0].id,
    topId + 1,
    "exactly one new audit event from the successful web create",
  );
  assert.equal(after.json.items[0].action, "script.create");
});
