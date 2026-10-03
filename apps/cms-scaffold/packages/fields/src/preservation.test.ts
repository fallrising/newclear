// @vitest-environment node
import type { WorkContentType, WorkField } from "@cms/api";
import { describe, expect, it } from "vitest";
import { diffPayload, toFormValues, toPayload } from "./form";
import { buildZod } from "./validation";

const field = (key: string, type: string, required = false) => ({ key, type, required, order: 0, label: null, group: null, helpText: null, placeholder: null, enumValues: [], enumLabels: {}, refTarget: null, listable: false, filterable: false, visibility: "back" }) as WorkField;
const type = { key: "example", fields: [field("title", "string", true), field("count", "int"), field("enabled", "boolean"), field("due", "datetime"), field("reference", "ref"), field("media", "media-ref"), field("principal", "principal-ref"), field("location", "geo")] } as WorkContentType;

describe("P0 value preservation", () => {
  it("omits client-only metadata from creation payloads", () => {
    const values = { ...toFormValues(type, { title: "Title" }), $slug: "url-slug" };
    expect(toPayload(type, values)).not.toHaveProperty("$slug");
    expect(toPayload(type, values)).toMatchObject({ title: "Title" });
  });
  it("preserves null booleans and raw read-only/unknown values when another field changes", () => {
    const payload = { title: "Original", enabled: null, reference: "entry-id", media: { mediaId: "media-id", future: 2 }, principal: "principal-id", location: { lat: 23 }, future: ["untouched"] };
    const initial = toFormValues(type, payload);
    const { future, ...declared } = payload;
    expect(initial.future).toEqual(future);
    expect(toPayload(type, initial)).toMatchObject(declared);
    expect(diffPayload(type, initial, { ...initial, title: "Edited", media: "changed", reference: "changed", principal: "changed", location: null })).toEqual({ title: "Edited" });
  });

  it("clears a boolean with explicit null and keeps false distinct from unset", () => {
    const initial = toFormValues(type, { enabled: true });
    expect(diffPayload(type, initial, { ...initial, enabled: null })).toEqual({ enabled: null });
    expect(diffPayload(type, initial, { ...initial, enabled: false })).toEqual({ enabled: false });
    expect(toFormValues(type, {}).enabled).toBe(false);
  });

  it.each(["1.5", "NaN", "Infinity", "12oops", "9007199254740993"])("rejects unsafe or invalid integer %s without changing form values", (raw) => {
    const values = { ...toFormValues(type, {}), count: raw };
    const result = buildZod(type, "save").safeParse(values);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues).toContainEqual(expect.objectContaining({ path: ["count"], message: "WRONG_TYPE" }));
    expect(values.count).toBe(raw);
  });

  it.each(["2026-02-30T12:00:00Z", "2026-03-01", "2026-01-01T25:00:00Z", "2026-01-01T00:00:00+19:00"])("rejects invalid or offset-free datetime %s", (due) => {
    const result = buildZod(type, "save").safeParse({ ...toFormValues(type, {}), due });
    expect(result.success).toBe(false);
  });

  it("allows null on save but requires required null booleans on publish", () => {
    const booleanType = { ...type, fields: [field("enabled", "boolean", true)] };
    const values = toFormValues(booleanType, { enabled: null });
    expect(buildZod(booleanType, "save").safeParse(values).success).toBe(true);
    const result = buildZod(booleanType, "publish").safeParse(values);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0].message).toBe("REQUIRED");
  });
});
