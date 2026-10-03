import { http, HttpResponse } from "msw";
import type { PublicContentTypeList, PublicEntry, PublicEntryPage } from "@cms/api";
import { db } from "../db";
import { publicContentTypes, workContentTypes } from "../fixtures.gen";
import { apiError, png } from "../respond";
import { getState } from "../state";
import { mediaId } from "../validation";
import { listPage } from "./list";

const AUDIENCE_PARAMS = ["state", "includeDraft", "asOf"];

/** 404 for an unknown type, 403 for a type anonymous visitors may not read, null when readable. */
function typeError(type: string) {
  if (!workContentTypes.items.some((t) => t.key === type)) return apiError(404, "ENTRY_NOT_FOUND", "Entry not found");
  if (!publicContentTypes.items.some((t) => t.key === type)) {
    return apiError(403, "FORBIDDEN", `Missing permission read_published on content type ${type}`);
  }
  return null;
}

function visibility(entry: PublicEntry) {
  const field = db.adminTypes.find((type) => type.key === entry.contentType)?.visibilityField;
  const raw = field ? entry.payload[field] : null;
  return raw == null ? "public" : typeof raw === "string" ? raw.trim() === "" ? "public" : raw.trim() : "invalid";
}

// Seed settings are internal and absent from the AdminContentType API projection.
const requiredPublishedRefs: Record<string, readonly string[]> = { photo: ["album"], milestone: ["project"] };
function baseReadable(entry: PublicEntry) {
  return db.adminTypes.some((type) => type.key === entry.contentType && type.enabled) && ["public", "unlisted"].includes(visibility(entry));
}
function readable(entry: PublicEntry) {
  return baseReadable(entry) && (requiredPublishedRefs[entry.contentType] ?? []).every((field) => {
    const id = entry.payload[field];
    return typeof id === "string" && db.publicEntries.some((target) => target.id === id && baseReadable(target));
  });
}

function audienceError(url: URL) {
  return AUDIENCE_PARAMS.some((p) => url.searchParams.has(p))
    ? apiError(400, "AUDIENCE_PARAM_REJECTED", "Audience parameters are not allowed on public reads")
    : null;
}

/** Media is publicly readable only when a public entry embeds it (kernel-media: attached to a published field). */
function publicMediaIds() {
  const ids = new Set<string>();
  for (const entry of db.publicEntries.filter(readable)) {
    for (const field of db.adminTypes.find((type) => type.key === entry.contentType)?.fields ?? []) {
      if (!field.enabled || field.visibility !== "public" || field.type !== "media-ref") continue;
      const id = mediaId(entry.payload[field.key]);
      if (id && db.media.some((asset) => asset.id === id)) ids.add(id);
    }
  }
  return ids;
}

/** Project a copy so failed resolution never alters published snapshots. */
function project(entry: PublicEntry): PublicEntry {
  const payload = { ...entry.payload };
  for (const field of db.adminTypes.find((type) => type.key === entry.contentType)?.fields ?? []) {
    if (!field.enabled || field.visibility !== "public") { delete payload[field.key]; continue; }
    if (field.type !== "media-ref" || !(field.key in payload) || payload[field.key] == null) continue;
    const value = payload[field.key];
    const id = mediaId(value);
    const asset = id ? db.media.find((media) => media.id === id) : undefined;
    payload[field.key] = asset && publicMediaIds().has(id!) ? {
      ...asset, variants: Object.fromEntries(Object.entries(asset.variants).map(([name, variant]) => [name, { ...variant, url: `/api/v1/public/media/${id}/file/${name}` }])),
    } : null;
  }
  return { ...entry, payload };
}

export const publicHandlers = [
  http.get("*/api/v1/public/content-types", () => HttpResponse.json<PublicContentTypeList>(publicContentTypes)),

  http.get("*/api/v1/public/content-types/:type/entries", ({ request, params }) => {
    const url = new URL(request.url);
    const type = String(params.type);
    const error = audienceError(url) ?? typeError(type);
    if (error) return error;
    const items =
      getState().scenario === "empty"
        ? []
        : db.publicEntries.filter(
            (e) => e.contentType === type && readable(e) && visibility(e) === "public",
          );
    const result = listPage(url, db.adminTypes.find((t) => t.key === type)!, items, true);
    return result instanceof Response ? result : HttpResponse.json<PublicEntryPage>({ ...result, items: result.items.map(project) });
  }),

  http.get("*/api/v1/public/content-types/:type/entries/:id", ({ request, params }) => {
    const error = audienceError(new URL(request.url)) ?? typeError(String(params.type));
    if (error) return error;
    const entry = db.publicEntries.find((e) => e.contentType === params.type && e.id === params.id && readable(e));
    return entry ? HttpResponse.json<PublicEntry>(project(entry)) : apiError(404, "ENTRY_NOT_FOUND", "Entry not found");
  }),

  http.get("*/api/v1/public/content-types/:type/slugs/:slug", ({ request, params }) => {
    const error = audienceError(new URL(request.url)) ?? typeError(String(params.type));
    if (error) return error;
    const entry = db.publicEntries.find((e) => e.contentType === params.type && e.slug === params.slug && readable(e));
    return entry ? HttpResponse.json<PublicEntry>(project(entry)) : apiError(404, "ENTRY_NOT_FOUND", "Entry not found");
  }),

  http.get("*/api/v1/public/media/:id/file/:variant", ({ params }) =>
    publicMediaIds().has(String(params.id)) ? png() : apiError(404, "not_found", "Media not found"),
  ),
];
