import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createCmsClient } from "@cms/api";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db, MOCK_WRONG_PASSWORD, setScenario, setSurface, setUser } from "./index";
import { resetMocks, server } from "./node";

const API = "http://localhost:8080";
const client = () => createCmsClient({ baseUrl: API });
const raw = (path: string, init?: RequestInit) => fetch(`${API}${path}`, init);

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());
beforeEach(() => resetMocks());

describe("@cms/mocks fixtures", () => {
  it("E-03 src/fixtures.gen.ts matches fixtures/*.json", () => {
    const script = fileURLToPath(new URL("../scripts/gen-fixtures.mjs", import.meta.url));
    expect(() => execFileSync("node", [script, "--check"], { stdio: "pipe" })).not.toThrow();
  });

  it("E-03 fixtures mirror DemoContentSeed: 34 work entries, 15 publicly readable", () => {
    expect(db.workEntries).toHaveLength(34);
    expect(db.publicEntries).toHaveLength(15);
    expect(db.publicEntries.some((e) => e.slug === "private-studio")).toBe(false);
    expect(db.publicEntries.some((e) => e.slug === "internal-ops")).toBe(false);
  });
});

describe("@cms/mocks auth", () => {
  it("E-03 logs in any seed user with a non-empty password and returns the mock CSRF token", async () => {
    const api = client();
    const me = await api.auth.login("seed-operator-album", "anything");
    expect(me.principal.username).toBe("seed-operator-album");
    await expect(api.auth.me()).resolves.toMatchObject({ roles: [{ code: "operator" }] });
  });

  it("E-03 rejects an unknown user and the reserved wrong password with 401 INVALID_CREDENTIALS", async () => {
    await expect(client().auth.login("nobody", "x")).rejects.toMatchObject({ status: 401, code: "INVALID_CREDENTIALS" });
    await expect(client().auth.login("seed-admin", MOCK_WRONG_PASSWORD)).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
  });

  it("E-03 W0-FM01 returns 401 UNAUTHENTICATED from /auth/me when anonymous", async () => {
    await expect(client().auth.me()).rejects.toMatchObject({ status: 401, code: "UNAUTHENTICATED" });
  });

  it("E-03 W0-FM05 returns 403 CSRF_FAILED for a signed-in write without the token", async () => {
    setUser("seed-operator-album");
    const response = await raw(`/api/v1/entries/${db.workEntries[0].id}/publish`, { method: "POST" });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: "CSRF_FAILED" } });
  });
});

