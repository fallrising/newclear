// @vitest-environment node
import { describe, expect, it } from "vitest";
import { fixtures } from "@cms/mocks";
import { toFormValues } from "./form";
import { buildZod, serverFieldErrors } from "./validation";

const note = fixtures.workContentTypes.items.find((t) => t.key === "note")!;

function codes(mode: "save" | "publish", payload: Record<string, unknown>) {
  const result = buildZod(note, mode).safeParse(toFormValues(note, payload));
  return result.success ? {} : Object.fromEntries(result.error.issues.map((i) => [String(i.path[0]), i.message]));
}

describe("client validation (mirrors BW1c §4.3)", () => {
  it("B-06 save checks formats: length, integer, enum and datetime", () => {
    expect(codes("save", { title: "ok", priority: 3, category: "idea", dueAt: "2026-10-01T09:30:00Z" })).toEqual({});
    expect(codes("save", { title: "t".repeat(1001) })).toEqual({ title: "TOO_LONG" });
    expect(codes("save", { title: "😀".repeat(1000) })).toEqual({});
    const form = { ...toFormValues(note, {}), priority: "1.5", category: "nope", dueAt: "tomorrow" };
    const result = buildZod(note, "save").safeParse(form);
    expect(result.success ? {} : Object.fromEntries(result.error.issues.map((i) => [String(i.path[0]), i.message]))).toEqual({
      priority: "WRONG_TYPE",
      category: "NOT_IN_ENUM",
      dueAt: "INVALID_DATETIME",
    });
  });

  it("B-06 empty required fields pass on save and fail with REQUIRED on publish", () => {
    expect(codes("save", {})).toEqual({});
    expect(codes("publish", {})).toEqual({ title: "REQUIRED" });
    expect(codes("publish", { title: "   " })).toEqual({ title: "REQUIRED" });
  });

  it("B-06 serverFieldErrors strips payload. and drops keys that are not fields", () => {
    expect(
      serverFieldErrors(note, [
        { field: "payload.title", code: "TOO_LONG", message: "x" },
        { field: "payload.slug", code: "RESERVED_KEY", message: "x" },
      ]),
    ).toEqual([{ key: "title", code: "TOO_LONG" }]);
  });
});
