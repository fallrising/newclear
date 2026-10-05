import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const root = fileURLToPath(new URL("..", import.meta.url));
const apps = [
  { name: "front", root: join(root, "apps/web-front"), limit: 92160 },
  { name: "back", root: join(root, "apps/web-back"), limit: 163840 },
  { name: "admin", root: join(root, "apps/web-admin"), limit: 163840 },
];

class BuildError extends Error {}

export function staticClosure(manifest) {
  const roots = Object.keys(manifest).filter((key) => manifest[key].isEntry === true);
  if (!roots.length) throw new Error("Manifest has no entry roots");
  const visited = new Set();
  const files = new Set();
  function visit(key) {
    if (!Object.hasOwn(manifest, key)) throw new Error(`Missing manifest import key: ${key}`);
    if (visited.has(key)) return;
    visited.add(key);
    files.add(manifest[key].file);
    for (const imported of manifest[key].imports ?? []) visit(imported);
  }
  for (const key of roots) visit(key);
  return [...files].sort();
}

export function gzipFile(path) {
  return gzipSync(readFileSync(path), { level: 9 }).length;
}

function newestSource(dir) {
  return Math.max(0, ...readdirSync(dir).map((name) => {
    const path = join(dir, name);
    const stat = statSync(path);
    return stat.isDirectory() ? newestSource(path) : stat.mtimeMs;
  }));
}

function readManifest(app) {
  const path = join(app.root, "dist/.vite/manifest.json");
  if (!existsSync(path)) throw new BuildError(`${app.name}: missing build manifest; run npm run build`);
  if (statSync(path).mtimeMs <= newestSource(join(app.root, "src"))) {
    throw new BuildError(`${app.name}: stale build manifest; source is newer; run npm run build`);
  }
  return JSON.parse(readFileSync(path, "utf8"));
}

export function measureApp(app) {
  const manifest = readManifest(app);
  const roots = Object.keys(manifest).filter((key) => manifest[key].isEntry === true).sort();
  const closure = staticClosure(manifest);
  const keys = new Set();
  function visit(key) {
    if (keys.has(key)) return;
    keys.add(key);
    for (const imported of manifest[key].imports ?? []) visit(imported);
  }
  for (const key of roots) visit(key);
  const files = closure.map((file) => ({ file, gzipBytes: gzipFile(join(app.root, "dist", file)) }));
  const total = files.reduce((sum, file) => sum + file.gzipBytes, 0);
  return { app: app.name, roots, closureKeys: [...keys].sort(), files, total, limit: app.limit, delta: total - app.limit, notes: "" };
}

export function measureAll() {
  // Preflight every app before measuring any asset, so a stale app cannot produce an old result.
  for (const app of apps) readManifest(app);
  const measuredAt = new Date().toISOString();
  const date = measuredAt.slice(0, 10).replaceAll("-", "");
  const recordsPath = join(root, "docs/v2/frontend-records.md");
  const records = existsSync(recordsPath) ? readFileSync(recordsPath, "utf8").split("## Bundle")[1]?.split("## Web Vitals")[0] ?? "" : "";
  const prior = [...records.matchAll(/W5-BUNDLE-\d{8}-(\d+)/g)].map((match) => Number(match[1]));
  const start = Math.max(0, ...prior) + 1;
  const results = apps.map((app, index) => ({
    recordId: `W5-BUNDLE-${date}-${String(start + index).padStart(2, "0")}`,
    ...measureApp(app),
  }));
  return {
    schemaVersion: 1, measuredAt,
    gitCommit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
    dirty: execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }).trim().length > 0,
    node: process.version, chromium: null, command: "measure:bundle", artifact: "bundle.json",
    result: results.every((app) => app.delta <= 0) ? "passed" : "failed", apps: results,
  };
}

export async function main() {
  try {
    const result = measureAll();
    const dir = join(root, "test-results/frontend");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, result.artifact), `${JSON.stringify(result, null, 2)}\n`);
    for (const app of result.apps) {
      console.log(`| ${app.recordId} | ${result.measuredAt} | ${result.gitCommit} | ${result.dirty ? "yes" : "no"} | ${app.app} | ${app.total} | ${app.limit} | ${app.delta} | measure:bundle | ${result.artifact} | ${app.delta <= 0 ? "passed" : "failed"} | ${app.notes} |`);
    }
    process.exitCode = result.result === "passed" ? 0 : 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = error instanceof BuildError ? 2 : 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
