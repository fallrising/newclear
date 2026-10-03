// `npm run test:bundle`: scans the production builds (run `npm run build` first).
// 01 §10.4, surface-front AC-08, S-02, and "mocks never ship" (waves/W0.md §5.8).
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

const EVERY_APP = [
  { what: "seed account name (S-02)", pattern: /seed-(admin|editor|operator|member)/ },
  { what: "MSW worker (mocks must not ship)", pattern: /setupWorker|mockServiceWorker|mock-csrf-token/ },
];

const FRONT_ONLY = [
  { what: "work API path (AC-08)", pattern: /\/api\/v1\/(entries|content-types|preview|principals|roles|admin|media\/)/ },
  { what: "draft-only field (AC-08, 01 §10.4)", pattern: /publicationState|previewToken|includeDraft|includeUnpublished|revisionId|read_draft/ },
];

const APPS = [
  { name: "web-front", rules: [...EVERY_APP, ...FRONT_ONLY] },
  { name: "web-back", rules: EVERY_APP },
  { name: "web-admin", rules: EVERY_APP },
];

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

const failures = [];
for (const app of APPS) {
  const dist = join(root, "apps", app.name, "dist");
  if (!existsSync(dist)) {
    failures.push(`${app.name}: dist/ missing — run \`npm run build\` first`);
    continue;
  }
  const all = files(dist);
  if (all.some((f) => f.endsWith("mockServiceWorker.js"))) failures.push(`${app.name}: dist contains mockServiceWorker.js`);
  for (const file of all.filter((f) => /\.(js|html|css)$/.test(f))) {
    const text = readFileSync(file, "utf8");
    for (const rule of app.rules) {
      const match = text.match(rule.pattern);
      if (match) failures.push(`${app.name}: ${file.slice(dist.length + 1)} contains "${match[0]}" — ${rule.what}`);
    }
  }
}

if (failures.length) {
  console.error(`test:bundle failed:\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log("test:bundle passed: web-front, web-back, web-admin");
