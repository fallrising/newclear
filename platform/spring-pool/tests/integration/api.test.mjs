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

test("T-REV-1: successive saves append immutable revisions; audit has no bodies/titles", async () => {
  const uniq = randomUUID().slice(0, 8);
  const title = `${RUN}-${uniq}-rev`;
  const bodyV1 = `#!/usr/bin/env python\nprint("v1")\n`;
  const created = await createScript({
    title,
    description: "first revision",
    tags: ["ops", "db"],
    language: "python",
    body: bodyV1,
  });
  assert.equal(created.revision, 1);
  assert.equal(created.byte_size, Buffer.byteLength(bodyV1, "utf8"));
  assert.equal(created.archived_at, null);

  const bodyV2 = `#!/usr/bin/env python\nprint("v2")\n`;
  const upd1 = await api(`/v1/scripts/${created.id}`, {
    method: "PUT",
    body: {
      expected_revision: 1,
      title,
      description: "second revision",
      tags: ["ops"],
      language: "python",
      body: bodyV2,
    },
  });
  assert.equal(upd1.res.status, 200);
  assert.equal(upd1.json.revision, 2);

  const bodyV3 = `#!/usr/bin/env python\nprint("v3")\n`;
  const upd2 = await api(`/v1/scripts/${created.id}`, {
    method: "PUT",
    body: {
      expected_revision: 2,
      title,
      description: "third revision",
      tags: [],
      language: "bash",
      body: bodyV3,
    },
  });
  assert.equal(upd2.res.status, 200);
  assert.equal(upd2.json.revision, 3);

  const rev1 = await api(`/v1/scripts/${created.id}/revisions/1`);
  assert.equal(rev1.res.status, 200);
  assert.equal(rev1.json.body, bodyV1);
  assert.equal(rev1.json.byte_size, Buffer.byteLength(bodyV1, "utf8"));
  assert.equal(rev1.json.is_current, false);
  assert.equal(rev1.json.created_by, ACTOR);

  const head = await api(`/v1/scripts/${created.id}`);
  assert.equal(head.json.revision, 3);
  assert.equal(head.json.body, bodyV3);

  const revList = await api(`/v1/scripts/${created.id}/revisions`);
  assert.deepEqual(
    revList.json.items.map((i) => i.revision),
    [3, 2, 1],
  );

  const audit = await api("/v1/audit?limit=100");
  const events = audit.json.items
    .filter((e) => e.entity_type === "script" && e.entity_id === created.id)
    .sort((a, b) => a.revision - b.revision);
  assert.deepEqual(
    events.map((e) => [e.action, e.revision]),
    [
      ["script.create", 1],
      ["script.update", 2],
      ["script.update", 3],
    ],
  );
  for (const e of events) assert.equal(e.actor, ACTOR);
  for (const e of audit.json.items) {
    for (const forbidden of ["body", "title", "instruction", "description"]) {
      assert.ok(!(forbidden in e), `audit event ${e.id} leaks '${forbidden}'`);
    }
  }
});

test("runbook updates append revisions; historical revisions keep their step list", async () => {
  const uniq = randomUUID().slice(0, 8);
  const s1 = await createScript({ title: `${RUN}-${uniq}-rb-s1` });
  const s2 = await createScript({ title: `${RUN}-${uniq}-rb-s2` });
  const rb = await createRunbook({
    title: `${RUN}-${uniq}-rb`,
    steps: [{ script_id: s1.id, script_revision: 1, instruction: "first" }],
  });
  assert.equal(rb.revision, 1);
  assert.equal(rb.steps.length, 1);
  assert.equal(rb.steps[0].script_title, s1.title);

  const upd = await api(`/v1/runbooks/${rb.id}`, {
    method: "PUT",
    body: {
      expected_revision: 1,
      title: `${RUN}-${uniq}-rb`,
      description: "updated",
      steps: [
        { script_id: s2.id, script_revision: 1, instruction: "second" },
        { script_id: s1.id, script_revision: 1, instruction: "first again" },
      ],
    },
  });
  assert.equal(upd.res.status, 200);
  assert.equal(upd.json.revision, 2);
  assert.equal(upd.json.steps.length, 2);
  assert.equal(upd.json.steps[0].script_id, s2.id);
  assert.equal(upd.json.steps[0].position, 1);
  assert.equal(upd.json.steps[1].position, 2);

  const rev1 = await api(`/v1/runbooks/${rb.id}/revisions/1`);
  assert.equal(rev1.res.status, 200);
  assert.equal(rev1.json.steps.length, 1);
  assert.equal(rev1.json.steps[0].script_id, s1.id);
  assert.equal(rev1.json.is_current, false);

  const rev2 = await api(`/v1/runbooks/${rb.id}/revisions/2`);
  assert.equal(rev2.json.is_current, true);
  assert.equal(rev2.json.steps.length, 2);

  const list = await api(`/v1/runbooks/${rb.id}/revisions`);
  assert.deepEqual(
    list.json.items.map((i) => i.revision),
    [2, 1],
  );
});

