import { http, HttpResponse } from "msw";
import type { PublicContentTypeList, PublicEntry, PublicEntryPage } from "@cms/api";
import { db } from "../db";
import { publicContentTypes, workContentTypes } from "../fixtures.gen";
import { apiError, png } from "../respond";
import { getState } from "../state";
import { matchesList } from "./common";

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
  return raw == null || String(raw).trim() === "" ? "public" : String(raw);
}

function readable(entry: PublicEntry) {
  return db.adminTypes.some((type) => type.key === entry.contentType && type.enabled) && visibility(entry) !== "private";
}

function publicOrder(typeKey: string) {
  const field = db.adminTypes.find((type) => type.key === typeKey)?.sortField;
  const updatedAt = (entry: PublicEntry) => db.workEntries.find((work) => work.id === entry.id)?.updatedAt ?? "";
  return (a: PublicEntry, b: PublicEntry) => {
    let primary: number;
    if (field) {
      const aValue = a.payload[field];
      const bValue = b.payload[field];
      const aNumber = typeof aValue === "number" ? aValue : Number.MAX_VALUE;
      const bNumber = typeof bValue === "number" ? bValue : Number.MAX_VALUE;
      primary = aNumber - bNumber;
    } else {
      primary = b.publishedAt.localeCompare(a.publishedAt);
    }
    return primary || updatedAt(b).localeCompare(updatedAt(a));
  };
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
    for (const value of Object.values(entry.payload)) {
      if (value && typeof value === "object" && "id" in value) ids.add(String((value as { id: unknown }).id));
    }
  }
  return ids;
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
            (e) => e.contentType === type && readable(e) && visibility(e) === "public" && matchesList(url, e),
          ).sort(publicOrder(type));
    return HttpResponse.json<PublicEntryPage>({ items, total: items.length, offset: 0, limit: items.length });
  }),

  http.get("*/api/v1/public/content-types/:type/entries/:id", ({ request, params }) => {
    const error = audienceError(new URL(request.url)) ?? typeError(String(params.type));
    if (error) return error;
    const entry = db.publicEntries.find((e) => e.contentType === params.type && e.id === params.id && readable(e));
    return entry ? HttpResponse.json<PublicEntry>(entry) : apiError(404, "ENTRY_NOT_FOUND", "Entry not found");
  }),

  http.get("*/api/v1/public/content-types/:type/slugs/:slug", ({ request, params }) => {
    const error = audienceError(new URL(request.url)) ?? typeError(String(params.type));
    if (error) return error;
    const entry = db.publicEntries.find((e) => e.contentType === params.type && e.slug === params.slug && readable(e));
    return entry ? HttpResponse.json<PublicEntry>(entry) : apiError(404, "ENTRY_NOT_FOUND", "Entry not found");
  }),

  http.get("*/api/v1/public/media/:id/file/:variant", ({ params }) =>
    publicMediaIds().has(String(params.id)) ? png() : apiError(404, "not_found", "Media not found"),
  ),
];