describe("BW1a mock contract integration", () => {
  it("projects and searches a non-title titleField after work edits", async () => {
    setUser("seed-operator-clinic");
    const clinic = db.workEntries.find((entry) => entry.contentType === "clinic_profile")!;
    await expect(client().work.entries("clinic_profile", { q: "Cedar" })).resolves.toMatchObject({ total: 1 });
    await expect(client().work.patch(clinic.id, { payload: { name: "New Clinic" }, version: clinic.version }))
      .resolves.toMatchObject({ title: "New Clinic" });
    await expect(client().work.entries("clinic_profile", { q: "new clinic" })).resolves.toMatchObject({ total: 1 });
  });

  it("uses configured public visibility and publication ordering", async () => {
    const clinic = db.publicEntries.find((entry) => entry.contentType === "clinic_profile")!;
    clinic.payload.visibility = "unlisted"; // Not its configured visibility field: still public.
    const newer = { ...structuredClone(clinic), id: "new-clinic", slug: "new-clinic", publishedAt: "2030-01-01T00:00:00Z" };
    db.publicEntries.push(newer);
    const page = await client().public.entries("clinic_profile");
    expect(page.items.map((entry) => entry.id)).toEqual([newer.id, clinic.id]);
    const album = db.publicEntries.find((entry) => entry.slug === "coast-light-2026")!;
    album.payload.visibility = "private";
    await expect(client().public.entries("album")).resolves.toMatchObject({ total: 0 });
    await expect(client().public.bySlug("album", album.slug!)).rejects.toMatchObject({ status: 404 });
  });

  it("returns surface-specific capabilities without mutating another surface", async () => {
    setUser("seed-operator-album");
    setSurface("front");
    const front = await client().auth.me();
    expect(front).toMatchObject({ capabilities: { surface: "front", global: [], types: expect.arrayContaining([
      { key: "album", actions: ["read_published"], scoped: false },
    ]) } });
    setSurface("back");
    expect(await client().auth.me()).toMatchObject({ capabilities: { surface: "back", types: expect.arrayContaining([
      { key: "album", actions: expect.arrayContaining(["create", "publish"]), scoped: false },
    ]) } });
    expect(front).toMatchObject({ capabilities: { surface: "front", global: [] } });
  });

  it("login includes capabilities and member grants remain scoped", async () => {
    setSurface("front");
    const result = await client().auth.login("seed-member-clinic", "anything");
    expect(result).toMatchObject({ csrfToken: expect.any(String), capabilities: { surface: "front", types: expect.arrayContaining([
      { key: "pet", actions: ["read_published"], scoped: true },
    ]) } });
  });

  it("excludes disabled types from the next capability response", async () => {
    setUser("seed-admin");
    setSurface("admin");
    await client().admin.disableType("visit");
    const body = await (await raw("/api/v1/auth/me")).json();
    expect(body.capabilities).toBeDefined();
    expect(body.capabilities.types.map((type: { key: string }) => type.key)).not.toContain("visit");
    await client().admin.enableType("visit");
    expect(await client().auth.me()).toMatchObject({ capabilities: { types: expect.arrayContaining([
      expect.objectContaining({ key: "visit" }),
    ]) } });
  });

  it("serves BW1a labels, enum labels and type settings", async () => {
    setUser("seed-operator-album");
    expect(await client().work.type("album")).toMatchObject({ visibilityField: "visibility", singleton: false, previewable: true,
      fields: expect.arrayContaining([
        expect.objectContaining({ key: "title", label: "標題", group: "main", order: 0 }),
        expect.objectContaining({ key: "visibility", enumLabels: { public: "公開", unlisted: "不公開列出" } }),
      ]),
    });
  });
});

describe("@cms/mocks public reads", () => {
  it("E-03 AC-03 lists published, listed albums only", async () => {
    const page = await client().public.entries("album");
    expect(page.items.map((e) => e.slug)).toEqual(["coast-light-2026"]);
  });

  it("E-03 AC-07 reads an unlisted album by slug but 404s a draft", async () => {
    await expect(client().public.bySlug("album", "unlisted-proof")).resolves.toMatchObject({ title: "Unlisted proof" });
    await expect(client().public.bySlug("album", "private-studio")).rejects.toMatchObject({ status: 404, code: "ENTRY_NOT_FOUND" });
  });

  it("E-03 AC-02 filters photos by ref.album and embeds public media objects", async () => {
    const album = await client().public.bySlug("album", "coast-light-2026");
    const page = await client().public.entries("photo", { ref: { album: album.id } });
    expect(page.items).toHaveLength(6);
    expect(page.items[0].payload.media).toMatchObject({ variants: { web: { url: expect.stringContaining("/api/v1/public/media/") } } });
  });

  it("E-03 W0-FM08 returns 403 for a type anonymous visitors cannot read and 404 for an unknown type", async () => {
    await expect(client().public.entries("issue")).rejects.toMatchObject({ status: 403, code: "FORBIDDEN" });
    await expect(client().public.entries("nope")).rejects.toMatchObject({ status: 404, code: "ENTRY_NOT_FOUND" });
  });

  it("E-03 AC-15 rejects audience parameters with 400 AUDIENCE_PARAM_REJECTED", async () => {
    const response = await raw("/api/v1/public/content-types/album/entries?state=draft");
    expect(response.status).toBe(400);
  });

  it("E-03 AC-15 serves public media bytes only for media attached to a public entry", async () => {
    const coverId = (db.publicEntries[0].payload.cover as { id: string }).id;
    expect((await raw(`/api/v1/public/media/${coverId}/file/web`)).headers.get("Content-Type")).toBe("image/png");
    const draftMedia = db.media.find((m) => m.title === "Polaroid test")!;
    expect((await raw(`/api/v1/public/media/${draftMedia.id}/file/web`)).status).toBe(404);
  });
});