test("T-CONC-1: concurrent PUTs with the same expected_revision yield exactly one winner and one 409", async () => {
  const uniq = randomUUID().slice(0, 8);
  const title = `${RUN}-${uniq}-conc`;
  const created = await createScript({ title });
  const make = (body) => ({
    expected_revision: 1,
    title,
    description: "",
    tags: [],
    language: "bash",
    body,
  });

  const results = await Promise.all([
    api(`/v1/scripts/${created.id}`, { method: "PUT", body: make("echo a\n") }),
    api(`/v1/scripts/${created.id}`, { method: "PUT", body: make("echo b\n") }),
  ]);

  const winners = results.filter((r) => r.res.status === 200);
  const conflicts = results.filter((r) => r.res.status === 409);
  assert.equal(results.length, 2);
  assert.equal(
    winners.length,
    1,
    `expected exactly one winner, got ${results.map((r) => r.res.status).join(",")}`,
  );
  assert.equal(conflicts.length, 1);
  assert.equal(winners[0].json.revision, 2);
  assert.equal(conflicts[0].json.error.code, "revision_conflict");
  assert.equal(conflicts[0].json.error.current_revision, 2);

  const audit = await api("/v1/audit?limit=100");
  const updates = audit.json.items.filter(
    (e) =>
      e.entity_type === "script" &&
      e.entity_id === created.id &&
      e.action === "script.update",
  );
  assert.equal(
    updates.length,
    1,
    "exactly one script.update audit row for the concurrent pair",
  );
});

test("T-CONC-2: stale expected_revision on PUT and on archive return 409 revision_conflict", async () => {
  const uniq = randomUUID().slice(0, 8);
  const title = `${RUN}-${uniq}-stale`;
  const created = await createScript({ title });

  await api(`/v1/scripts/${created.id}`, {
    method: "PUT",
    body: {
      expected_revision: 1,
      title,
      description: "",
      tags: [],
      language: "bash",
      body: "echo 2\n",
    },
  });

  const stale = await api(`/v1/scripts/${created.id}`, {
    method: "PUT",
    body: {
      expected_revision: 1,
      title,
      description: "",
      tags: [],
      language: "bash",
      body: "echo 3\n",
    },
  });
  assert.equal(stale.res.status, 409);
  assert.equal(stale.json.error.code, "revision_conflict");
  assert.equal(stale.json.error.current_revision, 2);

  const staleArchive = await api(`/v1/scripts/${created.id}/archive`, {
    method: "POST",
    body: { expected_revision: 1 },
  });
  assert.equal(staleArchive.res.status, 409);
  assert.equal(staleArchive.json.error.code, "revision_conflict");
  assert.equal(staleArchive.json.error.current_revision, 2);
});

test("T-NF-1: bad ids, unknown paths and missing entities return 404 not_found", async () => {
  const uniq = randomUUID().slice(0, 8);
  const script = await createScript({ title: `${RUN}-${uniq}-nf` });
  const MISSING = "9007199254740991";
  const validScriptUpdate = {
    expected_revision: 1,
    title: `${RUN}-${uniq}-nf-missing`,
    description: "",
    tags: [],
    language: "bash",
    body: "x\n",
  };
  const validRunbookUpdate = {
    expected_revision: 1,
    title: `${RUN}-${uniq}-nf-missing`,
    description: "",
    steps: [{ script_id: script.id, script_revision: 1, instruction: "x" }],
  };
  const cases = [
    ["GET", `/v1/scripts/${MISSING}`],
    ["PUT", `/v1/scripts/${MISSING}`, validScriptUpdate],
    ["GET", "/v1/scripts/abc"],
    ["GET", "/v1/scripts/0"],
    ["GET", `/v1/runbooks/${MISSING}`],
    ["PUT", `/v1/runbooks/${MISSING}`, validRunbookUpdate],
    ["GET", "/v1/runbooks/0"],
    ["GET", "/v1/does-not-exist"],
    ["GET", "/v1/execute"],
  ];
  for (const [method, path, body] of cases) {
    const r = await api(path, { method, body });
    assert.equal(
      r.res.status,
      404,
      `${method} ${path} -> ${r.res.status}: ${r.text.slice(0, 120)}`,
    );
    assert.equal(r.json.error.code, "not_found");
  }
});

