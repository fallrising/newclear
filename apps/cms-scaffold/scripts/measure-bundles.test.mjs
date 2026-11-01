import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { test } from "node:test";
import { gzipFile, measureApp, staticClosure } from "./measure-bundles.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const chunk = (file, extra = {}) => ({ file, ...extra });

for (const [name, manifest, expected] of [
  ["single entry", { main: chunk("main.js", { isEntry: true }) }, ["main.js"]],
  ["follows transitive static imports", { main: chunk("main.js", { isEntry: true, imports: ["shared"] }), shared: chunk("shared.js", { imports: ["vendor"] }), vendor: chunk("vendor.js") }, ["main.js", "shared.js", "vendor.js"]],
  ["deduplicates shared imports", { a: chunk("a.js", { isEntry: true, imports: ["shared"] }), b: chunk("b.js", { isEntry: true, imports: ["alias"] }), shared: chunk("shared.js"), alias: chunk("shared.js") }, ["a.js", "b.js", "shared.js"]],
  ["handles cycles", { main: chunk("main.js", { isEntry: true, imports: ["shared"] }), shared: chunk("shared.js", { imports: ["main"] }) }, ["main.js", "shared.js"]],
  ["excludes dynamicImports", { main: chunk("main.js", { isEntry: true, dynamicImports: ["absent"], css: ["style.css"] }) }, ["main.js"]],
  ["includes manual chunks", { main: chunk("main.js", { isEntry: true, imports: ["_vendor.js"] }), "_vendor.js": chunk("vendor.js") }, ["main.js", "vendor.js"]],
]) {
  test(`W5 bundle ${name}`, () => assert.deepEqual(staticClosure(manifest), expected));
}

test("W5 bundle rejects missing import key and missing entry", () => {
  assert.throws(() => staticClosure({ main: chunk("main.js", { isEntry: true, imports: ["absent"] }) }), /absent/);
  assert.throws(() => staticClosure({ main: chunk("main.js") }), /entry/i);
});

function fixture(t) {
  mkdirSync(join(root, "test-results/frontend"), { recursive: true });
  const dir = mkdtempSync(join(root, "test-results/frontend/bundle-fixture-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, "scripts"));
  copyFileSync(join(root, "scripts/measure-bundles.mjs"), join(dir, "scripts/measure-bundles.mjs"));
  return dir;
}

// A deterministic incompressible fixture makes the boundary an actual gzip byte count.
function exactGzip(target) {
  const bytes = Buffer.alloc(target + 128);
  let seed = 0x12345678;
  for (let i = 0; i < bytes.length; i++) {
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
    bytes[i] = seed & 255;
  }
  for (let size = target - 128; size <= target + 128; size++) {
    const input = bytes.subarray(0, size);
    if (gzipSync(input, { level: 9 }).length === target) return input;
  }
  throw new Error(`Unable to construct exact ${target}-byte gzip fixture`);
}

function buildApp(dir, name, input = "console.log('fixture');") {
  const app = join(dir, "apps", `web-${name}`);
  mkdirSync(join(app, "src"), { recursive: true });
  mkdirSync(join(app, "dist/.vite"), { recursive: true });
  writeFileSync(join(app, "src/main.ts"), "fixture");
  const sourceTime = new Date(Date.now() - 10000);
  utimesSync(join(app, "src/main.ts"), sourceTime, sourceTime);
  writeFileSync(join(app, "dist/main.js"), input);
  writeFileSync(join(app, "dist/.vite/manifest.json"), JSON.stringify({ "src/main.ts": chunk("main.js", { isEntry: true }) }));
  return app;
}

function run(dir) {
  return spawnSync(process.execPath, [join(dir, "scripts/measure-bundles.mjs")], { cwd: dir, encoding: "utf8" });
}

test("W5 bundle accepts exact limits", (t) => {
  const dir = fixture(t);
  for (const [name, limit] of [["front", 92160], ["back", 163840], ["admin", 163840]]) {
    const app = buildApp(dir, name, exactGzip(limit));
    assert.equal(gzipFile(join(app, "dist/main.js")), limit);
    const result = measureApp({ name, root: app, limit });
    assert.equal(result.total, limit);
    assert.equal(result.delta, 0);
  }
  const result = run(dir);
  assert.equal(result.status, 0, result.stderr);
  const json = JSON.parse(readFileSync(join(dir, "test-results/frontend/bundle.json"), "utf8"));
  assert.equal(json.result, "passed");
  assert.equal(json.apps.length, 3);
  assert.equal(result.stdout.trim().split("\n").length, 3);
});

test("W5 bundle rejects one byte over and still writes complete JSON", (t) => {
  const dir = fixture(t);
  buildApp(dir, "front", exactGzip(92161));
  buildApp(dir, "back");
  buildApp(dir, "admin");
  const result = run(dir);
  assert.equal(result.status, 1, result.stderr);
  const json = JSON.parse(readFileSync(join(dir, "test-results/frontend/bundle.json"), "utf8"));
  assert.equal(json.result, "failed");
  assert.equal(json.apps[0].total, 92161);
  assert.equal(json.apps[0].delta, 1);
  assert.equal(json.apps.length, 3);
});

test("W5 bundle rejects missing or stale build with exit 2", (t) => {
  const dir = fixture(t);
  assert.equal(run(dir).status, 2);
  for (const name of ["front", "back", "admin"]) buildApp(dir, name);
  const app = join(dir, "apps/web-admin");
  mkdirSync(join(app, "src/nested"));
  writeFileSync(join(app, "src/nested/new.ts"), "new source");
  const future = new Date(Date.now() + 10000);
  utimesSync(join(app, "src/nested/new.ts"), future, future);
  const result = run(dir);
  assert.equal(result.status, 2, result.stderr);
  assert.match(result.stderr, /stale|newer/i);
});
