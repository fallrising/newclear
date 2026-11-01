import { http, HttpResponse } from "msw";
import type { BatchPatchRequest, CmsAction, EntryWriteRequest, FieldError, RefSummary, MediaAsset, WorkContentType, WorkContentTypeList, WorkEntry, WorkEntryPage } from "@cms/api";
import { db } from "../db";
import { mediaQuota, workContentTypes } from "../fixtures.gen";
import { can, canGlobal, currentUser, requireWork } from "../guards";
import { apiError, png } from "../respond";
import { getState } from "../state";
import { mediaId, validatePayload } from "../validation";
import { listPage, parseInclude } from "./list";

function findType(key: string): WorkContentType | undefined {
  return workContentTypes.items.find((t) => t.key === key);
}

function workTitle(type: WorkContentType | undefined, payload: Record<string, unknown>) {
  const value = type?.titleField ? payload[type.titleField] : null;
  return value == null ? null : String(value);
}

function forbidden(action: string, type: string) {
  return apiError(403, "FORBIDDEN", `Missing permission ${action} on content type ${type}`);
}

/** Loads an entry the signed-in user may work on, or returns the error response. */
function loadEntry(id: string, action: CmsAction): WorkEntry | Response {
  const user = requireWork();
  if (user instanceof Response) return user;
  const entry = db.workEntries.find((e) => e.id === id);
  if (!entry) return apiError(404, "ENTRY_NOT_FOUND", "Entry not found");
  if (!can(user, action, entry.contentType)
      && !(action === "read_draft" && entry.publicationState === "published" && can(user, "read_published", entry.contentType))) {
    return forbidden(action, entry.contentType);
  }
  return entry;
}

function save(entry: WorkEntry, changes: Partial<WorkEntry>): WorkEntry {
  Object.assign(entry, changes, { version: entry.version + 1, updatedAt: new Date().toISOString() });
  return entry;
}

const NO_REQUEST = { publishRequestedAt: null, publishRequestedBy: null };

function requireMedia() {
  const user = requireWork();
  if (user instanceof Response) return user;
  return canGlobal(user, "manage_media") ? user : forbidden("manage_media", "media");
}

// JSON object key ordering does not change content equality.
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

function dirty(entry: WorkEntry, payload: WorkEntry["payload"]): boolean {
  return entry.publicationState === "published" && canonical(payload) !== canonical(db.revisions[entry.id]?.[0]?.payload ?? entry.payload);
}

function withRefs(entry: WorkEntry): WorkEntry {
  const refs: Record<string, RefSummary> = {};
  const user = currentUser()!;
  for (const field of db.adminTypes.find((type) => type.key === entry.contentType)?.fields ?? []) {
    const id = entry.payload[field.key];
    if (!field.enabled || field.type !== "ref" || typeof id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) continue;
    const target = db.workEntries.find((item) => item.id === id);
    refs[field.key] = !target ? { id, missing: true } : !can(user, "read_draft", target.contentType) ? { id, restricted: true } :
      { id, contentType: target.contentType, title: target.title, publicationState: target.publicationState };
  }
  return { ...entry, refs };
}

function patchBlocker(entry: WorkEntry, body: EntryWriteRequest): Response | null {
  if (entry.publicationState === "archived") return apiError(409, "INVALID_STATE_TRANSITION", "Archived entries are read-only");
  if (body.version == null) return apiError(428, "VERSION_REQUIRED", "PATCH requires the entry version");
  if (getState().scenario === "conflict" || body.version !== entry.version) return apiError(409, "VERSION_CONFLICT", "Version conflict");
  if (body.slug?.trim() && db.workEntries.some((other) => other.id !== entry.id && other.contentType === entry.contentType && other.slug === body.slug)) return apiError(409, "SLUG_CONFLICT", "Slug already used in this type");
  return null;
}

function applyPatch(entry: WorkEntry, body: EntryWriteRequest): WorkEntry {
  const payload = { ...entry.payload, ...(body.payload ?? {}) };
  return save(entry, { slug: body.slug ?? entry.slug, payload, title: workTitle(findType(entry.contentType), payload), dirty: dirty(entry, payload) });
}

