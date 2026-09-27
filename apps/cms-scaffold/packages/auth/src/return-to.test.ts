import { describe, expect, it } from "vitest";
import { safeReturnTo } from "./return-to";

const BACK = ["/", "/entries/:type", "/entries/:type/new", "/entries/:type/:id", "/views/album.composer", "/views/clinic.schedule", "/views/projects.board"];

describe("safeReturnTo", () => {
  it.each([
    ["/", "/"],
    ["/entries/album", "/entries/album"],
    ["/entries/album/new", "/entries/album/new"],
    ["/entries/album/30000000-0000-4000-8000-000000000001?tab=x#h", "/entries/album/30000000-0000-4000-8000-000000000001?tab=x#h"],
    ["/views/projects.board?project=abc", "/views/projects.board?project=abc"],
    ["/entries/album/../photo", "/entries/photo"],
    ["/entries/album?next=//evil.example", "/entries/album?next=//evil.example"],
  ])("S-01 accepts %j as %j", (raw, expected) => {
    expect(safeReturnTo(raw, BACK, "/")).toBe(expected);
  });

  it.each([
    [null],
    [undefined],
    [""],
    ["https://evil.example/steal"],
    ["//evil"],
    ["//evil.example/path"],
    ["/\\evil.example"],
    ["\\\\evil.example"],
    ["http://localhost:5174/entries"],
    ["javascript:alert(1)"],
    ["JavaScript:alert(1)"],
    ["data:text/html,<script>alert(1)</script>"],
    ["entries/album"],
    ["/\t/evil.example"],
    ["/\n/evil.example"],
    [" /entries/album"],
    ["/entries/album\\..\\x"],
    ["/%2F%2Fevil.example"],
    ["/admin"],
    ["/types"],
    ["/sign-in"],
    ["/entries/album/new/extra"],
  ])("S-01 AC-13 rejects %j and returns the fallback", (raw) => {
    expect(safeReturnTo(raw, BACK, "/")).toBe("/");
  });

  it("AC-13 Front has no member routes in W0, so every next falls back to /", () => {
    expect(safeReturnTo("/clinic/me", [], "/")).toBe("/");
    expect(safeReturnTo("https://evil.example/steal", [], "/")).toBe("/");
  });
});