test("T-NF-2: missing revision 404s; invalid pins make the whole runbook batch roll back", async () => {
  const uniq = randomUUID().slice(0, 8);
  const script = await createScript({ title: `${RUN}-${uniq}-pin` });

  const missingRev = await api(`/v1/scripts/${script.id}/revisions/999999999`);
  assert.equal(missingRev.res.status, 404);
  assert.equal(missingRev.json.error.code, "revision_not_found");

  const badTitle = `${RUN}-${uniq}-pin-bad`;
  const bad = await api("/v1/runbooks", {
    method: "POST",
    body: {
      title: badTitle,
      steps: [
        { script_id: script.id, script_revision: 1, instruction: "ok" },
        {
          script_id: script.id,
          script_revision: 999999999,
          instruction: "bogus",
        },
      ],
    },
  });
  assert.equal(bad.res.status, 422, bad.text.slice(0, 200));
  assert.equal(bad.json.error.code, "validation_failed");
  const detail = bad.json.error.details.find(
    (d) => d.field === "steps[1].script_revision",
  );
  assert.ok(
    detail,
    `expected steps[1].script_revision detail, got ${JSON.stringify(bad.json.error.details)}`,
  );
  assert.equal(detail.issue, "not_found");

  const list = await api(`/v1/runbooks?q=${encodeURIComponent(badTitle)}`);
  assert.ok(
    !list.json.items.some((i) => i.title === badTitle),
    "failed runbook create must roll back atomically (no partial row)",
  );

  const bogusScript = await api("/v1/runbooks", {
    method: "POST",
    body: {
      title: `${RUN}-${uniq}-pin-bogus`,
      steps: [
        { script_id: 9007199254740991, script_revision: 1, instruction: "x" },
      ],
    },
  });
  assert.equal(bogusScript.res.status, 422);
  assert.ok(
    bogusScript.json.error.details.some((d) => d.issue === "not_found"),
    JSON.stringify(bogusScript.json.error.details),
  );
});

test("T-RETAIN-1: wrong methods give 405 with Allow; execute/cleanup/delete routes are 404; history intact", async () => {
  const uniq = randomUUID().slice(0, 8);
  const script = await createScript({ title: `${RUN}-${uniq}-retain` });
  const runbook = await createRunbook({
    title: `${RUN}-${uniq}-retain-rb`,
    steps: [
      { script_id: script.id, script_revision: 1, instruction: "run it" },
    ],
  });

  const wrongMethods = [
    ["DELETE", `/v1/scripts/${script.id}`],
    ["PATCH", `/v1/scripts/${script.id}`],
    ["DELETE", `/v1/runbooks/${runbook.id}`],
    ["DELETE", `/v1/scripts/${script.id}/revisions/1`],
  ];
  for (const [method, path] of wrongMethods) {
    const r = await api(path, { method });
    assert.equal(r.res.status, 405, `${method} ${path} -> ${r.res.status}`);
    assert.equal(r.json.error.code, "method_not_allowed");
    assert.ok(
      r.res.headers.has("allow"),
      `${method} ${path} must include an Allow header`,
    );
  }

  const nonexistent = [
    ["GET", `/v1/scripts/${script.id}/execute`],
    ["POST", `/v1/scripts/${script.id}/cleanup`],
    ["GET", "/v1/audit/cleanup"],
    ["POST", `/v1/runbooks/${runbook.id}/cleanup`],
  ];
  for (const [method, path] of nonexistent) {
    const r = await api(path, { method });
    assert.equal(r.res.status, 404, `${method} ${path} -> ${r.res.status}`);
    assert.equal(r.json.error.code, "not_found");
  }

  const revs = await api(`/v1/scripts/${script.id}/revisions`);
  assert.deepEqual(
    revs.json.items.map((i) => i.revision),
    [1],
  );
  const rb = await api(`/v1/runbooks/${runbook.id}`);
  assert.equal(rb.json.revision, 1);
  assert.equal(rb.json.steps.length, 1);
});

