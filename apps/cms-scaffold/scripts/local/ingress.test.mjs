import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import https from "node:https";
import tls from "node:tls";
import { mkdtemp, mkdir, writeFile, readFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { loadConfig, createIngress } from "./ingress.mjs";

const config = {
  version: 1,
  origins: Object.fromEntries(["front", "back", "admin", "api"].map((surface) => [surface, `https://${surface}.cms.test:8443`])),
  dist: { front: "/dist/front", back: "/dist/back", admin: "/dist/admin" },
  certPath: "/tls/leaf.crt", keyPath: "/tls/leaf.key", upstream: "http://cms-api:8080",
};
const canary = "fixture-private-canary";
let root, ca, upstream, behavior;
before(async () => {
  root = await mkdtemp(join(tmpdir(), "pp1-ingress-"));
  await mkdir(join(root, "tls"), { mode: 0o700 });
  const openssl = (args) => execFileSync("openssl", args, { cwd: join(root, "tls"), stdio: "ignore" });
  openssl(["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-sha256", "-days", "2", "-subj", "/CN=PP1 test CA", "-keyout", "ca.key", "-out", "ca.crt"]);
  openssl(["req", "-new", "-newkey", "rsa:2048", "-nodes", "-subj", "/CN=front.cms.test", "-keyout", "leaf.key", "-out", "leaf.csr"]);
  await writeFile(join(root, "tls", "extensions"), "subjectAltName=DNS:front.cms.test,DNS:back.cms.test,DNS:admin.cms.test,DNS:api.cms.test\n");
  openssl(["x509", "-req", "-in", "leaf.csr", "-CA", "ca.crt", "-CAkey", "ca.key", "-CAcreateserial", "-sha256", "-days", "2", "-extfile", "extensions", "-out", "leaf.crt"]);
  ca = await readFile(join(root, "tls", "ca.crt"));
  for (const surface of ["front", "back", "admin"]) {
    const dist = join(root, "dist", surface);
    await mkdir(dist, { recursive: true });
    await writeFile(join(dist, "index.html"), `<h1>${surface}</h1>`);
    for (const ext of ["js", "css", "json", "svg", "png", "ico", "woff2", "bin"]) await writeFile(join(dist, `asset.${ext}`), surface);
  }
  await writeFile(join(root, "secret"), canary);
  await symlink(join(root, "secret"), join(root, "dist", "front", "leak.txt"));
  await symlink(join(root, "dist", "admin"), join(root, "dist", "front", "other"));
  upstream = http.createServer((req, res) => behavior(req, res));
  upstream.listen(0, "127.0.0.1"); await once(upstream, "listening");
});
after(async () => {
  upstream.closeAllConnections(); await new Promise((done) => upstream.close(done));
  await rm(root, { recursive: true, force: true });
});
async function fixture(t, extra = {}) {
  const request = (options, callback) => {
    assert.equal(options.hostname, "cms-api"); assert.equal(String(options.port), "8080");
    return http.request({ ...options, hostname: "127.0.0.1", port: upstream.address().port }, callback);
  };
  const server = createIngress(config, { filesystemRoot: root, request, ...extra });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  t.after(async () => { server.closeAllConnections(); await new Promise((done) => server.close(done)); });
  return server.address().port;
}
function get(port, options = {}, body) {
  return new Promise((done, reject) => {
    const req = https.request({ hostname: "127.0.0.1", port, servername: "front.cms.test", ca,
      path: "/", agent: false, ...options, headers: { host: "front.cms.test:8443", ...options.headers } }, (res) => {
      const chunks = []; res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => done({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      res.on("error", reject);
    });
    req.on("error", reject); req.end(body);
  });
}
function api(port, options = {}, body) {
  return get(port, { ...options, servername: "api.cms.test", headers: { host: "api.cms.test:8443", ...options.headers } }, body);
}

test("strict config rejects unknown, missing, duplicate and override fields", async () => {
  const path = join(root, "config.json");
  await writeFile(path, JSON.stringify(config)); assert.deepEqual(loadConfig(path), config);
  for (const change of [ { ...config, proxyTimeoutMs: 1 }, { ...config, filesystemRoot: root },
    { ...config, upstream: "http://127.0.0.1:8080" }, { ...config, dist: { ...config.dist, front: root } },
    { ...config, origins: { ...config.origins, admin: config.origins.front } }, { ...config, keyPath: undefined } ]) {
    await writeFile(path, JSON.stringify(change)); assert.throws(() => loadConfig(path), /PP1_INGRESS_CONFIG_INVALID/);
  }
  await writeFile(path, JSON.stringify(config).replace('"version":1', '"version":1,"version":1'));
  assert.throws(() => loadConfig(path), /PP1_INGRESS_CONFIG_INVALID/);
  await symlink(path, join(root, "linked-config")); assert.throws(() => loadConfig(join(root, "linked-config")), /PP1_INGRESS_CONFIG_INVALID/);
});
test("CLI rejects override flags and config fields with fixed safe errors", async () => {
  const script = fileURLToPath(new URL("./ingress.mjs", import.meta.url));
  const path = join(root, "cli-config.json");
  await writeFile(path, JSON.stringify({ ...config, request: canary }));
  for (const args of [["--config", path], ["--config", path, "--filesystem-root", canary], ["--unknown", canary]]) {
    const result = spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });
    assert.equal(result.status, 2); assert.equal(result.stdout, "");
    assert.equal(result.stderr, "PP1_INGRESS_CONFIG_INVALID\n");
  }
});

test("PP1aFM03 trusted CA succeeds, unknown CA and wrong name reject", async (t) => {
  const port = await fixture(t);
  assert.equal((await get(port)).status, 200);
  await assert.rejects(get(port, { ca: undefined }), (error) => ["UNABLE_TO_VERIFY_LEAF_SIGNATURE", "UNABLE_TO_GET_ISSUER_CERT_LOCALLY", "SELF_SIGNED_CERT_IN_CHAIN", "DEPTH_ZERO_SELF_SIGNED_CERT"].includes(error.code));
  await assert.rejects(get(port, { servername: "wrong.cms.test" }), { code: "ERR_TLS_CERT_ALTNAME_INVALID" });
});
test("PP1aFM03 exact Host and SNI are required", async (t) => {
  const port = await fixture(t);
  for (const host of ["unknown.cms.test:8443", "front.cms.test", "front.cms.test:443", "back.cms.test:8443"]) {
    assert.equal((await get(port, { headers: { host } })).status, 421);
  }
  assert.equal((await get(port, { hostname: "front.cms.test", autoSelectFamily: false,
    lookup: (_hostname, _options, callback) => callback(null, "127.0.0.1", 4), servername: "" })).status, 421);
});
test("PP1aFM04 each surface serves only its dist, HEAD mirrors GET", async (t) => {
  const port = await fixture(t);
  for (const surface of ["front", "back", "admin"]) {
    const options = { servername: `${surface}.cms.test`, headers: { host: `${surface}.cms.test:8443` } };
    const response = await get(port, options);
    assert.equal(response.status, 200); assert.equal(response.body.toString(), `<h1>${surface}</h1>`);
    assert.equal(response.headers["cache-control"], "no-store"); assert.equal(response.headers["x-content-type-options"], "nosniff");
    const head = await get(port, { ...options, method: "HEAD" });
    assert.equal(head.status, response.status); assert.equal(head.body.length, 0);
    for (const name of ["content-length", "content-type", "cache-control"]) assert.equal(head.headers[name], response.headers[name]);
  }
  assert.equal((await get(port, { method: "POST" })).status, 405);
});
test("PP1aFM04 MIME, SPA Accept and missing assets have precise behavior", async (t) => {
  const port = await fixture(t);
  const types = { js: "text/javascript", css: "text/css", json: "application/json", svg: "image/svg+xml", png: "image/png", ico: "image/x-icon", woff2: "font/woff2", bin: "application/octet-stream" };
  for (const [ext, type] of Object.entries(types)) {
    const response = await get(port, { path: `/asset.${ext}?v=1` });
    assert.equal(response.status, 200); assert.equal(response.headers["content-type"], type);
    assert.equal(response.headers["cache-control"], "public,max-age=3600");
  }
  assert.equal((await get(port, { path: "/deep/route", headers: { accept: "text/html" } })).status, 200);
  for (const path of ["/missing.js", "/missing.png", "/absent", "/media/private.jpg"]) {
    assert.equal((await get(port, { path, headers: { accept: "application/json" } })).status, 404);
  }
  assert.equal((await get(port, { path: "/missing.js", headers: { accept: "text/html" } })).status, 404);
});
test("PP1aFM04 missing assets never use SPA fallback even without extension", async (t) => {
  const port = await fixture(t);
  for (const path of ["/assets", "/assets/missing", "/assets/missing?version=1", "/assets/nested/missing", "/%61ssets/missing", "/assets%2fmissing"]) {
    const response = await get(port, { path, headers: { accept: "text/html" } });
    assert.equal(response.status, 404, path);
    assert.equal(response.body.length, 0);
  }
  assert.equal((await get(port, { path: "/assets/missing", method: "HEAD", headers: { accept: "text/html" } })).status, 404);
  assert.equal((await get(port, { path: "/deep/route", headers: { accept: "text/html" } })).status, 200);
});
test("PP1aFM04 raw and encoded unsafe paths, links and directories never expose files", async (t) => {
  const port = await fixture(t);
  for (const path of ["/../secret", "/%2e%2e/secret", "/./index.html", "/%2e/index.html", "/%00", "/a%5cb", "/bad%", "/leak.txt", "/other/index.html", "https://front.cms.test:8443/"]) {
    const response = await get(port, { path }); assert.ok([400, 403].includes(response.status), path);
    assert.ok(!response.body.includes(Buffer.from(canary)));
  }
  assert.equal((await get(port, { path: "/other", headers: { accept: "text/html" } })).status, 403);
});
test("PP1aFM05 proxy preserves binary body, auth, query and cookies; removes hop headers", async (t) => {
  const port = await fixture(t); const body = Buffer.from([0, 255, 17, 10]); let calls = 0, received;
  const cookies = ["cms_session=fixture; Secure; HttpOnly; SameSite=Lax", "cms_csrf=fixture; Secure; SameSite=Lax"];
  behavior = (req, res) => {
    calls++; const chunks = []; req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      received = { headers: req.headers, body: Buffer.concat(chunks), method: req.method, url: req.url };
      res.writeHead(201, { "set-cookie": cookies, "content-type": "application/octet-stream", connection: "x-response-hop", "x-response-hop": canary, "cache-control": "public", "x-request-id": "fixture-id" }); res.end(body);
    });
  };
  const headers = { authorization: `Bearer ${canary}`, "content-type": "application/octet-stream", "x-cms-surface": "admin", "x-request-id": "fixture-id", origin: config.origins.admin, cookie: `cms_session=${canary}`, "x-csrf-token": canary, connection: "x-request-hop", "x-request-hop": canary, "proxy-authorization": canary, "proxy-connection": canary, te: "trailers", "keep-alive": "timeout=500", "content-length": String(body.length) };
  const response = await api(port, { path: "/api/v1/echo?exact=%2F&x=1", method: "POST", headers }, body);
  assert.equal(response.status, 201); assert.deepEqual(response.body, body); assert.equal(calls, 1);
  assert.deepEqual(received.body, body); assert.equal(received.method, "POST"); assert.equal(received.url, "/api/v1/echo?exact=%2F&x=1");
  for (const name of ["authorization", "content-type", "x-cms-surface", "x-request-id", "origin", "cookie", "x-csrf-token"]) assert.equal(received.headers[name], headers[name]);
  assert.equal(received.headers.host, "cms-api:8080"); assert.equal(received.headers["x-request-hop"], undefined);
  for (const name of ["proxy-authorization", "proxy-connection", "te", "keep-alive"]) assert.equal(received.headers[name], undefined);
  assert.equal(response.headers["x-response-hop"], undefined); assert.deepEqual(response.headers["set-cookie"], cookies);
  assert.equal(response.headers["cache-control"], "no-store"); assert.equal(response.headers["x-request-id"], "fixture-id");
});
test("CONNECT and upgrade are rejected without reaching upstream", async (t) => {
  const port = await fixture(t); let calls = 0;
  behavior = (_req, res) => { calls++; res.end(); };
  for (const line of ["CONNECT api.cms.test:8443 HTTP/1.1", "GET /api/v1/stream HTTP/1.1"]) {
    const response = await new Promise((done, reject) => {
      const socket = tls.connect({ host: "127.0.0.1", port, servername: "api.cms.test", ca }, () => {
        socket.write(`${line}\r\nHost: api.cms.test:8443\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n`);
      });
      let output = ""; socket.on("data", (chunk) => { output += chunk; });
      socket.on("error", reject); socket.on("end", () => done(output));
    });
    assert.match(response, /^HTTP\/1\.1 400 /);
  }
  assert.equal(calls, 0);
});
test("client abort during upload terminates upstream without retry", async (t) => {
  const port = await fixture(t); let incoming, closed, calls = 0;
  const bodySeen = new Promise((done) => { incoming = done; });
  const aborted = new Promise((done) => { closed = done; });
  behavior = (req, res) => { calls++; req.on("error", () => {}); req.once("data", incoming); res.on("close", closed); };
  const req = https.request({ hostname: "127.0.0.1", port, servername: "api.cms.test", ca, agent: false,
    path: "/api/v1/upload", method: "POST", headers: { host: "api.cms.test:8443", "content-length": "100000" } });
  req.on("error", () => {}); req.write("partial");
  await bodySeen; req.destroy(); await aborted;
  assert.equal(calls, 1);
});
test("PP1aFM05 fixed API allowlist, no surface invention and no write retry", async (t) => {
  const port = await fixture(t); let calls = 0;
  behavior = (req, res) => { calls++; assert.equal(req.headers["x-cms-surface"], undefined); res.end("ok"); };
  for (const path of ["/openapi.yaml", "/api/v10/wrong", "/actuator/env", "/", "/api/v1"]) assert.equal((await api(port, { path })).status, 404);
  assert.equal(calls, 0); assert.equal((await api(port, { path: "/actuator/health" })).status, 200);
  behavior = (req) => { calls++; req.socket.destroy(); };
  assert.equal((await api(port, { path: "/api/v1/write", method: "POST" }, canary)).status, 502); assert.equal(calls, 2);
});
test("PP1aFM05 whole request timeout is 504 and aborts upstream", async (t) => {
  let fireTimeout, calls = 0, closed, incoming;
  const received = new Promise((done) => { incoming = done; });
  const timers = { setTimeout(callback, milliseconds) { assert.equal(milliseconds, 15000); fireTimeout = callback; return { unref() {} }; }, clearTimeout() {} };
  const port = await fixture(t, { timers });
  const aborted = new Promise((done) => { closed = done; });
  behavior = (_req, res) => { calls++; res.on("close", closed); incoming(); };
  const response = api(port, { path: "/api/v1/timeout" });
  await received; fireTimeout(); assert.equal((await response).status, 504);
  await aborted; assert.equal(calls, 1);
});
test("PP1aFM05 client abort terminates upstream and late errors do not crash ingress", async (t) => {
  const port = await fixture(t); let closed;
  const aborted = new Promise((done) => { closed = done; });
  behavior = (_req, res) => { res.on("close", closed); res.writeHead(200); res.write("first"); };
  await new Promise((done, reject) => {
    const req = https.get({ hostname: "127.0.0.1", port, servername: "api.cms.test", ca, agent: false, path: "/api/v1/stream", headers: { host: "api.cms.test:8443" } }, (res) => {
      res.once("data", () => { res.destroy(); done(); });
    }); req.on("error", reject);
  });
  await aborted;
  behavior = (_req, res) => { res.writeHead(200); res.write("partial"); setImmediate(() => res.destroy()); };
  await assert.rejects(api(port, { path: "/api/v1/broken" }));
  behavior = (_req, res) => res.end("healthy");
  assert.equal((await api(port, { path: "/actuator/health" })).body.toString(), "healthy");
});
test("PP1aFM05 failures never log secret query/header/body or input exception", async (t) => {
  const port = await fixture(t); const output = [], originals = [console.log, console.error];
  console.log = (...args) => output.push(args.join(" ")); console.error = (...args) => output.push(args.join(" "));
  try {
    behavior = (req) => req.socket.destroy();
    assert.equal((await api(port, { path: `/api/v1/fail?private=${canary}`, method: "POST", headers: { authorization: canary } }, canary)).status, 502);
    assert.throws(() => createIngress({ ...config, upstream: canary }), /PP1_INGRESS_CONFIG_INVALID/);
    assert.ok(!output.join("\n").includes(canary));
  } finally { [console.log, console.error] = originals; }
});
