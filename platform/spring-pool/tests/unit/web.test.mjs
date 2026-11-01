import { test } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { readFileSync } from "node:fs";
import { transformSync } from "esbuild";

// Node strips TS natively; compile JSX with Wrangler's locked esbuild tool.
registerHooks({
  load(url, context, nextLoad) {
    if (!url.endsWith(".tsx")) return nextLoad(url, context);
    return {
      format: "module",
      shortCircuit: true,
      source: transformSync(readFileSync(new URL(url), "utf8"), {
        loader: "tsx",
        format: "esm",
        target: "es2022",
        jsx: "automatic",
        jsxImportSource: "hono/jsx",
      }).code,
    };
  },
});
const { default: app } = await import("../../web/src/index.tsx");
const token = "a".repeat(43);
const env = {
  AUTH_MODE: "local",
  ENVIRONMENT: "local",
  LOCAL_OWNER_EMAIL: "Owner@Example.test",
};
const fixture = {
  id: 7,
  revision: 2,
  title: "Fixture",
  description: "",
  tags: [],
  language: "bash",
  body: "echo safe\n",
  byte_size: 10,
  created_at: "2026-10-01T00:00:00Z",
  updated_at: "2026-10-01T00:00:00Z",
  archived_at: null,
};
function binding(reply = () => Response.json(fixture)) {
  const calls = [];
  return {
    calls,
    API: {
      fetch: async (request) => {
        calls.push(request);
        return reply(request);
      },
    },
  };
}
function request(path, setup, options = {}, config = env) {
  return app.fetch(new Request(`http://localhost${path}`, options), {
    ...config,
    API: setup.API,
  });
}
function post(fields = {}, upload) {
  const form = new FormData();
  for (const [name, value] of Object.entries({
    csrf: token,
    title: "Draft",
    description: "",
    tags: "OPS, database, ,",
    language: "bash",
    body: "",
    ...fields,
  }))
    form.set(name, value);
  if (upload) form.set("file", upload, "script.txt");
  return {
    method: "POST",
    headers: {
      Origin: "http://localhost",
      Cookie: `sp_csrf=${token}`,
      "X-Spring-Pool-Actor": "attacker@example.test",
      Authorization: "do not forward",
    },
    body: form,
  };
}
test("web auth covers assets, health and unknown routes before API access", async () => {
  for (const path of [
    "/assets/app.css",
    "/assets/app.js",
    "/healthz",
    "/scripts",
    "/unknown",
  ]) {
    const setup = binding();
    const response = await request(path, setup, {}, { AUTH_MODE: "access" });
    assert.equal(response.status, 503);
    assert.equal(setup.calls.length, 0);
    assert.match(
      response.headers.get("Content-Security-Policy"),
      /default-src 'none'/,
    );
    assert.equal(response.headers.get("Cache-Control"), "no-store");
  }
});
test("web rejects invalid CSRF before API access", async () => {
  for (const modify of [
    (o) => delete o.headers.Origin,
    (o) => (o.headers.Origin = "https://evil.test"),
    (o) => o.body.delete("csrf"),
    (o) => (o.headers.Cookie = `sp_csrf=${"b".repeat(43)}`),
  ]) {
    const setup = binding(),
      options = post({ body: "x" });
    modify(options);
    const response = await request("/scripts", setup, options);
    assert.equal(response.status, 403);
    assert.match(await response.text(), /Request rejected \(CSRF\)/);
    assert.equal(setup.calls.length, 0);
  }
});
test("web uses fresh trusted headers, normalizes textarea and tags", async () => {
  const setup = binding();
  const response = await request("/scripts", setup, post({ body: "a\r\nb\n" }));
  assert.equal(response.status, 303);
  assert.equal(response.headers.get("location"), "/scripts/7");
  assert.equal(setup.calls.length, 1);
  const sent = setup.calls[0];
  assert.equal(sent.url, "https://api.internal/v1/scripts");
  assert.equal(sent.method, "POST");
  assert.deepEqual([...sent.headers.keys()].sort(), [
    "accept",
    "content-type",
    "x-spring-pool-actor",
  ]);
  assert.equal(sent.headers.get("X-Spring-Pool-Actor"), "owner@example.test");
  const payload = await sent.json();
  assert.equal(payload.body, "a\nb\n");
  assert.deepEqual(payload.tags, ["ops", "database"]);
});
test("web strictly decodes uploaded UTF-8 while retaining BOM and CRLF", async () => {
  const setup = binding(),
    bytes = Buffer.from("\ufeffa\r\nb\r\n", "utf8");
  assert.equal(
    (await request("/scripts", setup, post({}, new Blob([bytes])))).status,
    303,
  );
  const saved = await setup.calls[0].json();
  assert.deepEqual(Buffer.from(saved.body), bytes);
  for (const [fields, upload, expected, phrase] of [
    [
      {},
      new Blob([new Uint8Array([0xc3, 0x28])]),
      422,
      "File is not valid UTF-8.",
    ],
    [
      { body: "keep this" },
      new Blob(["x"]),
      422,
      "Provide pasted text or a file, not both.",
    ],
    [{}, new Blob(["x".repeat(65537)]), 413, "65 536 bytes"],
  ]) {
    const target = binding();
    const response = await request("/scripts", target, post(fields, upload));
    assert.equal(response.status, expected);
    assert.match(
      await response.text(),
      new RegExp(phrase.replaceAll(".", "\\.")),
    );
    assert.equal(target.calls.length, 0);
  }
});
test("web enforces raw request limit even without Content-Length", async () => {
  const setup = binding();
  const options = post();
  options.body = new URLSearchParams({ csrf: token, body: "x".repeat(262145) });
  const response = await request("/scripts", setup, options);
  assert.equal(response.status, 413);
  assert.equal(setup.calls.length, 0);
});
test("web preserves conflict edits and expected revision; fields escape HTML", async () => {
  const setup = binding(() =>
    Response.json(
      {
        error: {
          code: "revision_conflict",
          message: "changed",
          current_revision: 3,
        },
      },
      { status: 409 },
    ),
  );
  const payload = '<script>alert("x")</script>';
  const response = await request(
    "/scripts/7",
    setup,
    post({ title: payload, body: payload, expected_revision: "2" }),
  );
  assert.equal(response.status, 409);
  const html = await response.text();
  assert.match(html, /now revision 3/);
  assert.match(html, /href="\/scripts\/7"/);
  assert.match(html, /name="expected_revision" value="2"/);
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(!html.includes(payload));
  const sent = await setup.calls[0].json();
  assert.equal(sent.expected_revision, 2);
  assert.equal(sent.body, payload);
});
test("no-JS step actions reorder, add and remove without any API calls", async () => {
  const fields = {
    title: "Unsaved",
    action: "down:0",
    "steps[0].script_id": "7",
    "steps[0].script_revision": "2",
    "steps[0].instruction": "first",
    "steps[1].script_id": "8",
    "steps[1].script_revision": "1",
    "steps[1].instruction": "second",
    script_options: JSON.stringify([
      { id: 7, revision: 9, title: "Archived", archived_at: "yes" },
      { id: 8, revision: 4, title: "Active" },
    ]),
  };
  for (const action of ["down:0", "up:1", "add_step", "remove:0"]) {
    const setup = binding();
    const response = await request(
      "/runbooks",
      setup,
      post({ ...fields, action }),
    );
    assert.equal(response.status, 200);
    assert.equal(setup.calls.length, 0);
    const html = await response.text();
    assert.match(html, /value="Unsaved"/);
    assert.match(html, /Archived \(archived\)/);
    if (action === "down:0" || action === "up:1") {
      assert.ok(
        html.indexOf("second</textarea>") < html.indexOf("first</textarea>"),
      );
      assert.match(html, /name="steps\[1\].script_revision"[^>]*value="2"/);
    }
    if (action === "add_step") assert.match(html, /Step 3/);
    if (action === "remove:0") assert.doesNotMatch(html, />first<\/textarea>/);
  }
});
test("runbook save pins the submitted revisions and does not substitute heads", async () => {
  const setup = binding();
  const response = await request(
    "/runbooks",
    setup,
    post({
      action: "save",
      "steps[0].script_id": "7",
      "steps[0].script_revision": "1",
      "steps[0].instruction": "keep revision one",
    }),
  );
  assert.equal(response.status, 303);
  assert.equal(setup.calls[0].url, "https://api.internal/v1/runbooks");
  assert.deepEqual((await setup.calls[0].json()).steps, [
    { script_id: 7, script_revision: 1, instruction: "keep revision one" },
  ]);
});
test("web does not proxy arbitrary API paths or malformed IDs", async () => {
  const setup = binding();
  for (const path of [
    "/v1/scripts",
    "/api/v1/scripts",
    "/scripts/abc",
    "/scripts/0",
    "/scripts/7/revisions/no",
  ])
    assert.equal((await request(path, setup)).status, 404);
  assert.equal(setup.calls.length, 0);
});
test("web displays escaped script detail and streams export as an attachment", async () => {
  const hostile = "</code><script>alert(1)</script>";
  const detailSetup = binding(() =>
    Response.json({ ...fixture, title: hostile, body: hostile }),
  );
  const detail = await request("/scripts/7", detailSetup),
    html = await detail.text();
  assert.equal(detail.status, 200);
  assert.ok(html.includes("&lt;/code&gt;&lt;script&gt;"));
  assert.ok(!html.includes(hostile));
  const bytes = "# notebook\n\n```bash\nhello\n```\n";
  const setup = binding(() => new Response(bytes));
  const response = await request("/runbooks/7/revisions/2/export.md", setup);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), bytes);
  assert.equal(
    response.headers.get("Content-Type"),
    "text/markdown; charset=utf-8",
  );
  assert.equal(
    response.headers.get("Content-Disposition"),
    'attachment; filename="runbook-7-r2.md"',
  );
  assert.equal(response.headers.get("Cache-Control"), "no-store");
});
test("web maps service failures and uses safe health output", async () => {
  for (const [apiStatus, webStatus] of [
    [401, 500],
    [404, 404],
    [500, 502],
    [503, 502],
  ]) {
    const setup = binding(() =>
      Response.json(
        { error: { code: "failure", message: "internal secret" } },
        { status: apiStatus },
      ),
    );
    const response = await request("/scripts/7", setup);
    assert.equal(response.status, webStatus);
    assert.ok(!(await response.text()).includes("internal secret"));
  }
  const setup = binding(() =>
    Response.json({
      status: "ok",
      service: "spring-pool-api",
      build: "dev",
      database: "ok",
      email: "private",
    }),
  );
  const response = await request("/healthz", setup);
  assert.equal(response.status, 200);
  assert.ok(!(await response.text()).includes("private"));
});