test("T-BOUND-2: every non-health route requires a valid X-Spring-Pool-Actor", async () => {
  const uniq = randomUUID().slice(0, 8);
  const script = await createScript({ title: `${RUN}-${uniq}-auth` });
  const routes = [
    ["GET", "/v1/scripts"],
    ["POST", "/v1/scripts"],
    ["GET", `/v1/scripts/${script.id}`],
    ["PUT", `/v1/scripts/${script.id}`],
    ["POST", `/v1/scripts/${script.id}/archive`],
    ["GET", `/v1/scripts/${script.id}/revisions`],
    ["GET", `/v1/scripts/${script.id}/revisions/1`],
    ["GET", "/v1/runbooks"],
    ["POST", "/v1/runbooks"],
    ["GET", `/v1/runbooks/${script.id}`],
    ["PUT", `/v1/runbooks/${script.id}`],
    ["POST", `/v1/runbooks/${script.id}/archive`],
    ["GET", `/v1/runbooks/${script.id}/revisions`],
    ["GET", `/v1/runbooks/${script.id}/revisions/1`],
    ["GET", `/v1/runbooks/${script.id}/revisions/1/export`],
    ["GET", "/v1/audit"],
  ];
  for (const [method, path] of routes) {
    const r = await api(path, { method, actor: null });
    assert.equal(
      r.res.status,
      401,
      `${method} ${path} without actor -> ${r.res.status}`,
    );
    assert.equal(r.json.error.code, "unauthenticated");
  }

  const badActors = ["x", "no-at-sign", `a@b${"c".repeat(300)}`, "a\u0000@b"];
  for (const bad of badActors) {
    const r = await api("/v1/scripts", { actor: bad });
    assert.equal(
      r.res.status,
      401,
      `actor ${JSON.stringify(bad)} -> ${r.res.status}`,
    );
    assert.equal(r.json.error.code, "unauthenticated");
  }
});

test("T-VAL-1: strict serde and semantic validation with documented issue codes", async () => {
  const uniq = randomUUID().slice(0, 8);
  const base = () => ({
    title: `${RUN}-${uniq}-val`,
    description: "",
    tags: [],
    language: "bash",
    body: "echo ok\n",
  });

  const unknown = await api("/v1/scripts", {
    method: "POST",
    body: { ...base(), extra: true },
  });
  assert.equal(unknown.res.status, 400);
  assert.equal(unknown.json.error.code, "invalid_request");

  const wrongType = await api("/v1/scripts", {
    method: "POST",
    body: { ...base(), title: 42 },
  });
  assert.equal(wrongType.res.status, 400);
  assert.equal(wrongType.json.error.code, "invalid_request");

  const malformed = await raw("/v1/scripts", {
    method: "POST",
    body: "{not json",
  });
  assert.equal(malformed.res.status, 400);
  assert.ok(
    malformed.json,
    `expected an error envelope, got: ${malformed.text.slice(0, 120)}`,
  );
  assert.equal(malformed.json.error.code, "invalid_request");

  const missingRequired = await api("/v1/scripts", {
    method: "POST",
    body: { title: "x" },
  });
  assert.equal(missingRequired.res.status, 400);
  assert.equal(missingRequired.json.error.code, "invalid_request");

  const badTag = await api("/v1/scripts", {
    method: "POST",
    body: { ...base(), tags: ["BadTag"] },
  });
  assert.equal(badTag.res.status, 422);
  assert.equal(badTag.json.error.code, "validation_failed");
  assert.equal(badTag.json.error.details[0].field, "tags[0]");
  assert.equal(badTag.json.error.details[0].issue, "invalid_format");

  const dupTag = await api("/v1/scripts", {
    method: "POST",
    body: { ...base(), tags: ["ops", "ops"] },
  });
  assert.equal(dupTag.res.status, 422);
  assert.ok(dupTag.json.error.details.some((d) => d.issue === "duplicate"));

  const badLang = await api("/v1/scripts", {
    method: "POST",
    body: { ...base(), language: "perl" },
  });
  assert.equal(badLang.res.status, 422);
  assert.equal(badLang.json.error.code, "validation_failed");
  assert.equal(badLang.json.error.details[0].issue, "invalid_value");

  const nulBody = await api("/v1/scripts", {
    method: "POST",
    body: { ...base(), body: "a\u0000b" },
  });
  assert.equal(nulBody.res.status, 422);
  assert.equal(nulBody.json.error.code, "validation_failed");

  const emptyTitle = await api("/v1/scripts", {
    method: "POST",
    body: { ...base(), title: "   " },
  });
  assert.equal(emptyTitle.res.status, 422);
  assert.equal(emptyTitle.json.error.code, "validation_failed");
  assert.equal(emptyTitle.json.error.details[0].issue, "too_short");

  const ctrlTitle = await api("/v1/scripts", {
    method: "POST",
    body: { ...base(), title: "bad\u0007title" },
  });
  assert.equal(ctrlTitle.res.status, 422);
  assert.equal(ctrlTitle.json.error.code, "validation_failed");
});

