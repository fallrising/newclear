import { afterEach, describe, expect, it, vi } from "vitest";
import { createClient } from "./index";

describe("@cms/api", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("Front public reads only hit /api/v1/public", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ items: [] }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = createClient({ base: "http://localhost:8080", surface: "front" });
    await client.publicEntries("album");
    await client.publicBySlug("album", "coast-light-2026");
    const urls = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(urls[0]).toBe("http://localhost:8080/api/v1/public/content-types/album/entries");
    expect(urls[1]).toContain("/api/v1/public/content-types/album/slugs/");
    expect(urls.every((url) => url.includes("/api/v1/public/"))).toBe(true);
  });

  it("work list can filter by ref without a board API", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ items: [] }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = createClient({ base: "http://localhost:8080", surface: "back" });
    await client.entries("issue", { "ref.project": "proj-1" });
    expect(fetchMock.mock.calls[0][0]).toBe(
      "http://localhost:8080/api/v1/content-types/issue/entries?ref.project=proj-1",
    );
  });
});