async function itemFailure(response: Response, index: number): Promise<Response> {
  const body = await response.json();
  return apiError(response.status, body.error.code, `items[${index}]: ${body.error.message}`, body.error.fields);
}

function transition(action: "publish" | "unpublish" | "archive" | "restore") {
  return http.post(`*/api/v1/entries/:id/${action}`, ({ params }) => {
    const entry = loadEntry(String(params.id), action === "restore" ? "archive" : action);
    if (entry instanceof Response) return entry;
    const from = entry.publicationState;
    if (action === "publish" && from !== "archived") {
      if (from === "published" && !entry.dirty) {
        if (entry.publishRequestedAt !== null) save(entry, NO_REQUEST);
        return HttpResponse.json<WorkEntry>(entry);
      }
      const type = findType(entry.contentType);
      if (type?.slugPolicy === "required" && !entry.slug?.trim()) return apiError(422, "SLUG_REQUIRED", "Slug is required to publish");
      const validation = validatePayload(entry.contentType, entry.payload, true);
      if (validation) return validation;
      const publishedAt = new Date().toISOString();
      save(entry, { publicationState: "published", dirty: false, publishedAt, ...NO_REQUEST });
      const rows = db.revisions[entry.id] ?? [];
      db.revisions[entry.id] = [{ revisionNo: Math.max(0, ...rows.map((row) => row.revisionNo)) + 1, slug: entry.slug ?? "", publishedAt, payload: structuredClone(entry.payload) }, ...rows].slice(0, 20);
      db.publicEntries = db.publicEntries.filter((snapshot) => snapshot.id !== entry.id);
      db.publicEntries.push({ id: entry.id, contentType: entry.contentType, slug: entry.slug, title: entry.title,
        payload: structuredClone(entry.payload), publishedAt });
      return HttpResponse.json<WorkEntry>(entry);
    }
    if (action === "unpublish" && from === "published") {
      db.publicEntries = db.publicEntries.filter((snapshot) => snapshot.id !== entry.id);
      return HttpResponse.json<WorkEntry>(save(entry, { publicationState: "draft", dirty: false, publishedAt: null, ...NO_REQUEST }));
    }
    if (action === "archive" && from !== "archived") {
      db.publicEntries = db.publicEntries.filter((snapshot) => snapshot.id !== entry.id);
      return HttpResponse.json<WorkEntry>(save(entry, { publicationState: "archived", dirty: false, ...NO_REQUEST }));
    }
    if (action === "restore" && from === "archived") {
      return HttpResponse.json<WorkEntry>(save(entry, { publicationState: "draft", dirty: false, publishedAt: null, ...NO_REQUEST }));
    }
    return apiError(409, "INVALID_STATE_TRANSITION", `Cannot ${action} from ${from}`);
  });
}

