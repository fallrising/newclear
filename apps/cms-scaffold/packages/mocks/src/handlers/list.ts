import type { AdminContentType, PublicEntry, WorkEntry } from "@cms/api";
import { db } from "../db";
import { apiError } from "../respond";

type Entry = PublicEntry | WorkEntry;
type Field = AdminContentType["fields"][number];
const kinds = new Set(["string", "markdown", "enum", "int", "boolean", "datetime", "ref", "principal-ref"]);
const refs = new Set(["ref", "principal-ref", "media-ref"]);
const cmp = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const instant = (s: string) => /(?:Z|[+-]\d\d:\d\d)$/.test(s) && Number.isFinite(Date.parse(s));
function value(field: Field | undefined, raw: unknown): string | number | boolean | null {
  if (!field) return null;
  if (field.type === "int") return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
  if (field.type === "boolean") return typeof raw === "boolean" ? raw : null;
  if (field.type === "datetime") return typeof raw === "string" && instant(raw) ? Date.parse(raw) : null;
  return typeof raw === "string" && raw.trim() !== "" ? raw : null;
}
/** Parse before filtering so an empty data set still rejects invalid query parameters. */
export function listPage<T extends Entry>(url: URL, type: AdminContentType, entries: T[], publicRead: boolean) {
  const params = url.searchParams;
  const fail = (message: string) => { throw new Error(message); };
  try {
    for (const name of new Set(params.keys())) if (!name.startsWith("ref.") && params.getAll(name).length > 1) fail(`${name} must not repeat`);
    const integer = (name: string, fallback: number, max: number) => {
      const raw = params.get(name)?.trim();
      if (!raw) return fallback;
      if (!raw || !/^[+-]?\d+$/.test(raw) || !Number.isSafeInteger(Number(raw)) || Number(raw) < 1 || Number(raw) > max) fail(`${name}: invalid integer`);
      return Number(raw);
    };
    const page = integer("page", 1, 2147483647), size = integer("size", 20, 100);
    const states = (params.get("state") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    for (const state of states) if (!["draft", "published", "archived"].includes(state)) fail(`state: unknown value ${state}`);
    if (!states.length) states.push("draft", "published");
    const indexed = (field: Field) => field.enabled && kinds.has(field.type) && (field.indexed || [type.titleField, type.sortField, type.visibilityField, type.ownerField].includes(field.key));
    const visible = (field: Field) => !publicRead || field.visibility === "public";
    const filters: ((entry: T) => boolean)[] = [];
    if (!publicRead) {
      const requested = params.get("publishRequested")?.trim();
      if (requested && requested !== "true" && requested !== "false") fail("publishRequested must be true or false");
      if (requested === "true") filters.push((entry) => "publishRequestedAt" in entry && entry.publishRequestedAt !== null);
      const include = parseInclude(params);
      if (typeof include === "string") fail(include);
    }
    const q = params.get("q");
    if (q?.trim()) filters.push((e) => (e.title ?? "").toLowerCase().includes(q.toLowerCase()));
    for (const [name, raw] of params) {
      if (name.startsWith("ref.")) {
        if (!raw.trim()) continue;
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw)) fail(`${name} must be a UUID`);
        const key = name.slice(4), field = type.fields.find((f) => f.key === key);
        if (publicRead && (!field || !field.enabled || !visible(field) || !refs.has(field.type))) fail(`${name}: field is not a public ref field`);
        // Ref lookup deliberately uses the work copy, matching BW1b's documented BQ-10.
        filters.push((e) => {
          const v = db.workEntries.find((work) => work.id === e.id)?.payload[key] ?? e.payload[key];
          const id = v && typeof v === "object" && "id" in v ? v.id : v;
          return typeof id === "string" && id.toLowerCase() === raw.toLowerCase();
        });
      }
      if (!name.startsWith("filter.")) continue;
      const range = name.endsWith(".from") ? "from" : name.endsWith(".to") ? "to" : null;
      const key = name.slice(7, range ? -(range.length + 1) : undefined), field = type.fields.find((f) => f.key === key);
      if (!raw.trim()) fail(`${name} must not be blank`);
      if (!field || !indexed(field) || !field.filterable || !visible(field)) fail(`${name}: field is not filterable`);
      if (!field) continue;
      let expected: string | number | boolean = raw;
      if (range || field.type === "datetime") {
        if (!range || field.type !== "datetime" || !instant(raw)) fail(`${name}: use an ISO-8601 date-time range with offset`);
        expected = Date.parse(raw);
      } else if (field.type === "int") {
        if (!/^[+-]?\d+$/.test(raw) || BigInt(raw) < -9223372036854775808n || BigInt(raw) > 9223372036854775807n) fail(`${name} must be an integer`);
        expected = Number(raw);
      } else if (field.type === "boolean") {
        if (!["true", "false"].includes(raw)) fail(`${name} must be true or false`);
        expected = raw === "true";
      }
      filters.push((e) => { const v = value(field, e.payload[key]); return v !== null && (range === "from" ? v >= expected : range === "to" ? v < expected : v === expected); });
    }
    const defaultField = type.fields.find((f) => f.key === type.sortField);
    const defaultSort = defaultField && indexed(defaultField) && visible(defaultField) && !refs.has(defaultField.type) ? defaultField.key : "-publishedAt";
    const rawSort = params.get("sort") || (publicRead ? defaultSort : "-updatedAt");
    const descending = rawSort.startsWith("-"), sort = descending ? rawSort.slice(1) : rawSort;
    const field = type.fields.find((f) => f.key === (sort === "title" ? type.titleField : sort));
    if (!["updatedAt", "createdAt", "publishedAt"].includes(sort) && !(sort === "title" && !field) && (!field || !indexed(field) || !visible(field) || refs.has(field.type))) fail(`sort: ${sort} is not sortable`);
    // The title alias must obey public field visibility too.
    if (publicRead && sort === "title" && field && !visible(field)) fail("sort: title is not sortable");
    const work = (e: T) => db.workEntries.find((item) => item.id === e.id);
    const sortValue = (e: T) => field ? value(field, e.payload[field.key]) : sort === "title" ? e.title : sort === "publishedAt" ? e.publishedAt : sort === "updatedAt" ? work(e)?.updatedAt ?? null : null;
    const ordered = entries.filter((e) => (publicRead || ("publicationState" in e && states.includes(e.publicationState))) && filters.every((f) => f(e))).sort((a, b) => {
      const av = sortValue(a), bv = sortValue(b);
      const primary = av === null ? bv === null ? 0 : 1 : bv === null ? -1 : (av < bv ? -1 : av > bv ? 1 : 0) * (descending ? -1 : 1);
      return primary || cmp(work(b)?.updatedAt ?? "", work(a)?.updatedAt ?? "") || cmp(a.id, b.id);
    });
    const offset = (page - 1) * size;
    return { items: ordered.slice(offset, offset + size), total: ordered.length, page, size, offset, limit: size };
  } catch (error) {
    return apiError(400, "VALIDATION_FAILED", error instanceof Error ? error.message : "Invalid list query");
  }
}

/** BW2 include accepts comma-separated refs, ignoring empty parts. */
export function parseInclude(params: URLSearchParams): boolean | string {
  const all = params.getAll("include");
  if (all.length > 1) return "include must not repeat";
  const parts = (all[0] ?? "").split(",").map((part) => part.trim()).filter(Boolean);
  const bad = parts.find((part) => part !== "refs");
  return bad ? `include: unknown value ${bad}` : parts.length > 0;
}
