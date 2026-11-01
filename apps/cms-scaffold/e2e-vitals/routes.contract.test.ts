import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { BrowserContext, Route } from "@playwright/test";
import { installVitalsRoutes, type VitalsTargetId } from "./routes.ts";

const fixture = (file: string) => JSON.parse(readFileSync(`docs/v2/contracts/fixtures/${file}`, "utf8"));
const operations: Record<VitalsTargetId, string[]> = {
  "front-album": ["/public/content-types/page/slugs/home", "/public/content-types/album/entries?size=6"],
  "front-clinic": ["/public/content-types/clinic_profile/entries?size=1", "/public/content-types/vet/entries?sort=title&size=6", "/auth/me"],
  "front-projects": ["/public/content-types/project/entries?size=12"],
  "back-home": ["/auth/me", "/content-types", "/content-types/album/entries?size=1&publishRequested=true", "/content-types/photo/entries?publishRequested=true&size=1"],
  "admin-home": ["/auth/me", "/admin/content-types", "/principals", "/media/quota", "/admin/audit?size=10"],
};
async function harness(target: VitalsTargetId) {
  let handler!: (route: Route) => Promise<void>;
  const context = { route: async (pattern: string, callback: typeof handler) => { assert.equal(pattern, "**/api/v1/**"); handler = callback; } } as unknown as BrowserContext;
  const log = await installVitalsRoutes(context, target);
  const request = async (path: string, method = "GET") => {
    let response: { status?: number; contentType?: string; body?: string | Buffer; headers?: Record<string, string> } | null = null;
    let aborted: string | null = null;
    await handler({ request: () => ({ method: () => method, url: () => `http://fixture/api/v1${path}` }), fulfill: async (r: typeof response) => { response = r; }, abort: async (reason: string) => { aborted = reason; } } as unknown as Route);
    return { response: response!, aborted };
  };
  return { log, request };
}
for (const target of Object.keys(operations) as VitalsTargetId[]) {
  test(`${target}: exact operations, fixture transformation and rendered-media completeness`, async () => {
    const { log, request } = await harness(target);
    assert.throws(() => log.assertComplete(), /missing=/);
    for (const path of operations[target]) {
      const result = await request(path);
      assert.equal(result.aborted, null);
      assert.equal(result.response.contentType, "application/json");
      const body = JSON.parse(result.response.body as string);
      if (target === "front-album" && path.includes("slugs")) { assert.equal(result.response.status, 404); assert.equal(body.error.code, "ENTRY_NOT_FOUND"); }
      if (target === "front-clinic" && path === "/auth/me") { assert.equal(result.response.status, 401); assert.equal(body.error.code, "UNAUTHENTICATED"); }
      if (path.includes("/entries?")) {
        const type = path.split("/").at(-2)!;
        const source = fixture(target.startsWith("front-") ? "public-entries.json" : "work-entries.json");
        const expected = source.filter((e: { contentType: string; publishRequestedAt: string | null }) => e.contentType === type && (target !== "back-home" || e.publishRequestedAt !== null));
        if (type === "vet") expected.sort((a: { title: string }, b: { title: string }) => a.title.localeCompare(b.title, "en"));
        assert.deepEqual(body.items, expected);
        assert.equal(body.total, expected.length);
        assert.equal(body.offset, 0);
        for (const entry of expected) for (const value of Object.values(entry.payload) as { variants?: Record<string, { url: string }> }[]) {
          if (!value?.variants) continue;
          const rendered = value.variants.thumbnail ?? value.variants.web;
          if (rendered) {
            const png = await request(rendered.url.replace("/api/v1", ""));
            assert.equal(png.response.contentType, "image/png");
            assert.equal(png.response.headers?.["cache-control"], "no-store");
            const bytes = png.response.body as Buffer;
            assert.deepEqual(bytes.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
            assert.equal(bytes.readUInt32BE(16), 64); assert.equal(bytes.readUInt32BE(20), 64);
          }
        }
      }
      if (target === "admin-home" && path.includes("/audit?")) { assert.deepEqual(body.items, fixture("audit-events.json").slice(0, 10)); assert.equal(body.total, fixture("audit-events.json").length); }
      if (path === "/auth/me" && target === "back-home") assert.deepEqual(body, { ...fixture("me.json")["seed-operator-album"], capabilities: fixture("capabilities.json")["seed-operator-album"].back });
      if (path === "/auth/me" && target === "admin-home") assert.deepEqual(body, { ...fixture("me.json")["seed-admin"], capabilities: fixture("capabilities.json")["seed-admin"].admin });
    }
    log.assertComplete();
    await request(operations[target][0]); log.assertComplete();
  });
  for (const [label, path, method] of [["mutation", operations[target][0], "POST"], ["extra query", `${operations[target][0]}${operations[target][0].includes("?") ? "&" : "?"}extra=1`, "GET"], ["unknown path", "/unlisted", "GET"], ["unlisted media", "/public/media/ffffffff-ffff-4fff-8fff-ffffffffffff/file/thumbnail", "GET"]]) {
    test(`${target}: ${label} is logged and aborted`, async () => {
      const { log, request } = await harness(target);
      assert.equal((await request(path, method)).aborted, "blockedbyclient");
      assert.equal(log.hits.length, 1);
      assert.throws(() => log.assertComplete(), /unexpected=\["/);
    });
  }
}
