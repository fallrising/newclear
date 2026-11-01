import https from "node:https";
import http from "node:http";
import { constants, lstatSync, openSync, fstatSync, closeSync, readFileSync, createReadStream } from "node:fs";
import { resolve, join, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";

const SURFACES = ["front", "back", "admin"];
const CONFIG_ERROR = "PP1_INGRESS_CONFIG_INVALID";
const HOP = new Set(["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade", "proxy-connection"]);
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".woff2": "font/woff2" };

function keys(value, expected) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).length === expected.length && expected.every((key) => Object.hasOwn(value, key));
}
function validate(config) {
  if (!keys(config, ["version", "origins", "dist", "certPath", "keyPath", "upstream"])
    || config.version !== 1 || !keys(config.origins, [...SURFACES, "api"]) || !keys(config.dist, SURFACES)
    || [...SURFACES, "api"].some((surface) => config.origins[surface] !== `https://${surface}.cms.test:8443`)
    || SURFACES.some((surface) => config.dist[surface] !== `/dist/${surface}`)
    || config.certPath !== "/tls/leaf.crt" || config.keyPath !== "/tls/leaf.key" || config.upstream !== "http://cms-api:8080") {
    throw new Error(CONFIG_ERROR);
  }
  return Object.freeze({ ...config, origins: Object.freeze({ ...config.origins }), dist: Object.freeze({ ...config.dist }) });
}
function noDuplicateKeys(raw) {
  const tokens = raw.match(/"(?:[^"\\]|\\[\s\S])*"|[{}\[\]:,]/g) || [];
  const stack = [];
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (token === "{") stack.push(new Set());
    else if (token === "[") stack.push(null);
    else if (token === "}" || token === "]") stack.pop();
    else if (token.startsWith('"') && tokens[index + 1] === ":") {
      const key = JSON.parse(token), current = stack.at(-1);
      if (current.has(key)) throw new Error(CONFIG_ERROR);
      current.add(key);
    }
  }
}
function safePath(path) {
  const absolute = resolve(path);
  let current = sep;
  for (const part of absolute.split(sep).filter(Boolean)) {
    current = join(current, part);
    if (lstatSync(current).isSymbolicLink()) throw Object.assign(new Error("UNSAFE_PATH"), { code: "UNSAFE_PATH" });
  }
  return absolute;
}
function openRegular(path) {
  const checked = safePath(path);
  if (!lstatSync(checked).isFile()) throw Object.assign(new Error("UNSAFE_PATH"), { code: "UNSAFE_PATH" });
  const fd = openSync(checked, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || !Number.isSafeInteger(stat.size)) throw Object.assign(new Error("UNSAFE_PATH"), { code: "UNSAFE_PATH" });
    return { fd, size: stat.size };
  } catch (error) { closeSync(fd); throw error; }
}
function readRegular(path) {
  const { fd } = openRegular(path);
  try { return readFileSync(fd); } finally { closeSync(fd); }
}
export function loadConfig(path) {
  try {
    const raw = readRegular(path).toString("utf8");
    const config = JSON.parse(raw); noDuplicateKeys(raw);
    return validate(config);
  } catch { throw new Error(CONFIG_ERROR); }
}
function reply(res, status, headers = {}) {
  if (res.destroyed) return;
  if (res.headersSent) { res.destroy(); return; }
  res.writeHead(status, { "content-length": "0", "cache-control": "no-store", "x-content-type-options": "nosniff", ...headers });
  res.end();
}
function rawPath(url) {
  if (typeof url !== "string" || !url.startsWith("/") || url.startsWith("//")) throw new Error("BAD_PATH");
  const pathname = url.split("?", 1)[0];
  const decoded = decodeURIComponent(pathname);
  if (decoded.includes("\0") || decoded.includes("\\") || decoded.split("/").some((part) => part === "." || part === "..")) throw new Error("BAD_PATH");
  return { pathname, decoded };
}
function staticFile(req, res, root, decoded) {
  if (req.method !== "GET" && req.method !== "HEAD") { reply(res, 405, { allow: "GET, HEAD" }); return; }
  let path = join(root, decoded === "/" ? "index.html" : decoded.slice(1)), file;
  try { file = openRegular(path); }
  catch (error) {
    if (error.code === "UNSAFE_PATH" || error.code === "ELOOP" || error.code === "EACCES") { reply(res, 403); return; }
    if (error.code !== "ENOENT" && error.code !== "ENOTDIR") { reply(res, 500); return; }
    if (decoded === "/assets" || decoded.startsWith("/assets/") || extname(decoded)
      || !req.headers.accept?.toLowerCase().includes("text/html")) { reply(res, 404); return; }
    path = join(root, "index.html");
    try { file = openRegular(path); } catch { reply(res, 404); return; }
  }
  const extension = extname(path).toLowerCase();
  res.writeHead(200, { "content-type": MIME[extension] || "application/octet-stream", "content-length": String(file.size),
    "cache-control": extension === ".html" ? "no-store" : "public,max-age=3600", "x-content-type-options": "nosniff" });
  if (req.method === "HEAD") { closeSync(file.fd); res.end(); return; }
  const stream = createReadStream(path, { fd: file.fd, autoClose: true });
  stream.on("error", () => res.destroy());
  res.on("close", () => stream.destroy()); stream.pipe(res);
}
function endToEnd(headers) {
  const forbidden = new Set(HOP);
  const connection = headers.connection;
  for (const value of Array.isArray(connection) ? connection : [connection || ""]) {
    for (const token of value.split(",")) forbidden.add(token.trim().toLowerCase());
  }
  return Object.fromEntries(Object.entries(headers).filter(([name]) => !forbidden.has(name.toLowerCase())));
}
function proxy(req, res, request, timeoutMs, timers) {
  let upstreamRequest, upstreamResponse, finished = false;
  const finish = () => { finished = true; timers.clearTimeout(timer); };
  const fail = (status) => {
    if (finished) return;
    finish(); upstreamRequest?.destroy(); upstreamResponse?.destroy(); reply(res, status);
  };
  const timer = timers.setTimeout(() => fail(504), timeoutMs); timer.unref();
  req.on("aborted", () => { finish(); upstreamRequest?.destroy(); upstreamResponse?.destroy(); });
  req.on("error", () => fail(502));
  res.on("close", () => { finish(); upstreamRequest?.destroy(); upstreamResponse?.destroy(); });
  try {
    upstreamRequest = request({ protocol: "http:", hostname: "cms-api", port: 8080, method: req.method, path: req.url,
      headers: { ...endToEnd(req.headers), host: "cms-api:8080" } }, (response) => {
      upstreamResponse = response;
      if (finished || res.destroyed) { response.destroy(); return; }
      const headers = { ...endToEnd(response.headers), "cache-control": "no-store" };
      res.writeHead(response.statusCode, headers);
      response.on("error", () => fail(502)); response.on("aborted", () => fail(502));
      response.on("end", finish); response.pipe(res);
    });
    upstreamRequest.on("error", () => fail(502)); req.pipe(upstreamRequest);
  } catch { fail(502); }
}

