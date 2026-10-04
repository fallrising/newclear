import { createCmsClient } from "@cms/api";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db, fixtures, MOCK_CSRF_TOKEN, setScenario, setSurface, setUser } from "./index";
import { resetMocks, server } from "./node";
import { mediaId } from "./validation";

const api = () => createCmsClient({ baseUrl: "http://localhost:8080" });
const entry = (slug: string) => db.workEntries.find((item) => item.slug === slug)!;
const raw = (path: string, init?: RequestInit) => fetch(`http://localhost:8080${path}`, init);

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());
beforeEach(() => { resetMocks(); setUser("seed-operator-album"); });

describe("W2 preserves BW2 safeguards", () => {
  it("request and cancellation increment CAS once; repeated operations preserve all metadata", async () => {
    const id = entry("private-studio").id;
    const before = structuredClone(entry("private-studio"));
    const asked = await api().work.requestPublish(id);
    expect(asked.version).toBe(before.version + 1);
    expect(asked.updatedAt).not.toBe(before.updatedAt);
    expect(await api().work.requestPublish(id)).toEqual(asked);
    const cancelled = await api().work.cancelPublishRequest(id);
    expect(cancelled).toMatchObject({ version: asked.version + 1, publishRequestedAt: null, publishRequestedBy: null });
    expect(await api().work.cancelPublishRequest(id)).toEqual(cancelled);
  });

  it("false means unfiltered; invalid and repeated parameters fail even for empty data", async () => {
    const all = await api().work.entries("album");
    await api().work.requestPublish(entry("private-studio").id);
    expect((await api().work.entries("album", { publishRequested: false })).total).toBe(all.total);
    expect((await api().work.entries("album", { publishRequested: true })).total).toBe(1);
    setScenario("empty");
    for (const query of ["publishRequested=wrong", "publishRequested=true&publishRequested=false", "include=refs&include=refs", "include=refs,owner"]) {
      expect((await raw(`/api/v1/content-types/album/entries?${query}`)).status).toBe(400);
    }
    expect((await raw(`/api/v1/entries/${entry("private-studio").id}?include=refs&include=refs`)).status).toBe(400);
  });

  it("equal snapshot payload clears dirty, preserves the request, and clean publish only clears it", async () => {
    setUser("mock-operator-notes");
    const spring = entry("spring-ideas");
    const asked = await api().work.requestPublish(spring.id);
    const snapshot = structuredClone(db.revisions[spring.id][0]);
    const reversed = Object.fromEntries(Object.entries(snapshot.payload).reverse());
    const patched = await api().work.patch(spring.id, { version: asked.version, payload: reversed });
    expect(patched).toMatchObject({ dirty: false, publishRequestedAt: asked.publishRequestedAt });
    const published = await api().work.publish(spring.id);
    expect(published).toMatchObject({ version: patched.version + 1, publishRequestedAt: null, dirty: false, publishedAt: spring.publishedAt });
    expect(db.revisions[spring.id]).toEqual([snapshot]);
    expect(await api().work.publish(spring.id)).toEqual(published);
  });

  it("batch rejects invalid envelopes, later missing targets, and archived targets without any writes", async () => {
    const a = entry("coast-harbour"), b = entry("coast-sun");
    const before = structuredClone(db.workEntries);
    await expect(api().work.batchPatch(Array.from({ length: 101 }, () => ({ id: a.id, version: a.version })))).rejects.toMatchObject({ status: 400 });
    await expect(api().work.batchPatch([{ version: a.version } as never])).rejects.toMatchObject({ status: 400, message: "items[0].id is required" });
    await expect(api().work.batchPatch([{ id: a.id, version: a.version, payload: { sortOrder: 99 } }, { id: "30000000-0000-4000-8000-00000000ffff", version: 1 }])).rejects.toMatchObject({ status: 404, message: "items[1]: Entry not found" });
    expect(db.workEntries).toEqual(before);
    b.publicationState = "archived";
    await expect(api().work.batchPatch([{ id: a.id, version: a.version, payload: { sortOrder: 99 } }, { id: b.id } as never])).rejects.toMatchObject({ status: 409, code: "INVALID_STATE_TRANSITION" });
    expect(a).toEqual(before.find((item) => item.id === a.id));
  });

  it("batch validates merged legacy values and retains deterministic scenario conflicts", async () => {
    const a = entry("coast-harbour"), b = entry("coast-sun");
    b.payload.sortOrder = 1.5;
    const before = structuredClone(db.workEntries);
    await expect(api().work.batchPatch([{ id: a.id, version: a.version, payload: { caption: "Changed" } }, { id: b.id, version: b.version, payload: { caption: "Changed" } }])).rejects.toMatchObject({ status: 422, fields: [{ field: "items[1].payload.sortOrder", code: "WRONG_TYPE" }] });
    expect(db.workEntries).toEqual(before);
    setScenario("conflict");
    await expect(api().work.batchPatch([{ id: a.id, version: a.version }])).rejects.toMatchObject({ status: 409, message: "items[0]: Version conflict" });
    expect(db.workEntries).toEqual(before);
  });

  it("batch ignores extra slug properties and only writes payload", async () => {
    const photo = entry("coast-harbour");
    const before = structuredClone(photo);
    const response = await raw("/api/v1/entries:batch-patch", {
      method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": MOCK_CSRF_TOKEN },
      body: JSON.stringify({ items: [{ id: photo.id, version: photo.version, slug: "must-not-write", payload: { caption: "Only payload" } }] }),
    });
    expect(response.status).toBe(200);
    expect((await response.json()).items[0]).toMatchObject({ slug: before.slug, version: before.version + 1, payload: { caption: "Only payload" } });
  });

  it("refs skip disabled fields and never reveal a disabled target's title", async () => {
    const photo = entry("coast-harbour");
    const album = db.adminTypes.find((type) => type.key === "album")!;
    album.enabled = false;
    const restricted = await raw(`/api/v1/entries/${photo.id}?include=refs`);
    expect((await restricted.json()).refs).toEqual({ album: { id: photo.payload.album, restricted: true } });
    db.adminTypes.find((type) => type.key === "photo")!.fields.find((field) => field.key === "album")!.enabled = false;
    const omitted = await raw(`/api/v1/entries/${photo.id}?include=,refs,,`);
    expect((await omitted.json()).refs).toEqual({});
  });

  it("publishes immutable snapshots newest first and retains the latest twenty", async () => {
    setUser("mock-operator-notes");
    const note = entry("lens-notes");
    const first = structuredClone(db.revisions[note.id][0]);
    for (let i = 0; i < 21; i++) {
      await api().work.patch(note.id, { version: note.version, payload: { body: `Publish ${i}` } });
      await api().work.publish(note.id);
    }
    const rows = (await api().work.revisions(note.id)).items;
    expect(rows.map((row) => row.revisionNo)).toEqual(Array.from({ length: 20 }, (_, i) => 22 - i));
    expect(rows.every((row) => !("payload" in row))).toBe(true);
    expect(first.payload.body).not.toBe("Publish 20");
    const publicBefore = structuredClone(db.publicEntries.find((item) => item.id === note.id));
    await api().work.patch(note.id, { version: note.version, payload: { body: "Unpublished" } });
    const asked = await api().work.requestPublish(note.id);
    const reverted = await api().work.revert(note.id, 21);
    expect(reverted).toMatchObject({ dirty: true, publishRequestedAt: asked.publishRequestedAt, payload: { body: "Publish 19" } });
    expect(db.publicEntries.find((item) => item.id === note.id)).toEqual(publicBefore);
    await expect(api().work.revert(note.id, 1)).rejects.toMatchObject({ status: 404 });
  });

  it("media deletion keeps quota charged and removes public projections and bytes", async () => {
    const quota = await api().work.mediaQuota();
    expect(quota).toEqual(fixtures.mediaQuota);
    const album = db.publicEntries.find((item) => item.slug === "coast-light-2026")!;
    const id = mediaId(album.payload.cover)!;
    expect((await raw(`/api/v1/public/media/${id}/file/web`)).status).toBe(200);
    await api().work.removeMedia(id);
    expect(await api().work.mediaQuota()).toEqual(quota);
    expect((await raw(`/api/v1/media/${id}/file/web`)).status).toBe(410);
    expect((await raw(`/api/v1/public/media/${id}/file/web`)).status).toBe(404);
    expect((await api().public.bySlug("album", album.slug!)).payload.cover).toBeNull();
  });

  it("media validates missing and empty files, PDF variants and capacity without partial uploads", async () => {
    const missing = await raw("/api/v1/media", { method: "POST", headers: { "X-CSRF-Token": MOCK_CSRF_TOKEN }, body: new FormData() });
    expect(missing.status).toBe(400);
    await expect(api().work.upload(new File([], "empty.png", { type: "image/png" }))).rejects.toMatchObject({ status: 415 });
    const pdf = await api().work.upload(new File(["%PDF"], "notes.pdf", { type: "application/pdf" }));
    expect(pdf).toMatchObject({ width: null, height: null });
    expect(Object.keys(pdf.variants)).toEqual(["original"]);
    const before = structuredClone(db.media);
    const limit = fixtures.mediaQuota.maxFiles;
    fixtures.mediaQuota.maxFiles = db.media.length;
    try {
      await expect(api().work.upload(new File(["png"], "full.png", { type: "image/png" }))).rejects.toMatchObject({ status: 409, code: "MEDIA_QUOTA_EXCEEDED" });
      expect(db.media).toEqual(before);
    } finally { fixtures.mediaQuota.maxFiles = limit; }
  });

  it("media reads, quota, upload and deletion all require manage_media", async () => {
    const global = fixtures.capabilities["seed-operator-album"].back.global;
    const saved = [...global];
    global.splice(0);
    try {
      await expect(api().work.mediaList()).rejects.toMatchObject({ status: 403 });
      await expect(api().work.mediaQuota()).rejects.toMatchObject({ status: 403 });
      await expect(api().work.media(db.media[0].id)).rejects.toMatchObject({ status: 403 });
      await expect(api().work.removeMedia(db.media[0].id)).rejects.toMatchObject({ status: 403 });
      await expect(api().work.upload(new File(["png"], "dock.png", { type: "image/png" }))).rejects.toMatchObject({ status: 403 });
    } finally { global.push(...saved); }
  });
});