describe("@cms/mocks work surface", () => {
  it("E-03 W0-FM03 requires a session (401) and a work surface (403 SURFACE_FORBIDDEN)", async () => {
    await expect(client().work.entries("album")).rejects.toMatchObject({ status: 401, code: "UNAUTHENTICATED" });
    setUser("seed-operator-album");
    setSurface("front");
    await expect(client().work.entries("album")).rejects.toMatchObject({ status: 403, code: "SURFACE_FORBIDDEN" });
  });

  it("E-03 W0-FM04 limits types to the role allowlist and filters by state", async () => {
    setUser("seed-operator-album");
    const drafts = await client().work.entries("album", { state: "draft" });
    expect(drafts.items.map((e) => e.slug)).toEqual(["private-studio"]);
    await expect(client().work.entries("vet")).rejects.toMatchObject({ status: 403, code: "FORBIDDEN" });
  });

  it("E-03 W0-FM04 lets an operator publish but not an editor", async () => {
    const studio = db.workEntries.find((e) => e.slug === "private-studio")!;
    setUser("seed-editor-album");
    await expect(client().work.publish(studio.id)).rejects.toMatchObject({ status: 403, code: "FORBIDDEN" });
    setUser("seed-operator-album");
    await expect(client().work.publish(studio.id)).resolves.toMatchObject({ publicationState: "published", version: 2 });
  });

  it("E-03 W0-FM07 PATCH merges the payload, bumps the version and rejects a stale version with 409 VERSION_CONFLICT", async () => {
    setUser("seed-operator-album");
    const coast = db.workEntries.find((e) => e.slug === "coast-light-2026")!;
    const updated = await client().work.patch(coast.id, { payload: { description: null }, version: coast.version });
    expect(updated).toMatchObject({ version: 3, dirty: true, payload: { description: null, title: "Coast Light 2026" } });
    await expect(client().work.patch(coast.id, { payload: {}, version: 2 })).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
  });

  it("E-03 W0-FM07 scenario conflict makes every PATCH return 409", async () => {
    setUser("seed-operator-album");
    setScenario("conflict");
    const coast = db.workEntries.find((e) => e.slug === "coast-light-2026")!;
    await expect(client().work.patch(coast.id, { payload: {}, version: coast.version })).rejects.toMatchObject({ status: 409 });
  });
});