test("editor protects an initial textarea newline from HTML parser trimming", async () => {
  const setup = binding(() =>
    Response.json({ ...fixture, body: "\nkeep blank first line\n" }),
  );
  const response = await request("/scripts/7/edit", setup);
  assert.equal(response.status, 200);
  assert.match(
    await response.text(),
    /<textarea[^>]*name="body"[^>]*>\n\nkeep blank first line\n<\/textarea>/,
  );
});

test("web normalizes native textarea CRLF in descriptions and step instructions", async () => {
  for (const kind of ["scripts", "runbooks"]) {
    const setup = binding();
    const response = await request(
      `/${kind}`,
      setup,
      post({
        description: "first\r\nsecond",
        body: "echo a\r\necho b",
        "steps[0].script_id": "7",
        "steps[0].script_revision": "2",
        "steps[0].instruction": "prepare\r\nrun",
      }),
    );
    assert.equal(response.status, 303);
    const saved = await setup.calls[0].json();
    assert.equal(saved.description, "first\nsecond");
    if (kind === "runbooks")
      assert.equal(saved.steps[0].instruction, "prepare\nrun");
  }
});

test("HTML responses select standards mode with a doctype", async () => {
  const response = await request("/scripts/new", binding());
  assert.equal(
    (await response.text()).slice(0, 15).toLowerCase(),
    "<!doctype html>",
  );
});
