import { http, HttpResponse } from "msw";
import type { EntryWriteRequest, MediaAsset, WorkContentType, WorkContentTypeList, WorkEntry, WorkEntryPage } from "@cms/api";
import { db } from "../db";
import { workContentTypes } from "../fixtures.gen";
import { allowedType, canPublish, requireWork } from "../guards";
import { apiError, png } from "../respond";
import { getState } from "../state";
import { validatePayload } from "../validation";
import { listPage } from "./list";

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
function loadEntry(id: string, action: string): WorkEntry | Response {
  const user = requireWork();
  if (user instanceof Response) return user;
  const entry = db.workEntries.find((e) => e.id === id);
  if (!entry) return apiError(404, "ENTRY_NOT_FOUND", "Entry not found");
  if (!allowedType(user, entry.contentType)) return forbidden(action, entry.contentType);
  if (["publish", "unpublish", "archive"].includes(action) && !canPublish(user)) return forbidden(action, entry.contentType);
  return entry;
}

function save(entry: WorkEntry, changes: Partial<WorkEntry>): WorkEntry {
  Object.assign(entry, changes, { version: entry.version + 1, updatedAt: new Date().toISOString() });
  return entry;
}

function transition(action: "publish" | "unpublish" | "archive") {
  return http.post(`*/api/v1/entries/:id/${action}`, ({ params }) => {
    const entry = loadEntry(String(params.id), action);
    if (entry instanceof Response) return entry;
    const from = entry.publicationState;
    if (action === "publish" && from !== "archived") {
      if (from === "published" && !entry.dirty) return HttpResponse.json<WorkEntry>(entry);
      const validation = validatePayload(entry.contentType, entry.payload, true);
      if (validation) return validation;
      return HttpResponse.json<WorkEntry>(
        save(entry, { publicationState: "published", dirty: false, publishedAt: new Date().toISOString() }),
      );
    }
    if (action === "unpublish" && from === "published") {
      return HttpResponse.json<WorkEntry>(save(entry, { publicationState: "draft", dirty: false }));
    }
    if (action === "archive" && from !== "archived") {
      return HttpResponse.json<WorkEntry>(save(entry, { publicationState: "archived", dirty: false }));
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
    if (!allowedType(user, type)) return forbidden("read_draft", type);
    const url = new URL(request.url);
    const items = getState().scenario === "empty" ? [] : db.workEntries.filter((e) => e.contentType === type);
    const metadata = db.adminTypes.find((t) => t.key === type)!;
    const result = listPage(url, metadata, items, false);
    return result instanceof Response ? result : HttpResponse.json<WorkEntryPage>(result);
  }),

  http.post("*/api/v1/content-types/:type/entries", async ({ request, params }) => {
    const user = requireWork();
    if (user instanceof Response) return user;
    const type = findType(String(params.type));
    if (!type) return apiError(404, "CONTENT_TYPE_NOT_FOUND", "Content type not found");
    if (!allowedType(user, type.key)) return forbidden("create", type.key);
    const body = ((await request.json().catch(() => null)) ?? {}) as EntryWriteRequest;
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
      updatedAt: now,
    };
    db.workEntries.push(entry);
    return HttpResponse.json<WorkEntry>(entry, { status: 201 });
  }),

  http.get("*/api/v1/entries/:id", ({ params }) => {
    const entry = loadEntry(String(params.id), "read_draft");
    return entry instanceof Response ? entry : HttpResponse.json<WorkEntry>(entry);
  }),

  http.patch("*/api/v1/entries/:id", async ({ request, params }) => {
    const entry = loadEntry(String(params.id), "update");
    if (entry instanceof Response) return entry;
    const body = ((await request.json().catch(() => null)) ?? {}) as EntryWriteRequest;
    if (entry.publicationState === "archived") return apiError(409, "INVALID_STATE_TRANSITION", "Archived entries are read-only");
    if (body.version == null) return apiError(428, "VERSION_REQUIRED", "PATCH requires the entry version");
    if (getState().scenario === "conflict" || body.version !== entry.version) {
      return apiError(409, "VERSION_CONFLICT", "Version conflict");
    }
    const payload = { ...entry.payload, ...(body.payload ?? {}) };
    const validation = validatePayload(entry.contentType, payload);
    if (validation) return validation;
    return HttpResponse.json<WorkEntry>(
      save(entry, {
        slug: body.slug ?? entry.slug,
        payload,
        title: workTitle(findType(entry.contentType), payload),
        dirty: entry.publicationState === "published",
      }),
    );
  }),

  transition("publish"),
  transition("unpublish"),
  transition("archive"),

  http.post("*/api/v1/media", async ({ request }) => {
    const user = requireWork();
    if (user instanceof Response) return user;
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) return apiError(415, "unsupported_media_type", "Unsupported media type");
    const id = crypto.randomUUID();
    const title = String(form.get("title") || file.name);
    const variant = (name: string) => ({
      url: `/api/v1/media/${id}/file/${name}`,
      width: 64,
      height: 64,
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
      width: 64,
      height: 64,
      variants: { original: variant("original"), thumbnail: variant("thumbnail"), web: variant("web") },
    };
    db.media.unshift(asset);
    return HttpResponse.json<MediaAsset>(asset, { status: 201 });
  }),

  http.get("*/api/v1/media/:id/file/:variant", ({ params }) => {
    const user = requireWork();
    if (user instanceof Response) return user;
    return db.media.some((m) => m.id === params.id) ? png() : apiError(404, "not_found", "Media not found");
  }),
];
