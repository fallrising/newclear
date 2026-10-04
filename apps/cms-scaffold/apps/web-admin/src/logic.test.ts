import type { CmsAction, Me, Permission } from "@cms/api";
import { describe, expect, it } from "vitest";
import { formatBytes, localDayStart } from "./format";
import { fieldLabel } from "./labels";
import { canSettings, hasAdminRole, navFor } from "./nav";
import { readAuditFilters, toAuditQuery } from "./pages/audit";
import { assignmentsFrom, roleProblems, USERNAME_PATTERN } from "./pages/principals";
import { buildPermissions, cellKey } from "./pages/roles";

function me(global: CmsAction[], roles: string[] = ["admin"]): Me {
  return {
    principal: { id: "p", username: "u", displayName: "U", status: "active" },
    roles: roles.map((code) => ({ code, contentTypeCodes: [] })),
    surfaces: { front: true, back: true, admin: true },
    capabilities: { surface: "admin", types: [], global },
  };
}

function grant(action: CmsAction, contentTypeCode: string | null, predicateJson: string | null = null): Permission {
  return { id: `${action}-${contentTypeCode}`, action, contentTypeCode, predicateJson, allowedSurfaces: ["back", "admin"] };
}

describe("web-admin logic", () => {
  it("surface-admin §4.3 §4.5 the menu keeps its order and shows an item only with its capability", () => {
    const labels = (user: Me) => navFor(user)[0].items.map((i) => i.label);
    expect(labels(me(["manage_media", "manage_types", "manage_principals", "manage_settings", "read_audit"]))).toEqual([
      "總覽", "內容類型", "角色與權限", "使用者", "審計", "媒體與儲存", "設定",
    ]);
    expect(labels(me(["read_audit"], ["operator"]))).toEqual(["總覽", "審計"]);
    expect(labels(me(["manage_media"], ["operator"]))).toEqual(["總覽", "媒體與儲存", "設定"]);
    expect(canSettings(me([], ["admin"]))).toBe(true);
    expect(hasAdminRole(me([], ["operator"]))).toBe(false);
  });

  it("W4-FM18 localDayStart: local midnight, next day for an exclusive end, null for impossible dates", () => {
    // test-setup pins TZ=Asia/Taipei (UTC+8).
    expect(localDayStart("2026-09-25")).toBe("2026-09-24T16:00:00.000Z");
    expect(localDayStart("2026-09-25", 1)).toBe("2026-09-25T16:00:00.000Z");
    expect(localDayStart("2026-12-31", 1)).toBe("2026-12-31T16:00:00.000Z");
    expect(localDayStart("2026-02-30")).toBeNull();
    expect(localDayStart("26-9-1")).toBeNull();
  });

  it("A-S3 audit URL → query: unknown values dropped, days become instants, defaults left out of the URL", () => {
    const filters = readAuditFilters(new URLSearchParams("outcome=denied&from=2026-09-25&to=2026-09-25&action=entry.&category=NOPE&page=0&size=7&targetId=bad"));
    expect(filters).toMatchObject({ outcome: "denied", action: "entry.", category: "", page: 1, size: 20, targetId: "" });
    expect(toAuditQuery(filters)).toEqual({
      page: 1,
      size: 20,
      from: "2026-09-24T16:00:00.000Z",
      to: "2026-09-25T16:00:00.000Z",
      actor: undefined,
      action: "entry.",
      category: undefined,
      targetId: undefined,
      outcome: "denied",
    });
  });

  it("AC-K the PUT body keeps predicate and untouched grants, drops unchecked cells, adds new cells without surfaces", () => {
    const original = [grant("read_published", null), grant("create", null), grant("read_published", "pet", '{"type":"fieldEquals"}')];
    const checked = new Set([cellKey("read_published", null), cellKey("publish", "album")]);
    expect(buildPermissions(original, checked)).toEqual([
      { action: "read_published", contentTypeCode: null, predicateJson: null, allowedSurfaces: ["back", "admin"] },
      { action: "read_published", contentTypeCode: "pet", predicateJson: '{"type":"fieldEquals"}', allowedSurfaces: ["back", "admin"] },
      { action: "publish", contentTypeCode: "album" },
    ]);
  });

  it("principal roles: effective permissions → one assignment per role; scoped roles need types; username pattern", () => {
    const items = [
      { role: "anonymous", action: "read_published" as const, contentType: "album", allowedSurfaces: [], allowlist: [] },
      { role: "operator", action: "create" as const, contentType: "", allowedSurfaces: [], allowlist: ["album", "photo"] },
      { role: "operator", action: "update" as const, contentType: "", allowedSurfaces: [], allowlist: ["album", "photo"] },
      { role: "member", action: "read_published" as const, contentType: "pet", allowedSurfaces: [], allowlist: [] },
    ];
    expect(assignmentsFrom(items)).toEqual([
      { code: "operator", contentTypeCodes: ["album", "photo"] },
      { code: "member", contentTypeCodes: [] },
    ]);
    expect(roleProblems([{ code: "editor", contentTypeCodes: [] }, { code: "member", contentTypeCodes: [] }])).toEqual(["editor"]);
    expect(["clinic.op", "a_b-1", "ab", "Upper", "x".repeat(33)].map((u) => USERNAME_PATTERN.test(u))).toEqual([true, true, false, false, false]);
  });

  it("formatBytes and fieldLabel", () => {
    expect([32832, 1073741824, 15728640, 512].map(formatBytes)).toEqual(["32.1 KB", "1 GB", "15 MB", "512 B"]);
    expect(fieldLabel({ key: "ownerPrincipalId", label: null })).toBe("Owner principal id");
    expect(fieldLabel({ key: "title", label: "標題" })).toBe("標題");
  });
});