describe("@cms/mocks admin and scenarios", () => {
  it("E-03 W0-FM03 requires the admin surface and role", async () => {
    setUser("seed-admin");
    await expect(client().admin.principals()).rejects.toMatchObject({ code: "SURFACE_FORBIDDEN" });
    setSurface("admin");
    await expect(client().admin.principals()).resolves.toMatchObject({ total: 9 });
    setUser("seed-operator-album");
    await expect(client().admin.types()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("E-03 disable then enable flips AdminContentType.enabled", async () => {
    setUser("seed-admin");
    setSurface("admin");
    await expect(client().admin.disableType("visit")).resolves.toMatchObject({ key: "visit", enabled: false });
    await expect(client().admin.enableType("visit")).resolves.toMatchObject({ enabled: true });
  });

  it("E-03 W0-FM09 scenario empty returns empty lists; error500 returns 500 INTERNAL_ERROR except auth", async () => {
    setScenario("empty");
    await expect(client().public.entries("album")).resolves.toMatchObject({ items: [], total: 0 });
    setScenario("error500");
    await expect(client().public.entries("album")).rejects.toMatchObject({ status: 500, code: "INTERNAL_ERROR" });
    await expect(client().auth.login("seed-admin", "x")).resolves.toBeDefined();
  });

  it("E-03 W0-FM24 unknown API routes return 404 ROUTE_NOT_FOUND", async () => {
    const response = await raw("/api/v1/nope");
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: { code: "ROUTE_NOT_FOUND" } });
  });
});

describe("BW1b mock list contract", () => {
  it("paginates and totals before slicing, and complete lists include more than 20", async () => {
    setUser("seed-operator-album");
    const base = db.workEntries.find((e) => e.contentType === "album")!;
    db.workEntries = Array.from({ length: 25 }, (_, i) => ({ ...structuredClone(base), id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`, title: `Album ${String(i).padStart(2, "0")}`, payload: { ...base.payload, title: `Album ${String(i).padStart(2, "0")}` } }));
    const first = await client().work.entries("album", { sort: "title" });
    expect(first).toMatchObject({ total: 25, page: 1, size: 20, offset: 0, limit: 20 });
    expect(first.items).toHaveLength(20);
    const second = await client().work.entries("album", { sort: "title", page: 2 });
    expect(second.items.map((e) => e.title)).toEqual(["Album 20", "Album 21", "Album 22", "Album 23", "Album 24"]);
    expect((await client().work.allEntries("album")).items).toHaveLength(25);
  });
  it("applies enum and datetime filters before totals with inclusive from and exclusive to", async () => {
    setUser("seed-operator-album");
    await expect(client().work.entries("album", { filter: { visibility: "not-an-option" } })).resolves.toMatchObject({ total: 0 });
    const metadata = db.adminTypes.find((t) => t.key === "photo")!;
    const date = metadata.fields.find((f) => f.type === "datetime")!;
    date.filterable = true; date.indexed = true;
    const photos = db.workEntries.filter((e) => e.contentType === "photo");
    photos.forEach((e, i) => { e.payload[date.key] = i === 0 ? "2026-01-01T00:00:00Z" : "2026-01-02T00:00:00Z"; });
    const result = await client().work.entries("photo", { filter: { [`${date.key}.from`]: "2026-01-01T08:00:00+08:00", [`${date.key}.to`]: "2026-01-02T00:00:00Z" } });
    expect(result.items.map((e) => e.id)).toEqual([photos[0].id]);
  });
  it("repeated refs require every value to match; defaults exclude archived", async () => {
    setUser("seed-operator-album");
    const photo = db.workEntries.find((e) => e.contentType === "photo")!;
    const album = String(photo.payload.album);
    await expect(client().work.entries("photo", { ref: { album: [album, "00000000-0000-4000-8000-000000009999"] } })).resolves.toMatchObject({ total: 0 });
    photo.publicationState = "archived";
    expect((await client().work.entries("photo")).items.some((e) => e.id === photo.id)).toBe(false);
    expect((await client().work.entries("photo", { state: "archived" })).items.some((e) => e.id === photo.id)).toBe(true);
  });
  it("rejects private public filters, sort aliases and refs before reading values", async () => {
    const type = db.adminTypes.find((t) => t.key === "album")!;
    type.fields.find((f) => f.key === "visibility")!.visibility = "back";
    type.fields.find((f) => f.key === "title")!.visibility = "back";
    for (const params of [{ filter: { visibility: "public" } }, { sort: "title" }, { ref: { missing: "00000000-0000-4000-8000-000000000001" } }]) {
      await expect(client().public.entries("album", params)).rejects.toMatchObject({ status: 400, code: "VALIDATION_FAILED" });
    }
  });
  it("rejects duplicates and invalid values even for empty results", async () => {
    setUser("seed-operator-album"); setScenario("empty");
    for (const query of ["size=101", "page=0", "q=x&q=y", "unknown=a&unknown=b", "filter.title=x", "ref.album=nope", "state=gone"]) {
      const response = await raw(`/api/v1/content-types/album/entries?${query}`);
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ error: { code: "VALIDATION_FAILED" } });
    }
  });
});
describe("BW1b numeric compatibility", () => {
  it("retains fractional numeric sorting and puts missing or wrong types last", async () => {
    const base = db.publicEntries.find((e) => e.contentType === "photo")!;
    const parents = db.publicEntries.filter((e) => e.contentType !== "photo");
    db.publicEntries = [1.5, 0.5, null, "1"].map((rank, i) => ({ ...structuredClone(base), id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`, payload: { ...base.payload, sortOrder: rank } }));
    db.publicEntries.push(...parents);
    const page = await client().public.entries("photo", { sort: "sortOrder" });
    expect(page.items.map((e) => e.payload.sortOrder)).toEqual([0.5, 1.5, null, "1"]);
  });
});
describe("BW1b parser edge compatibility", () => {
  it.each(["page=&size= ", "unknown=a"])("defaults blank paging and ignores unknown parameters: %s", async (query) => {
    setUser("seed-operator-album");
    const result = await raw(`/api/v1/content-types/album/entries?${query}`);
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({ page: 1, size: 20 });
  });
  it.each(["state=bogus", "state=draft&state=published"])("public controller rejects audience query: %s", async (query) => {
    const response = await raw(`/api/v1/public/content-types/album/entries?${query}`);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "AUDIENCE_PARAM_REJECTED" } });
  });
  it("hides malformed raw visibility and required refs to private or missing published entries", async () => {
    const album = db.publicEntries.find((e) => e.contentType === "album")!;
    for (const invalid of [[], {}, "private"]) {
      album.payload.visibility = invalid;
      await expect(client().public.entries("album")).resolves.toMatchObject({ total: 0 });
      await expect(client().public.entries("photo")).resolves.toMatchObject({ total: 0 });
    }
    album.payload.visibility = "  ";
    await expect(client().public.entries("album")).resolves.toMatchObject({ total: 1 });
  });
});
describe("BW1b public default sort safety", () => {
  it.each(["private", "disabled", "ref"])("falls back to publishedAt when configured sort field is %s", async (invalid) => {
    const type = db.adminTypes.find((t) => t.key === "photo")!;
    const field = type.fields.find((f) => f.key === "sortOrder")!;
    if (invalid === "private") field.visibility = "back";
    if (invalid === "disabled") field.enabled = false;
    if (invalid === "ref") field.type = "ref";
    const photos = db.publicEntries.filter((e) => e.contentType === "photo");
    const result = await client().public.entries("photo");
    expect(result.items.map((e) => e.id)).toEqual([...photos].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)).map((e) => e.id));
    await expect(client().public.entries("photo", { sort: "sortOrder" })).rejects.toMatchObject({ status: 400, code: "VALIDATION_FAILED" });
  });
});

