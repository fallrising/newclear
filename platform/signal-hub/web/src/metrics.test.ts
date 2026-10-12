import { afterEach, describe, expect, it, vi } from "vitest";
import { APIError } from "./model";
import { loadPages, metricPath, metricSeries, groupLabel } from "./metrics";
import type { Rollup } from "./metrics";

const row = (
  hour: number,
  value: number | null,
  extra: Partial<Rollup> = {},
): Rollup => ({
  rule_version: 1,
  bucket_start: `2026-10-03T${String(hour).padStart(2, "0")}:00:00Z`,
  group_key: "[]",
  value,
  sample_count: value === null ? 0 : 1,
  partial: false,
  computed_at: "2026-10-03T12:00:00Z",
  ...extra,
});
afterEach(() => vi.unstubAllGlobals());

describe("metric queries", () => {
  it("encodes exact group keys and only forwards metric query fields", () => {
    const params = new URLSearchParams(
      "from=2026-10-03T00%3A00%3A00.123456789Z&to=2026-10-04T00%3A00%3A00Z&type=secret&token=secret",
    );
    const path = new URL(
      metricPath("rule/name", params, '["a&b",null]'),
      "http://localhost",
    );
    expect(path.pathname).toBe("/v1/metrics/rule%2Fname");
    expect([...path.searchParams.keys()]).toEqual([
      "from",
      "to",
      "group",
      "limit",
    ]);
    expect(path.searchParams.get("from")).toBe(
      "2026-10-03T00:00:00.123456789Z",
    );
    expect(path.searchParams.get("group")).toBe('["a&b",null]');
  });
  it("loads all pages with credentials confined to headers and retains page metadata", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            items: [1],
            next_cursor: "a&b",
            last_computed_at: "old",
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            items: [2],
            next_cursor: null,
            last_computed_at: "new",
          }),
        ),
      );
    vi.stubGlobal("fetch", fetcher);
    const progress = vi.fn();
    const page = await loadPages<{
      items: number[];
      next_cursor: string | null;
      last_computed_at: string;
    }>(
      "/v1/rules?limit=200",
      "synthetic-token",
      new AbortController().signal,
      progress,
    );
    expect(page).toEqual({
      items: [1, 2],
      next_cursor: null,
      last_computed_at: "new",
    });
    expect(fetcher.mock.calls[1][0]).toBe("/v1/rules?limit=200&cursor=a%26b");
    expect(fetcher.mock.calls[1][1]).toMatchObject({
      headers: { Authorization: "Bearer synthetic-token" },
      cache: "no-store",
      credentials: "omit",
    });
    expect(progress.mock.calls.map(([count]) => count)).toEqual([1, 2]);
  });
  it("does not present incomplete pages as success on a later authorization failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ items: [1], next_cursor: "next" })),
        )
        .mockResolvedValueOnce(new Response("", { status: 401 })),
    );
    await expect(
      loadPages("/v1/rules?limit=200", "token", new AbortController().signal),
    ).rejects.toEqual(new APIError(401));
  });
  it("stops after cancellation even if fetch ignores the aborted signal", async () => {
    const controller = new AbortController();
    const fetcher = vi.fn(async () => {
      controller.abort();
      return new Response(JSON.stringify({ items: [1], next_cursor: "next" }));
    });
    vi.stubGlobal("fetch", fetcher);
    await expect(
      loadPages("/v1/rules?limit=200", "token", controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("rejects a repeated cursor instead of hanging or silently truncating", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ items: [1], next_cursor: "same" })),
      ),
    );
    await expect(
      loadPages("/v1/rules?limit=200", "token", new AbortController().signal),
    ).rejects.toThrow("Repeated pagination cursor");
  });
});

describe("metric presentation", () => {
  it("separates groups, preserves null/missing gaps and exposes version transitions", () => {
    const series = metricSeries(
      [
        row(1, 2),
        row(2, null),
        row(3, 4),
        row(5, 6),
        row(6, 7, { rule_version: 2 }),
        row(7, 8, { rule_version: 2, partial: true }),
        row(1, 10, { group_key: '["b"]' }),
      ],
      "1h",
    );
    const ungrouped = series.find((item) => item.group === "[]")!;
    expect(ungrouped.segments).toHaveLength(1);
    expect(ungrouped.segments[0].partial).toBe(true);
    expect(ungrouped.segments[0].from.value).toBe(7);
    expect(ungrouped.points).toHaveLength(5);
    expect(
      series.find((item) => item.group === '["b"]')!.segments,
    ).toHaveLength(0);
  });
  it("keeps ungrouped, overflow and literal values distinguishable", () => {
    expect(groupLabel("[]")).toBe("未分組");
    expect(groupLabel("__other__")).toBe("其他分組（合併）");
    expect(groupLabel('["__other__"]')).toBe('["__other__"]');
    expect(groupLabel('[null,"x"]')).toBe('[null,"x"]');
  });
});
