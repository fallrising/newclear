// @vitest-environment node
import { describe, expect, it } from "vitest";
import { fixtures } from "@cms/mocks";
import { enumLabel, fieldLabel, groupFields } from "./labels";

const type = (key: string) => fixtures.workContentTypes.items.find((t) => t.key === key)!;

describe("labels and groups", () => {
  it("G-05 G-06 use API labels, else the humanized key", () => {
    const status = type("issue").fields.find((f) => f.key === "status")!;
    expect(fieldLabel(status)).toBe("狀態");
    expect(enumLabel(status, "in_progress")).toBe("進行中");
    expect(fieldLabel({ ...status, label: null })).toBe("Status");
    expect(enumLabel({ ...status, enumLabels: {} }, "in_review")).toBe("In review");
  });

  it("01 §7.2 groups: main (title first), media, settings; relations apart", () => {
    const album = groupFields(type("album"));
    expect(album.main.map((g) => [g.key, g.label, g.fields.map((f) => f.key)])).toEqual([
      ["main", "基本資料", ["title", "description", "sortMode"]],
      ["media", "媒體", ["cover"]],
      ["settings", "設定", ["visibility"]],
    ]);
    expect(album.relations).toBeNull();
    const clinic = groupFields(type("clinic_profile"));
    expect(clinic.main[0].fields[0].key).toBe("name");
    expect(groupFields(type("note")).relations?.fields.map((f) => f.key)).toEqual(["related"]);
  });
});