describe("BW1c mock write and public boundaries", () => {
  it("requires a version after auth, existence, state and permissions; rejects without mutation", async () => {
    const entry = db.workEntries.find((e) => e.contentType === "album")!;
    const patch = (body: unknown, id = entry.id) => raw(`/api/v1/entries/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json", "X-CSRF-Token": "mock-csrf-token" }, body: JSON.stringify(body) });
    expect((await patch({ payload: {} })).status).toBe(401);
    setUser("seed-operator-album");
    // Client obtains the canonical token; raw requests deliberately bypass required-version typing.
    const token = (await (await raw("/api/v1/auth/csrf")).json()).csrfToken;
    const write = (body: unknown, id = entry.id) => raw(`/api/v1/entries/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json", "X-CSRF-Token": token }, body: JSON.stringify(body) });
    expect((await write({}, "missing")).status).toBe(404);
    const before = structuredClone(entry);
    for (const body of [{ payload: { title: "changed" } }, { version: null }]) {
      const response = await write(body);
      expect(response.status).toBe(428);
      expect(await response.json()).toMatchObject({ error: { code: "VERSION_REQUIRED" } });
    }
    expect(entry).toEqual(before);
    setUser("seed-operator-clinic");
    expect((await write({})).status).toBe(403);
    setUser("seed-operator-album"); setSurface("front");
    expect((await write({})).status).toBe(403);
  });
  it("collects errors in reserved then metadata order and leaves failed writes unchanged", async () => {
    setUser("seed-operator-album");
    const entry = db.workEntries.find((e) => e.contentType === "album")!;
    const before = structuredClone(entry);
    await expect(client().work.patch(entry.id, { version: entry.version, payload: { slug: "reserved", title: "x".repeat(1001), cover: "bad", visibility: "secret", sortMode: 5 } }))
      .rejects.toMatchObject({ status: 422, code: "FIELD_VALIDATION", fields: [
        { field: "payload.slug", code: "RESERVED_KEY" }, { field: "payload.title", code: "TOO_LONG" },
        { field: "payload.cover", code: "INVALID_UUID" }, { field: "payload.visibility", code: "NOT_IN_ENUM" },
        { field: "payload.sortMode", code: "WRONG_TYPE" },
      ] });
    expect(entry).toEqual(before);
  });
  it("allows null clearing but reports required fields at publish", async () => {
    setUser("seed-operator-album");
    const created = await client().work.create("album", { payload: { title: "Draft" } });
    const cleared = await client().work.patch(created.id, { version: created.version, payload: { title: null } });
    expect(cleared.payload).toHaveProperty("title", null);
    await expect(client().work.publish(created.id)).rejects.toMatchObject({ status: 422, fields: [{ field: "payload.title", code: "REQUIRED" }] });
  });
  it("returns null for unresolved media through list, id and slug without changing stored payload", async () => {
    const entry = db.publicEntries.find((e) => e.contentType === "album" && e.slug === "coast-light-2026")!;
    const missing = "00000000-0000-4000-8000-000000009999";
    for (const value of [missing, { mediaId: missing }, { nope: "bad" }, null]) {
      entry.payload.cover = value;
      expect((await client().public.entries("album")).items[0].payload).toHaveProperty("cover", null);
      expect((await client().public.byId("album", entry.id)).payload).toHaveProperty("cover", null);
      expect((await client().public.bySlug("album", entry.slug!)).payload).toHaveProperty("cover", null);
      expect(entry.payload.cover).toEqual(value);
    }
  });
});

describe("BW1c mock validation compatibility", () => {
  it("reads legacy fractional ints but rejects merged writes without mutation", async () => {
    setUser("seed-operator-album");
    const photo = db.workEntries.find((e) => e.contentType === "photo")!;
    photo.payload.sortOrder = 0.5;
    const before = structuredClone(photo);
    expect((await client().work.entry(photo.id)).payload.sortOrder).toBe(0.5);
    await expect(client().work.patch(photo.id, { version: photo.version, payload: { caption: "new" } }))
      .rejects.toMatchObject({ status: 422, fields: [{ field: "payload.sortOrder", code: "WRONG_TYPE" }] });
    expect(photo).toEqual(before);
    await expect(client().work.patch(photo.id, { version: photo.version, payload: { sortOrder: 1 } })).resolves.toMatchObject({ payload: { sortOrder: 1 } });
  });
  it("keeps the first reference error top-level code and validates canonical references", async () => {
    setUser("seed-operator-album");
    await expect(client().work.create("photo", { payload: { album: "00000000-0000-4000-8000-000000009999", takenAt: "yesterday" } }))
      .rejects.toMatchObject({ code: "REF_TARGET_NOT_FOUND", fields: [{ code: "REF_TARGET_NOT_FOUND" }, { code: "INVALID_DATETIME" }] });
    const album = db.workEntries.find((entry) => entry.contentType === "album")!;
    const upper = "AAAAAAAA-0000-4000-8000-000000000001";
    db.workEntries.push({ ...structuredClone(album), id: upper.toLowerCase() });
    await expect(client().work.create("photo", { payload: { album: upper } }))
      .rejects.toMatchObject({ fields: [{ field: "payload.album", code: "INVALID_UUID" }] });
    await expect(client().work.create("photo", { payload: { album: db.workEntries.find((entry) => entry.contentType === "photo")!.id } }))
      .rejects.toMatchObject({ code: "REF_TARGET_WRONG_TYPE" });
  });
  it("checks disabled private fields and reports a reserved metadata key only once", async () => {
    setUser("seed-operator-album");
    const type = db.adminTypes.find((entry) => entry.key === "album")!;
    const title = type.fields.find((field) => field.key === "title")!;
    title.enabled = false; title.visibility = "internal";
    type.fields.push({ ...title, key: "slug", order: -1 });
    await expect(client().work.create("album", { payload: { slug: 5, title: false } }))
      .rejects.toMatchObject({ fields: [{ field: "payload.slug", code: "RESERVED_KEY" }, { field: "payload.title", code: "WRONG_TYPE" }] });
  });
  it("counts code points, permits empty/unknown values, and rejects oversized markdown", async () => {
    setUser("seed-operator-album");
    await expect(client().work.create("album", { payload: { title: "😀".repeat(1000), unknown: { custom: true }, visibility: " " } })).resolves.toMatchObject({ version: 1 });
    await expect(client().work.create("album", { payload: { title: "😀".repeat(1001), description: "x".repeat(100001) } }))
      .rejects.toMatchObject({ fields: [{ code: "TOO_LONG" }, { code: "TOO_LONG" }] });
  });
  it("checks archived state before version and keeps clean publish a no-op", async () => {
    setUser("seed-operator-album");
    const entry = db.workEntries.find((e) => e.contentType === "album" && !e.dirty && e.publicationState === "published")!;
    const before = structuredClone(entry);
    await expect(client().work.publish(entry.id)).resolves.toEqual(before);
    entry.publicationState = "archived";
    const response = await raw(`/api/v1/entries/${entry.id}`, { method: "PATCH", headers: { "Content-Type": "application/json", "X-CSRF-Token": (await (await raw("/api/v1/auth/csrf")).json()).csrfToken }, body: "{}" });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: "INVALID_STATE_TRANSITION" } });
  });
  it("resolves a published raw media UUID while keeping work edits isolated", async () => {
    const entry = db.publicEntries.find((e) => e.contentType === "album" && e.slug === "coast-light-2026")!;
    const id = (entry.payload.cover as { mediaId: string }).mediaId;
    entry.payload.cover = id;
    expect((await client().public.byId("album", entry.id)).payload.cover).toMatchObject({ mediaId: id });
    const work = db.workEntries.find((e) => e.id === entry.id)!;
    work.payload.cover = db.media.find((e) => e.title === "Polaroid test")!.id;
    expect((await client().public.byId("album", entry.id)).payload.cover).toMatchObject({ mediaId: id });
    expect((await raw(`/api/v1/public/media/${work.payload.cover}/file/web`)).status).toBe(404);
  });
});

