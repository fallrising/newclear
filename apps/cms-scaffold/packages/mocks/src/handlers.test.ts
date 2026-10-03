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
