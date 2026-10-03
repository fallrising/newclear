import { describe, it, expect } from "vitest";
import {
  initialParams,
  applyFilters,
  readFilters,
  eventsPath,
  safeOriginURL,
  presetRange,
  customUTC,
  localInput,
  sourceLabel,
  sortedRelated,
  APIError,
  errorText,
} from "./model";
import type { StoredEvent, Source } from "./model";

describe("reproducible URL filters", () => {
  it("fixes initial 24h bounds once and respects explicit all time", () => {
    const now = new Date("2026-10-03T12:00:00Z");
    const params = initialParams("", now);
    expect(params.get("from")).toBe("2026-10-02T12:00:00.000Z");
    expect(initialParams("?" + params, new Date("2026-11-01")).toString()).toBe(
      params.toString(),
    );
    expect(initialParams("?range=all", now).has("from")).toBe(false);
    expect(presetRange(1, now).to).toBe("2026-10-03T12:00:00.000Z");
  });
  it("preserves exact RFC3339 bounds and strips pagination, detail and credentials on filtering", () => {
    const params = initialParams(
      "?from=2026-10-03T12%3A00%3A00.123456789Z&source=urn%3Ax&event=2&token=secret&cursor=old",
    );
    const next = applyFilters(
      params,
      { ...readFilters(params), q: "<script>" },
      "custom",
    );
    expect(next.get("from")).toBe("2026-10-03T12:00:00.123456789Z");
    expect(next.has("cursor")).toBe(false);
    expect(next.has("event")).toBe(false);
    expect(next.has("token")).toBe(false);
    const url = new URL(eventsPath(next), "http://localhost");
    expect(url.searchParams.get("q")).toBe("<script>");
    expect(url.searchParams.has("range")).toBe(false);
  });
  it("keeps exact precision if a displayed local date was not edited", () => {
    const precise = "2026-10-03T12:00:00.123456789+08:00";
    expect(customUTC(localInput(precise), precise)).toBe(precise);
    expect(customUTC("", "")).toBe("");
    expect(customUTC("2026-10-03T12:00:00", "")).toBe(
      new Date("2026-10-03T12:00:00").toISOString(),
    );
  });
});
describe("safe presentation", () => {
  it("allows only credential-free absolute HTTP(S) origin links", () => {
    for (const value of [
      "javascript:alert(1)",
      "data:text/html,test",
      "/relative",
      "file:///tmp/a",
      "https://user:secret@example.invalid",
    ])
      expect(safeOriginURL(value)).toBeNull();
    expect(safeOriginURL("https://example.invalid/run/1")).toBe(
      "https://example.invalid/run/1",
    );
  });
  it("distinguishes no events from no freshness check", () => {
    const source = { status: "never", expected_interval: null } as Source;
    expect(sourceLabel(source)).toBe("尚未收到事件");
    expect(sourceLabel({ ...source, status: "fresh" })).toBe(
      "未啟用新鮮度檢查",
    );
    expect(
      sourceLabel({ ...source, status: "silent", expected_interval: "1h" }),
    ).toBe("沉默");
  });
  it("sorts ties using sub-millisecond precision and sequence", () => {
    const item = (seq: number, time: string) =>
      ({ seq, event: { time } }) as StoredEvent;
    expect(
      sortedRelated([
        item(3, "2026-10-03T00:00:00.0002Z"),
        item(2, "2026-10-03T00:00:00.0001Z"),
        item(1, "2026-10-03T00:00:00.0001Z"),
      ]).map((i) => i.seq),
    ).toEqual([1, 2, 3]);
  });
  it("distinguishes authentication, authorization and connectivity without reflecting API contents", () => {
    expect(errorText(new APIError(401))).toContain("401");
    expect(errorText(new APIError(403))).toContain("403");
    expect(errorText(new TypeError())).toContain("無法連線");
  });
});
