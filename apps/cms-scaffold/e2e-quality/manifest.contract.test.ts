import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pages, states } from "./pages.ts";
import { urlFor } from "./helpers.ts";

test("explicit manifest contains exact 52 pages, 15 mobile, 8 states and 70 unique visual names", () => {
  assert.equal(pages.length, 52); assert.equal(new Set(pages.map(c => c.id)).size, 52);
  assert.equal(pages.filter(c => c.desktop).length, 52); assert.equal(pages.filter(c => c.mobile).length, 15);
  assert.equal(states.length, 8); assert.equal(states.filter(s => s.visual).length, 3);
  const snapshots = [...pages.map(p => `${p.id}-desktop-1280x800`), ...pages.filter(p => p.mobile).map(p => `${p.id}-mobile-390x844`), ...states.filter(s => s.visual).map(s => `${s.id}-${s.prepare === "frontMobileMenu" ? "mobile-390x844" : "desktop-1280x800"}`)];
  assert.equal(snapshots.length, 70); assert.equal(new Set(snapshots).size, 70);
  for (const state of states) assert(pages.some(p => p.id === state.pageId));
  for (const ready of [...pages.map(p => p.ready), ...states.map(s => s.ready)]) {
    for (const value of Object.values(ready)) if (typeof value === "string") assert(!value.includes("`"), `Ready locator contains Markdown delimiter: ${value}`);
  }
  assert.equal(pages.find(p => p.id === "front-login")!.ready.kind, "role");
  assert.deepEqual(pages.find(p => p.id === "front-login")!.ready, { kind: "role", role: "heading", level: 1, name: "會員登入" });
  assert.deepEqual(pages.find(p => p.id === "front-member-home")!.ready, { kind: "testId", value: "member-home" });
});
test("all52 ready names, IDs and route attributes equal blueprint table semantics", () => {
  const lines = readFileSync("docs/v2/waves/W5.md", "utf8").split("\n").filter(line => /^\| `(front|back|admin)-[^`]+` \| (front|back|admin) \|/.test(line));
  assert.equal(lines.length, 52);
  const expected = lines.map(line => {
    const [id, surface, path, user, rawReady, desktop, mobile] = line.slice(1, -1).split("|").map(cell => cell.trim().replace(/^`|`$/g, ""));
    const ready = rawReady.startsWith("T:") ? { kind: "testId", value: rawReady.slice(2).replace(/^`|`$/g, "") } : { kind: "role", role: "heading", level: 1, ...(rawReady.startsWith("H:") ? { name: rawReady.slice(2).replace(/^`|`$/g, "") } : {}) };
    return { id, surface, path, mockUser: user === "null" ? null : user, ready, desktop: desktop === "true", mobile: mobile === "true" };
  });
  assert.deepEqual(pages, expected);
});
test("URL helper preserves scenario/project queries and adds only specified mock identity", () => {
  for (const c of pages) {
    const actual = new URL(urlFor(c)); const source = new URL(c.path, actual.origin);
    assert.equal(actual.port, { front: "5173", back: "5174", admin: "5175" }[c.surface]);
    assert.equal(actual.pathname, source.pathname);
    for (const [key, value] of source.searchParams) assert.equal(actual.searchParams.get(key), value);
    assert.equal(actual.searchParams.get("mockUser"), c.mockUser);
  }
});
test("actual Playwright CLI rejects explicit unauthorized visual update with exit 2 before browsers", () => {
  const env = { ...process.env }; delete env.CMS_UPDATE_VISUAL_BASELINES;
  const result = spawnSync("npx", ["playwright", "test", "--config", "playwright.quality.config.ts", "visual-w5.spec.ts", "--list", "--update-snapshots"], { env, encoding: "utf8" });
  assert.equal(result.status, 2, result.stdout + result.stderr);
  assert.match(result.stdout + result.stderr, /requires CMS_UPDATE_VISUAL_BASELINES=1/);
});