describe("BW1c preserved parser and projection rules", () => {
  it("accepts minute precision and rejects normalized invalid calendar dates", async () => {
    setUser("seed-operator-album");
    await expect(client().work.create("photo", { payload: { takenAt: "2026-01-01T00:00Z" } })).resolves.toMatchObject({ version: 1 });
    await expect(client().work.create("photo", { payload: { takenAt: "2026-02-30T00:00:00Z" } }))
      .rejects.toMatchObject({ fields: [{ field: "payload.takenAt", code: "INVALID_DATETIME" }] });
    await expect(client().work.create("album", { payload: { cover: "1-1-1-1-1" } })).resolves.toMatchObject({ version: 1 });
  });
  it("checks required reserved metadata once when absent and omits disabled/private public fields", async () => {
    setUser("seed-operator-album");
    const type = db.adminTypes.find((e) => e.key === "album")!;
    const title = type.fields.find((f) => f.key === "title")!;
    type.fields.push({ ...title, key: "slug", order: 100 });
    const created = await client().work.create("album", { payload: { title: "test" } });
    await expect(client().work.publish(created.id)).rejects.toMatchObject({ fields: [{ field: "payload.slug", code: "REQUIRED" }] });
    const entry = db.publicEntries.find((e) => e.contentType === "album" && e.slug === "coast-light-2026")!;
    const cover = type.fields.find((f) => f.key === "cover")!;
    const id = (entry.payload.cover as { mediaId: string }).mediaId;
    cover.enabled = false; title.visibility = "back";
    const projected = await client().public.byId("album", entry.id);
    expect(projected.payload).not.toHaveProperty("cover");
    expect(projected.payload).not.toHaveProperty("title");
    // Other enabled photo fields can attach this same media; isolate this published snapshot.
    db.publicEntries = [entry];
    expect((await raw(`/api/v1/public/media/${id}/file/web`)).status).toBe(404);
  });
});