test("invalid query parameters return 400 invalid_request", async () => {
  const paths = [
    "/v1/scripts?limit=0",
    "/v1/scripts?limit=101",
    "/v1/scripts?limit=abc",
    "/v1/scripts?archived=banana",
    "/v1/scripts?before_id=0",
    "/v1/scripts?tag=Bad_Tag",
    "/v1/runbooks?limit=0",
    "/v1/audit?limit=0",
  ];
  for (const path of paths) {
    const r = await api(path);
    assert.equal(r.res.status, 400, `GET ${path} -> ${r.res.status}`);
    assert.equal(r.json.error.code, "invalid_request");
  }
});

test("T-SIZE-1/T-SIZE-2: body byte limits are exact — 65536 ok, 65537 -> 413 script_too_large", async () => {
  const uniq = randomUUID().slice(0, 8);
  const title = `${RUN}-${uniq}-size`;

  const bodyOk = "é".repeat(32768);
  assert.equal(Buffer.byteLength(bodyOk, "utf8"), 65536);
  const ok = await api("/v1/scripts", {
    method: "POST",
    body: {
      title,
      description: "",
      tags: [],
      language: "python",
      body: bodyOk,
    },
  });
  assert.equal(ok.res.status, 201, ok.text.slice(0, 200));
  assert.equal(ok.json.byte_size, 65536);

  const tooBig = await api("/v1/scripts", {
    method: "POST",
    body: {
      title: `${title}-big`,
      description: "",
      tags: [],
      language: "bash",
      body: "a".repeat(65537),
    },
  });
  assert.equal(tooBig.res.status, 413);
  assert.equal(tooBig.json.error.code, "script_too_large");
  assert.equal(tooBig.json.error.details[0].field, "body");

  const hugeRaw = JSON.stringify({
    title: `${title}-raw`,
    description: "",
    tags: [],
    language: "bash",
    body: "a".repeat(600_000),
  });
  assert.ok(Buffer.byteLength(hugeRaw, "utf8") > 524_288);
  const rawTooBig = await raw("/v1/scripts", { method: "POST", body: hugeRaw });
  assert.equal(rawTooBig.res.status, 413);
  assert.equal(rawTooBig.json.error.code, "request_too_large");
});

test("T-SIZE-3: runbook step counts — 30 ok, 31 -> too_many_items, 0 -> too_few_items", async () => {
  const uniq = randomUUID().slice(0, 8);
  const script = await createScript({ title: `${RUN}-${uniq}-steps` });
  const pin = { script_id: script.id, script_revision: 1, instruction: "step" };

  const ok30 = await createRunbook({
    title: `${RUN}-${uniq}-steps-30`,
    steps: Array.from({ length: 30 }, (_, i) => ({
      ...pin,
      instruction: `step ${i + 1}`,
    })),
  });
  assert.equal(ok30.steps.length, 30);
  assert.equal(ok30.steps[0].position, 1);
  assert.equal(ok30.steps[29].position, 30);

  const tooMany = await api("/v1/runbooks", {
    method: "POST",
    body: {
      title: `${RUN}-${uniq}-steps-31`,
      steps: Array.from({ length: 31 }, () => ({ ...pin })),
    },
  });
  assert.equal(tooMany.res.status, 422);
  assert.equal(tooMany.json.error.code, "validation_failed");
  assert.equal(tooMany.json.error.details[0].issue, "too_many_items");

  const tooFew = await api("/v1/runbooks", {
    method: "POST",
    body: { title: `${RUN}-${uniq}-steps-0`, steps: [] },
  });
  assert.equal(tooFew.res.status, 422);
  assert.equal(tooFew.json.error.code, "validation_failed");
  assert.equal(tooFew.json.error.details[0].issue, "too_few_items");
});