// Dependencies are only for isolated tests; CLI config cannot override them.
export function createIngress(input, deps = {}) {
  const config = validate(input);
  const file = (path) => resolve(deps.filesystemRoot || "/", `.${path}`);
  let cert, key;
  try { cert = readRegular(file(config.certPath)); key = readRegular(file(config.keyPath)); }
  catch { throw new Error(CONFIG_ERROR); }
  const server = https.createServer({ cert, key, minVersion: "TLSv1.2" }, (req, res) => {
    const host = req.headers.host;
    const surface = [...SURFACES, "api"].find((name) => host === `${name}.cms.test:8443`);
    if (!surface || req.socket.servername !== `${surface}.cms.test`) { reply(res, 421); return; }
    let path;
    try { path = rawPath(req.url); } catch { reply(res, 400); return; }
    if (surface === "api") {
      if (!path.pathname.startsWith("/api/v1/") && path.pathname !== "/actuator/health") { reply(res, 404); return; }
      proxy(req, res, deps.request || http.request, deps.proxyTimeoutMs ?? 15000, deps.timers || { setTimeout, clearTimeout });
    } else staticFile(req, res, file(config.dist[surface]), path.decoded);
  });
  const rejectSocket = (_req, socket) => socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
  server.on("connect", rejectSocket); server.on("upgrade", rejectSocket);
  server.on("tlsClientError", () => {});
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.length !== 2 || args[0] !== "--config" || !args[1]) throw new Error(CONFIG_ERROR);
    const server = createIngress(loadConfig(args[1]));
    server.on("error", () => { console.error("PP1_INGRESS_START_FAILED"); process.exitCode = 2; });
    server.listen(8443, "0.0.0.0");
  } catch { console.error(CONFIG_ERROR); process.exitCode = 2; }
}
