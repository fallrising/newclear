import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { BrowserContext } from "@playwright/test";

export type VitalsTargetId = "front-album" | "front-clinic" | "front-projects" | "back-home" | "admin-home";
export interface VitalsRouteLog { readonly hits: readonly string[]; assertComplete(): void }
const MEDIA_PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAY0lEQVR42u3QQREAAAgDoDVfdM3hyYMCpO18FgECBAgQIECAAAECBAgQIECAAAECBAgQIECAAAECBAgQIECAAAECBAgQIECAAAECBAgQIECAAAECBAgQIECAAAECBAgQIECAAAECBAgQIOC+BRZ5wkoAHKE2AAAAAElFTkSuQmCC";
type Entry = { contentType: string; title: string | null; publishRequestedAt?: string | null; payload: Record<string, unknown> };
type Operation = { path: string; query?: Record<string, string>; status?: number; body: unknown };
const fixture = <T>(file: string): T => JSON.parse(readFileSync(resolve(process.cwd(), `docs/v2/contracts/fixtures/${file}`), "utf8")) as T;
const pageOf = (items: unknown[], size: number) => ({ items, total: items.length, page: 1, size, offset: 0, limit: size });
const error = (code: string, message: string, requestId: string) => ({ error: { code, message }, requestId });
const keyFor = (method: string, url: URL) => `${method} ${url.pathname}${url.searchParams.size ? `?${[...url.searchParams].sort(([a, av], [b, bv]) => a.localeCompare(b) || av.localeCompare(bv)).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&")}` : ""}`;

export async function installVitalsRoutes(context: BrowserContext, target: VitalsTargetId): Promise<VitalsRouteLog> {
  const publicEntries = fixture<Entry[]>("public-entries.json");
  const listed = (type: string, size: number, sort = false) => pageOf(publicEntries.filter(e => e.contentType === type).sort(sort ? (a, b) => (a.title ?? "").localeCompare(b.title ?? "", "en") : () => 0), size);
  const typesPath = "/api/v1/public/content-types";
  let operations: Operation[];
  switch (target) {
    case "front-album": operations = [
      { path: `${typesPath}/page/slugs/home`, status: 404, body: error("ENTRY_NOT_FOUND", "Entry not found", "vitals-front-album") },
      { path: `${typesPath}/album/entries`, query: { size: "6" }, body: listed("album", 6) },
    ]; break;
    case "front-clinic": operations = [
      { path: `${typesPath}/clinic_profile/entries`, query: { size: "1" }, body: listed("clinic_profile", 1) },
      { path: `${typesPath}/vet/entries`, query: { size: "6", sort: "title" }, body: listed("vet", 6, true) },
      { path: "/api/v1/auth/me", status: 401, body: error("UNAUTHENTICATED", "Authentication required", "vitals-front-clinic-auth") },
    ]; break;
    case "front-projects": operations = [{ path: `${typesPath}/project/entries`, query: { size: "12" }, body: listed("project", 12) }]; break;
    case "back-home": {
      const me = fixture<Record<string, object>>("me.json")["seed-operator-album"];
      const capabilities = fixture<Record<string, { back: unknown }>>("capabilities.json")["seed-operator-album"].back;
      const entries = fixture<Entry[]>("work-entries.json");
      operations = [
        { path: "/api/v1/auth/me", body: { ...me, capabilities } },
        { path: "/api/v1/content-types", body: fixture("work-content-types.json") },
        ...["album", "photo"].map(type => ({ path: `/api/v1/content-types/${type}/entries`, query: { publishRequested: "true", size: "1" }, body: pageOf(entries.filter(e => e.contentType === type && e.publishRequestedAt !== null), 1) })),
      ]; break;
    }
    case "admin-home": {
      const me = fixture<Record<string, object>>("me.json")["seed-admin"];
      const capabilities = fixture<Record<string, { admin: unknown }>>("capabilities.json")["seed-admin"].admin;
      const audit = fixture<unknown[]>("audit-events.json");
      operations = [
        { path: "/api/v1/auth/me", body: { ...me, capabilities } },
        { path: "/api/v1/admin/content-types", body: fixture("admin-content-types.json") },
        { path: "/api/v1/principals", body: fixture("principals.json") },
        { path: "/api/v1/media/quota", body: fixture("media-quota.json") },
        { path: "/api/v1/admin/audit", query: { size: "10" }, body: { ...pageOf(audit.slice(0, 10), 10), total: audit.length } },
      ]; break;
    }
  }
  const allowedMedia = new Set<string>();
  const requiredMedia = new Set<string>();
  // Homes render card thumbnails (cards.tsx); the other advertised variants remain allowed, never required.
  const collectMedia = (value: unknown): void => {
    if (!value || typeof value !== "object") return;
    if ("variants" in value && value.variants && typeof value.variants === "object") {
      const variants = value.variants as Record<string, { url?: string }>;
      for (const variant of Object.values(variants)) if (typeof variant?.url === "string") {
        const url = new URL(variant.url, "http://fixture");
        if (url.search || !/^\/api\/v1\/public\/media\/[0-9a-f-]{36}\/file\/[^/]+$/.test(url.pathname)) throw new Error(`Invalid fixture media URL ${variant.url}`);
        allowedMedia.add(keyFor("GET", url));
      }
      const rendered = variants.thumbnail ?? variants.web;
      if (rendered?.url) requiredMedia.add(keyFor("GET", new URL(rendered.url, "http://fixture")));
    }
    for (const child of Object.values(value)) collectMedia(child);
  };
  if (target.startsWith("front-")) for (const operation of operations) collectMedia(operation.body);
  const allowed = new Map(operations.map(operation => {
    const url = new URL(operation.path, "http://fixture");
    for (const [key, value] of Object.entries(operation.query ?? {})) url.searchParams.set(key, value);
    return [keyFor("GET", url), operation] as const;
  }));
  const required = new Set([...allowed.keys(), ...requiredMedia]);
  const hits: string[] = [];
  const unexpected: string[] = [];
  await context.route("**/api/v1/**", async route => {
    const request = route.request();
    const key = keyFor(request.method(), new URL(request.url()));
    hits.push(key);
    if (allowedMedia.has(key)) {
      await route.fulfill({ status: 200, contentType: "image/png", headers: { "cache-control": "no-store" }, body: Buffer.from(MEDIA_PNG_BASE64, "base64") });
    } else {
      const operation = allowed.get(key);
      if (!operation) { unexpected.push(key); await route.abort("blockedbyclient"); return; }
      await route.fulfill({ status: operation.status ?? 200, contentType: "application/json", body: JSON.stringify(operation.body) });
    }
  });
  return { hits, assertComplete() {
    const missing = [...required].filter(key => !hits.includes(key));
    if (missing.length || unexpected.length) throw new Error(`Vitals ${target} route contract: missing=${JSON.stringify(missing)} unexpected=${JSON.stringify(unexpected)}`);
  } };
}