test("search semantics: q substring (case-insensitive), exact tag, AND combination, id DESC", async () => {
  const uniq = randomUUID().slice(0, 8);
  const t1 = `${RUN}-${uniq}-AlphaOps`;
  const t2 = `${RUN}-${uniq}-BetaOps`;
  const t3 = `${RUN}-${uniq}-GammaDb`;
  await createScript({ title: t1, tags: ["ops"] });
  await createScript({ title: t2, tags: ["ops", "db"] });
  await createScript({ title: t3, tags: ["db"] });

  const all = await api(`/v1/scripts?q=${encodeURIComponent(uniq)}`);
  assert.equal(all.json.items.length, 3);

  const alpha = await api(`/v1/scripts?q=${uniq}-alphaops`);
  assert.deepEqual(
    alpha.json.items.map((i) => i.title),
    [t1],
  );

  const ops = await api("/v1/scripts?tag=ops");
  const opsTitles = ops.json.items.map((i) => i.title);
  assert.ok(
    opsTitles.includes(t1) && opsTitles.includes(t2) && !opsTitles.includes(t3),
  );

  const combined = await api(`/v1/scripts?q=${uniq}-alpha&tag=ops`);
  assert.deepEqual(
    combined.json.items.map((i) => i.title),
    [t1],
  );

  const ids = all.json.items.map((i) => i.id);
  assert.deepEqual(
    ids,
    [...ids].sort((a, b) => b - a),
  );
  assert.equal(new Set(ids).size, 3);
});

test("pagination via limit and before_id walks the full set ordered id DESC", async () => {
  const uniq = randomUUID().slice(0, 8);
  const created = [];
  for (let i = 0; i < 5; i += 1) {
    created.push(await createScript({ title: `${RUN}-${uniq}-page${i}` }));
  }
  const page1 = await api(`/v1/scripts?q=${uniq}&limit=2`);
  assert.equal(page1.json.items.length, 2);
  assert.equal(typeof page1.json.next_before_id, "number");
  const page2 = await api(
    `/v1/scripts?q=${uniq}&limit=2&before_id=${page1.json.next_before_id}`,
  );
  assert.equal(page2.json.items.length, 2);
  const page3 = await api(
    `/v1/scripts?q=${uniq}&limit=2&before_id=${page2.json.next_before_id}`,
  );
  assert.equal(page3.json.items.length, 1);
  assert.equal(page3.json.next_before_id, null);

  const walked = [
    ...page1.json.items,
    ...page2.json.items,
    ...page3.json.items,
  ].map((i) => i.id);
  const expected = created.map((c) => c.id).sort((a, b) => b - a);
  assert.deepEqual(walked, expected);
});

test("T-ARCH-2: archived scripts are excluded by default, included or listed alone via archived=include/only", async () => {
  const uniq = randomUUID().slice(0, 8);
  const live = await createScript({ title: `${RUN}-${uniq}-live` });
  const doomed = await createScript({ title: `${RUN}-${uniq}-doomed` });

  const archived = await api(`/v1/scripts/${doomed.id}/archive`, {
    method: "POST",
    body: { expected_revision: 1 },
  });
  assert.equal(archived.res.status, 200);
  assert.ok(archived.json.archived_at !== null);
  assert.equal(
    archived.json.revision,
    1,
    "archiving must not change the revision",
  );

  const exclude = await api(`/v1/scripts?q=${uniq}`);
  assert.deepEqual(
    exclude.json.items.map((i) => i.id),
    [live.id],
  );

  const include = await api(`/v1/scripts?q=${uniq}&archived=include`);
  assert.equal(include.json.items.length, 2);

  const only = await api(`/v1/scripts?q=${uniq}&archived=only`);
  assert.deepEqual(
    only.json.items.map((i) => i.id),
    [doomed.id],
  );

  const again = await api(`/v1/scripts/${doomed.id}/archive`, {
    method: "POST",
    body: { expected_revision: 1 },
  });
  assert.equal(again.res.status, 409);
  assert.equal(again.json.error.code, "archived");

  const putArchived = await api(`/v1/scripts/${doomed.id}`, {
    method: "PUT",
    body: {
      expected_revision: 1,
      title: `${RUN}-${uniq}-doomed`,
      description: "",
      tags: [],
      language: "bash",
      body: "nope\n",
    },
  });
  assert.equal(putArchived.res.status, 409);
  assert.equal(putArchived.json.error.code, "archived");

  const head = await api(`/v1/scripts/${doomed.id}`);
  assert.equal(head.res.status, 200);
  assert.equal(head.json.archived_at, archived.json.archived_at);
});

