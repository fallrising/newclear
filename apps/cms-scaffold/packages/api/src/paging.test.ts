import { afterEach, expect, it, vi } from "vitest";
import { createCmsClient, keys } from "./index";
const api = () => createCmsClient({ baseUrl: "http://api.test" });
const page = (items: { id: string }[], total: number, page = 1) => ({ items, total, page, size: 100, offset: (page - 1) * 100, limit: 100 });
afterEach(() => vi.unstubAllGlobals());
function responses(body: (url: URL) => unknown) {
  const urls: URL[] = [];
  vi.stubGlobal("fetch", vi.fn(async (request: Request) => {
    const url = new URL(request.url); urls.push(url);
    return Response.json(body(url));
  }));
  return urls;
}
it("serializes paging, sort, typed filters, and repeated refs at the network boundary", async () => {
  const urls = responses(() => page([], 0));
  await api().work.entries("photo", { page: 2, size: 5, sort: "-sortOrder", filter: { sortOrder: 0, featured: false, "takenAt.from": "2026-01-01T00:00:00Z" }, ref: { album: ["a", "b", ""] } });
  expect([...urls[0].searchParams]).toEqual([["page", "2"], ["size", "5"], ["sort", "-sortOrder"], ["filter.sortOrder", "0"], ["filter.featured", "false"], ["filter.takenAt.from", "2026-01-01T00:00:00Z"], ["ref.album", "a"], ["ref.album", "b"]]);
  expect(keys.entries.list("photo", { size: 5 })).not.toEqual(keys.entries.list("photo", { size: 10 }));
});
it("complete lists fetch size100 sequential pages and retain the query", async () => {
  const urls = responses((url) => Number(url.searchParams.get("page")) === 1 ? page(Array.from({ length: 100 }, (_, i) => ({ id: String(i) })), 101) : page([{ id: "100" }], 101, 2));
  const result = await api().public.allEntries("photo", { q: "needle", sort: "title", ref: { album: "a" } });
  expect(result.items).toHaveLength(101);
  expect(urls.map((u) => [u.searchParams.get("page"), u.searchParams.get("size"), u.searchParams.get("q"), u.searchParams.get("sort"), u.searchParams.get("ref.album")])).toEqual([["1", "100", "needle", "title", "a"], ["2", "100", "needle", "title", "a"]]);
});
it.each(["missing", "empty", "repeated"])("fails explicitly on %s progress", async (kind) => {
  responses((url) => { const p = Number(url.searchParams.get("page")); return kind === "missing" ? { items: [], total: 1 } : page(kind === "empty" ? [] : Array.from({ length: 100 }, (_, i) => ({ id: String(i) })), 101, p); });
  await expect(api().work.allEntries("photo")).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
});
it("honors cancellation before fetching the next page", async () => {
  const controller = new AbortController();
  const urls = responses(() => { controller.abort(); return page(Array.from({ length: 100 }, (_, i) => ({ id: String(i) })), 101); });
  await expect(api().public.allEntries("photo", {}, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  expect(urls).toHaveLength(1);
});
it.each(["missing total", "wrong page", "short page", "changed total", "missing size"])("rejects %s rather than returning a partial complete list", async (kind) => {
  responses((url) => {
    const p = Number(url.searchParams.get("page"));
    const result: Record<string, unknown> = page(Array.from({ length: p === 1 ? 100 : 1 }, (_, i) => ({ id: String((p - 1) * 100 + i) })), 101, p);
    if (kind === "missing total") delete result.total;
    if (kind === "missing size") delete result.size;
    if (kind === "wrong page" && p === 2) result.page = 1;
    if (kind === "changed total" && p === 2) result.total = 102;
    if (kind === "short page") result.items = [{ id: "0" }];
    return result;
  });
  await expect(api().public.allEntries("album")).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
});
it("keeps all-pages and single-page cache results separate and strips work-only public params", async () => {
  const urls = responses(() => page([], 0));
  // Structural typing permits a variable with extra keys; the public serializer still selects only public fields.
  const params = { q: "public", state: "draft", size: 5, includeDraft: true };
  await api().public.entries("album", params);
  expect([...urls[0].searchParams]).toEqual([["q", "public"], ["size", "5"]]);
  expect(keys.public.entries("album")).not.toEqual(keys.public.allEntries("album"));
  expect(keys.entries.list("album")).not.toEqual(keys.entries.allEntries("album"));
});