describe("T704 private media bytes authorization", () => {
  const file = (id: string) => `/api/v1/media/${id}/file/web`;
  const noteType = () => db.adminTypes.find((type) => type.key === "note")!;
  const attachmentField = () => noteType().fields.find((field) => field.key === "attachment")!;

  async function withoutMediaManagement(run: () => Promise<void>) {
    setUser("mock-operator-notes");
    const global = fixtures.capabilities["mock-operator-notes"].back.global;
    const saved = [...global];
    global.splice(0);
    try { await run(); } finally { global.push(...saved); }
  }

  // Ensure the tested asset has no unrelated work or publish attachment that could grant access.
  function isolate(id: string) {
    const payloads = [
      ...db.workEntries.map((item) => item.payload),
      ...db.publicEntries.map((item) => item.payload),
      ...Object.values(db.revisions).flat().map((row) => row.payload),
    ];
    for (const payload of payloads) for (const [key, value] of Object.entries(payload)) {
      if (mediaId(value) === id) payload[key] = null;
    }
  }

  it("denies an unrelated signed-in user but allows manage_media without an attachment", async () => {
    const id = db.media[0].id;
    isolate(id);
    await withoutMediaManagement(async () => {
      const denied = await raw(file(id));
      expect(denied.status).toBe(403);
      expect(await denied.json()).toMatchObject({ error: { code: "FORBIDDEN" } });
    });
    expect((await raw(file(id))).status).toBe(200);
  });

  it.each(["string", "object"])("allows read_draft through an enabled %s media-ref attachment", async (form) => {
    const id = db.media[0].id;
    isolate(id);
    entry("buy-film").payload.attachment = form === "string" ? id : { mediaId: id, title: "Projected attachment" };
    await withoutMediaManagement(async () => { expect((await raw(file(id))).status).toBe(200); });
  });

  it.each(["missing attachment", "disabled type", "non-media field", "missing field", "missing entry"])("denies access from a %s", async (reason) => {
    const id = db.media[0].id;
    isolate(id);
    const note = entry("buy-film");
    note.payload.attachment = id;
    if (reason === "missing attachment") note.payload.attachment = null;
    if (reason === "disabled type") db.adminTypes.filter((type) => type.key === "note").forEach((type) => { type.enabled = false; });
    if (reason === "non-media field") attachmentField().type = "string";
    if (reason === "missing field") noteType().fields = noteType().fields.filter((field) => field.key !== "attachment");
    if (reason === "missing entry") db.workEntries = db.workEntries.filter((item) => item.id !== note.id);
    await withoutMediaManagement(async () => { expect((await raw(file(id))).status).toBe(403); });
  });

  it("retains private read_draft access when an attached media-ref field is disabled", async () => {
    const id = db.media[0].id;
    isolate(id);
    entry("buy-film").payload.attachment = { mediaId: id };
    attachmentField().enabled = false;
    await withoutMediaManagement(async () => { expect((await raw(file(id))).status).toBe(200); });
  });

  it.each(["draft", "archived"] as const)("does not grant access from a historical revision of a %s entry", async (state) => {
    const id = db.media[0].id;
    isolate(id);
    const note = entry("lens-notes");
    db.revisions[note.id][0].payload.attachment = id;
    note.publicationState = state;
    note.payload.attachment = null;
    await withoutMediaManagement(async () => { expect((await raw(file(id))).status).toBe(403); });
  });

  it("read_published alone cannot read private attachment bytes", async () => {
    const id = db.media[0].id;
    isolate(id);
    entry("coast-light-2026").payload.cover = id;
    await withoutMediaManagement(async () => { expect((await raw(file(id))).status).toBe(403); });
  });

  it("preserves the last published attachment while the saved work copy changes media", async () => {
    const id = db.media[0].id;
    isolate(id);
    const note = entry("lens-notes");
    db.revisions[note.id][0].payload.attachment = { mediaId: id };
    setUser("mock-operator-notes");
    await api().work.patch(note.id, { version: note.version, payload: { attachment: db.media[1].id } });
    await withoutMediaManagement(async () => { expect((await raw(file(id))).status).toBe(200); });
  });

  it("preserves authentication/surface errors and missing/deleted media error precedence", async () => {
    const id = db.media[0].id;
    isolate(id);
    setUser(null);
    expect((await raw(file(id))).status).toBe(401);
    setUser("seed-operator-album");
    setSurface("front");
    const front = await raw(file(id));
    expect(front.status).toBe(403);
    expect(await front.json()).toMatchObject({ error: { code: "SURFACE_FORBIDDEN" } });
    setSurface("back");
    expect((await raw(file("20000000-0000-4000-8000-00000000ffff"))).status).toBe(404);
    db.deletedMedia.push(id);
    expect((await raw(file(id))).status).toBe(410);
    await withoutMediaManagement(async () => {
      expect((await raw(file(id))).status).toBe(403);
      expect((await raw(file("20000000-0000-4000-8000-00000000ffff"))).status).toBe(404);
      entry("buy-film").payload.attachment = id;
      expect((await raw(file(id))).status).toBe(410);
    });
  });
});
