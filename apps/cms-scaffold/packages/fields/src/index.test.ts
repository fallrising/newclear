import { describe, expect, it } from "vitest";
import { humanizeKey } from "./index";

describe("humanizeKey", () => {
  it.each([
    ["title", "Title"],
    ["sortOrder", "Sort order"],
    ["ownerPrincipalId", "Owner principal id"],
    ["clinic_profile", "Clinic profile"],
    ["in_progress", "In progress"],
    ["album.composer", "Album composer"],
    ["", ""],
  ])("G-05 %j → %j", (key, label) => {
    expect(humanizeKey(key)).toBe(label);
  });
});