test("T-ARCH-1/T-EXP-3: pinned revisions stay readable after archive; export carries the pinned body and headers", async () => {
  const uniq = randomUUID().slice(0, 8);
  const bodyV1 = '#!/usr/bin/env python\nprint("v1")\n```\ninline run ``\n';
  const script = await createScript({
    title: `${RUN}-${uniq}-arch-pin`,
    description: "pinned once",
    tags: ["pin"],
    language: "python",
    body: bodyV1,
  });

  const runbook = await createRunbook({
    title: `${RUN}-${uniq}-runbook`,
    description: "",
    steps: [
      { script_id: script.id, script_revision: 1, instruction: "run step one" },
    ],
  });

  await api(`/v1/scripts/${script.id}`, {
    method: "PUT",
    body: {
      expected_revision: 1,
      title: `${RUN}-${uniq}-arch-pin`,
      description: "pinned once",
      tags: ["pin"],
      language: "python",
      body: 'print("v2")\n',
    },
  });
  await api(`/v1/scripts/${script.id}/archive`, {
    method: "POST",
    body: { expected_revision: 2 },
  });

  const rb = await api(`/v1/runbooks/${runbook.id}`);
  assert.equal(rb.res.status, 200);
  assert.equal(rb.json.steps.length, 1);
  assert.equal(rb.json.steps[0].script_id, script.id);
  assert.equal(rb.json.steps[0].script_revision, 1);
  assert.equal(rb.json.steps[0].script_archived, true);
  assert.equal(rb.json.steps[0].script_title, `${RUN}-${uniq}-arch-pin`);

  const rev1 = await api(`/v1/scripts/${script.id}/revisions/1`);
  assert.equal(rev1.res.status, 200);
  assert.equal(rev1.json.body, bodyV1);
  assert.ok(rev1.json.script_archived_at !== null);

  const exp = await raw(`/v1/runbooks/${runbook.id}/revisions/1/export`);
  assert.equal(exp.res.status, 200, exp.text.slice(0, 200));
  assert.equal(
    exp.res.headers.get("content-type"),
    "text/markdown; charset=utf-8",
  );
  const disposition = exp.res.headers.get("content-disposition") ?? "";
  assert.match(disposition, /attachment/);
  assert.ok(
    disposition.includes(`runbook-${runbook.id}-r1.md`),
    `content-disposition: ${disposition}`,
  );
  assert.ok(
    exp.text.includes(bodyV1),
    "export must embed the pinned body verbatim",
  );
  assert.ok(exp.text.includes("run step one"));
  assert.equal(exp.text.endsWith("\n"), true);
  assert.equal(exp.text.endsWith("\n\n"), false);

  const runs = exp.text.match(/`+/g) ?? [];
  const maxRun = Math.max(0, ...runs.map((r) => r.length));
  const bodyMaxRun = Math.max(
    0,
    ...(bodyV1.match(/`+/g) ?? []).map((r) => r.length),
  );
  assert.ok(
    maxRun >= bodyMaxRun + 1,
    `fence must be longer than the longest body backtick run (max ${maxRun}, body ${bodyMaxRun})`,
  );
});

test("T-HEALTH-1: health endpoint returns the documented shape and leaks no identities", async () => {
  const health = await raw("/v1/health");
  assert.equal(health.res.status, 200);
  assert.deepEqual(Object.keys(health.json).sort(), [
    "build",
    "database",
    "service",
    "status",
  ]);
  assert.equal(health.json.status, "ok");
  assert.equal(health.json.service, "spring-pool-api");
  assert.equal(health.json.database, "ok");
  assert.equal(typeof health.json.build, "string");
  assert.ok(health.json.build.length > 0);

  const serialized = JSON.stringify(health.json);
  assert.ok(!serialized.includes("@"), "health must not contain an email");
  assert.ok(
    !/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(
      serialized,
    ),
    "health must not contain a UUID (database/account id)",
  );
  assert.ok(
    !/cloudflare/i.test(serialized),
    "health must not mention Cloudflare identifiers",
  );
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

  const before = await api("/v1/audit?limit=1");
  assert.ok(
    before.json.items.length >= 1,
    "audit must already contain events from earlier tests",
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