export const workHandlers = [
  http.get("*/api/v1/content-types", () => {
    const user = requireWork();
    return user instanceof Response ? user : HttpResponse.json<WorkContentTypeList>(workContentTypes);
  }),

  http.get("*/api/v1/content-types/:type", ({ params }) => {
    const user = requireWork();
    if (user instanceof Response) return user;
    const type = findType(String(params.type));
    return type ? HttpResponse.json<WorkContentType>(type) : apiError(404, "CONTENT_TYPE_NOT_FOUND", "Content type not found");
  }),

  http.get("*/api/v1/content-types/:type/entries", ({ request, params }) => {
    const user = requireWork();
    if (user instanceof Response) return user;
    const type = String(params.type);
    if (!findType(type)) return apiError(404, "CONTENT_TYPE_NOT_FOUND", "Content type not found");
    const url = new URL(request.url);
    const states = url.searchParams.getAll("state").flatMap((value) => value.split(",")).map((value) => value.trim()).filter(Boolean);
    const action = states.length > 0 && states.every((state) => state === "published") ? "read_published" : "read_draft";
    if (!can(user, action, type)) return forbidden(action, type);
    const items = getState().scenario === "empty" ? [] : db.workEntries.filter((e) => e.contentType === type);
    const metadata = db.adminTypes.find((t) => t.key === type)!;
    const result = listPage(url, metadata, items, false);
    return result instanceof Response ? result : HttpResponse.json<WorkEntryPage>({ ...result, items: parseInclude(url.searchParams) === true ? result.items.map(withRefs) : result.items });
  }),

  http.post("*/api/v1/content-types/:type/entries", async ({ request, params }) => {
    const user = requireWork();
    if (user instanceof Response) return user;
    const type = findType(String(params.type));
    if (!type) return apiError(404, "CONTENT_TYPE_NOT_FOUND", "Content type not found");
    if (!can(user, "create", type.key)) return forbidden("create", type.key);
    const body = ((await request.json().catch(() => null)) ?? {}) as EntryWriteRequest;
    if (type.singleton && db.workEntries.some((entry) => entry.contentType === type.key)) {
      return apiError(409, "SINGLETON_EXISTS", "Singleton entry already exists");
    }
    if (body.slug?.trim() && db.workEntries.some((entry) => entry.contentType === type.key && entry.slug === body.slug)) {
      return apiError(409, "SLUG_CONFLICT", "Slug already used in this type");
    }
    const payload = body.payload ?? {};
    const validation = validatePayload(type.key, payload);
    if (validation) return validation;
    const now = new Date().toISOString();
    const entry: WorkEntry = {
      id: crypto.randomUUID(),
      contentType: type.key,
      slug: body.slug || null,
      publicationState: "draft",
      version: 1,
      title: workTitle(type, payload),
      payload,
      dirty: false,
      publishedAt: null,
      publishRequestedAt: null,
      publishRequestedBy: null,
      updatedAt: now,
    };
    db.workEntries.push(entry);
    return HttpResponse.json<WorkEntry>(entry, { status: 201 });
  }),

  http.get("*/api/v1/entries/:id", ({ request, params }) => {
    const entry = loadEntry(String(params.id), "read_draft");
    if (entry instanceof Response) return entry;
    const include = parseInclude(new URL(request.url).searchParams);
    return typeof include === "string" ? apiError(400, "VALIDATION_FAILED", include) : HttpResponse.json<WorkEntry>(include ? withRefs(entry) : entry);
  }),

  http.get("*/api/v1/preview/entries/:id", ({ params }) => {
    const entry = loadEntry(String(params.id), "read_draft");
    return entry instanceof Response ? entry : HttpResponse.json<WorkEntry>(entry);
  }),

  http.patch("*/api/v1/entries/:id", async ({ request, params }) => {
    const entry = loadEntry(String(params.id), "update");
    if (entry instanceof Response) return entry;
    const body = ((await request.json().catch(() => null)) ?? {}) as EntryWriteRequest;
    const blocker = patchBlocker(entry, body);
    if (blocker) return blocker;
    const validation = validatePayload(entry.contentType, { ...entry.payload, ...(body.payload ?? {}) });
    return validation ?? HttpResponse.json<WorkEntry>(applyPatch(entry, body));
  }),

  http.post("*/api/v1/entries:batch-patch", async ({ request }) => {
    const user = requireWork();
    if (user instanceof Response) return user;
    const body = await request.json().catch(() => null) as Partial<BatchPatchRequest> | null;
    const items = Array.isArray(body?.items) ? body.items : [];
    if (items.length < 1 || items.length > 100) return apiError(400, "VALIDATION_FAILED", "items must contain 1 to 100 entries");
    const seen = new Set<string>();
    for (const [i, item] of items.entries()) {
      if (!item?.id) return apiError(400, "VALIDATION_FAILED", `items[${i}].id is required`);
      if (seen.has(item.id)) return apiError(400, "VALIDATION_FAILED", `items[${i}].id is repeated`);
      seen.add(item.id);
    }
    const targets: WorkEntry[] = [];
    const errors: FieldError[] = [];
    let errorCode = "FIELD_VALIDATION" as Parameters<typeof apiError>[1];
    for (const [i, item] of items.entries()) {
      const entry = loadEntry(item.id, "update");
      if (entry instanceof Response) return itemFailure(entry, i);
      const blocker = patchBlocker(entry, { version: item.version, payload: item.payload });
      if (blocker) return itemFailure(blocker, i);
      const validation = validatePayload(entry.contentType, { ...entry.payload, ...(item.payload ?? {}) });
      if (validation) {
        const body = await validation.json();
        if (!errors.length) errorCode = body.error.code;
        errors.push(...body.error.fields.map((error: FieldError) => ({ ...error, field: `items[${i}].${error.field}` })));
      }
      targets.push(entry);
    }
    if (errors.length) return apiError(422, errorCode, `${errors.length} invalid field(s); first: ${errors[0].message}`, errors);
    return HttpResponse.json({ items: targets.map((entry, i) => applyPatch(entry, { version: items[i].version, payload: items[i].payload })) });
  }),

  http.post("*/api/v1/entries/:id/publish-request", ({ params }) => {
    const entry = loadEntry(String(params.id), "update");
    if (entry instanceof Response) return entry;
    if (entry.publicationState === "archived" || entry.publicationState === "published" && !entry.dirty) return apiError(409, "INVALID_STATE_TRANSITION", `Cannot request publishing from ${entry.publicationState}`);
    if (entry.publishRequestedAt === null) save(entry, { publishRequestedAt: new Date().toISOString(), publishRequestedBy: currentUser()!.principal.id });
    return HttpResponse.json<WorkEntry>(entry);
  }),

  http.delete("*/api/v1/entries/:id/publish-request", ({ params }) => {
    const entry = loadEntry(String(params.id), "update");
    if (entry instanceof Response) return entry;
    if (entry.publishRequestedAt !== null) save(entry, NO_REQUEST);
    return HttpResponse.json<WorkEntry>(entry);
  }),

  http.get("*/api/v1/entries/:id/revisions", ({ params }) => {
    const entry = loadEntry(String(params.id), "read_draft");
    if (entry instanceof Response) return entry;
    return HttpResponse.json({ items: (db.revisions[entry.id] ?? []).map(({ revisionNo, slug, publishedAt }) => ({ revisionNo, slug, publishedAt })) });
  }),

  http.post("*/api/v1/entries/:id/revisions/:revisionNo/revert", ({ params }) => {
    const entry = loadEntry(String(params.id), "update");
    if (entry instanceof Response) return entry;
    const revision = (db.revisions[entry.id] ?? []).find((row) => row.revisionNo === Number(params.revisionNo));
    if (!revision) return apiError(404, "ENTRY_NOT_FOUND", "Revision not found");
    const payload = structuredClone(revision.payload);
    const validation = validatePayload(entry.contentType, payload);
    return validation ?? HttpResponse.json<WorkEntry>(save(entry, { payload, title: workTitle(findType(entry.contentType), payload), dirty: dirty(entry, payload) }));
  }),

  transition("publish"),
  transition("unpublish"),
  transition("archive"),
  transition("restore"),

  http.delete("*/api/v1/entries/:id", ({ params }) => {
    const entry = loadEntry(String(params.id), "delete");
    if (entry instanceof Response) return entry;
    const referenced = db.workEntries.some((other) =>
      (db.adminTypes.find((type) => type.key === other.contentType)?.fields ?? []).some((field) =>
        field.type === "ref" && other.payload[field.key] === entry.id));
    if (referenced) return apiError(409, "REF_CONSTRAINT", "Entry has incoming references");
    db.workEntries = db.workEntries.filter((other) => other.id !== entry.id);
    db.publicEntries = db.publicEntries.filter((snapshot) => snapshot.id !== entry.id);
    return new HttpResponse(null, { status: 204 });
  }),

  http.get("*/api/v1/media", () => {
    const user = requireMedia();
    if (user instanceof Response) return user;
    return HttpResponse.json({ items: getState().scenario === "empty" ? [] : db.media.filter((asset) => !db.deletedMedia.includes(asset.id)) });
  }),

  http.delete("*/api/v1/media/:id", ({ params }) => {
    const user = requireMedia();
    if (user instanceof Response) return user;
    const asset = db.media.find((media) => media.id === params.id);
    if (!asset) return apiError(404, "MEDIA_NOT_FOUND", "Media not found");
    if (!db.deletedMedia.includes(asset.id)) db.deletedMedia.push(asset.id);
    return new HttpResponse(null, { status: 204 });
  }),

  http.get("*/api/v1/media/:id", ({ params }) => {
    const user = requireWork();
    if (user instanceof Response) return user;
    if (!canGlobal(user, "manage_media")) return forbidden("manage_media", "media");
    const asset = db.media.find((media) => media.id === params.id);
    return asset ? HttpResponse.json<MediaAsset>(asset) : apiError(404, "MEDIA_NOT_FOUND", "Media not found");
  }),

  http.post("*/api/v1/media", async ({ request }) => {
    const user = requireMedia();
    if (user instanceof Response) return user;
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return apiError(400, "VALIDATION_FAILED", "file part is required");
    if (file.size === 0 || !/^(image\/(jpeg|png|gif)|application\/pdf)$/.test(file.type)) return apiError(415, "MEDIA_UNSUPPORTED_TYPE", "Unsupported media type");
    if (file.size > mediaQuota.maxFileBytes) return apiError(413, "MEDIA_FILE_TOO_LARGE", "File is larger than the configured maximum");
    const stored = db.media;
    if (stored.length + 1 > mediaQuota.maxFiles || stored.reduce((sum, asset) => sum + Object.values(asset.variants).reduce((bytes, variant) => bytes + (variant?.byteSize ?? 0), 0), 0) + file.size * (file.type.startsWith("image/") ? 3 : 1) > mediaQuota.maxLibraryBytes) return apiError(409, "MEDIA_QUOTA_EXCEEDED", "Quota exceeded");
    const id = crypto.randomUUID();
    const title = String(form.get("title") || file.name);
    const image = file.type.startsWith("image/");
    const variant = (name: string) => ({
      url: `/api/v1/media/${id}/file/${name}`,
      width: image ? 64 : null,
      height: image ? 64 : null,
      contentType: name === "original" ? file.type || "image/png" : "image/jpeg",
      byteSize: file.size,
    });
    const asset: MediaAsset = {
      id,
      mediaId: id,
      title,
      altText: title,
      contentType: file.type || "image/png",
      byteSize: file.size,
      width: image ? 64 : null,
      height: image ? 64 : null,
      variants: image ? { original: variant("original"), thumbnail: variant("thumbnail"), web: variant("web") } : { original: variant("original") },
    };
    db.media.unshift(asset);
    return HttpResponse.json<MediaAsset>(asset, { status: 201 });
  }),

  http.get("*/api/v1/media/:id/file/:variant", ({ params }) => {
    const user = requireWork();
    if (user instanceof Response) return user;
    const id = String(params.id);
    if (!db.media.some((asset) => asset.id === id)) return apiError(404, "MEDIA_NOT_FOUND", "Media not found");
    const readable = canGlobal(user, "manage_media") || db.workEntries.some((entry) => {
      if (!can(user, "read_draft", entry.contentType)) return false;
      // The backend retains the current published attachment while work edits change media.
      const published = entry.publicationState === "published"
        ? db.revisions[entry.id]?.[0]?.payload ?? db.publicEntries.find((snapshot) => snapshot.id === entry.id)?.payload
        : undefined;
      return (db.adminTypes.find((type) => type.key === entry.contentType)?.fields ?? []).some((field) =>
        // Existing private attachments survive field disable; public projection has separate rules.
        field.type === "media-ref" && (mediaId(entry.payload[field.key]) === id || mediaId(published?.[field.key]) === id));
    });
    if (!readable) return forbidden("manage_media", "media");
    return db.deletedMedia.includes(id) ? apiError(410, "MEDIA_GONE", "Media was deleted") : png();
  }),
];
