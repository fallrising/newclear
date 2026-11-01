import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { db, setScenario, setUser } from "@cms/mocks";
import { describe, expect, it } from "vitest";
import { recordRequests, renderRoute, writes } from "./test-utils";

describe("web-admin roles and permissions", () => {
  it("surface-admin §4.4 lists the system roles with zh-Hant names and no create control", async () => {
    setUser("seed-admin");
    renderRoute("/roles");
    const rows = await screen.findAllByTestId("index-row");
    expect(rows.map((r) => r.querySelector("a")!.textContent)).toEqual(["管理員", "訪客", "編輯", "會員", "營運"]);
    expect(rows[0]).toHaveTextContent("系統角色");
    expect(screen.queryByRole("button", { name: /新增/ })).not.toBeInTheDocument();
  });

  it("A-S2 the matrix shows the grants: all types, per type, predicates, governance", async () => {
    setUser("seed-admin");
    renderRoute("/roles/member");
    expect(await screen.findByRole("heading", { level: 1, name: "會員" })).toBeInTheDocument();
    expect(await screen.findAllByTestId("matrix-row")).toHaveLength(13);
    expect(screen.getByTestId("cell-read_published-album")).toBeChecked();
    expect(screen.getByTestId("cell-read_published-*")).not.toBeChecked();
    // pet has a plain grant and an owner-only grant: the checkbox and the 限本人 badge
    const pet = screen.getByTestId("cell-read_published-pet").closest("td")!;
    expect(within(pet).getByText("限本人")).toBeInTheDocument();
    // owner only has the owner-only grant
    expect(screen.getByTestId("cell-read_published-owner")).not.toBeChecked();
    expect(within(screen.getByTestId("cell-read_published-owner").closest("td")!).getByText("限本人")).toBeInTheDocument();
    expect(screen.getByTestId("cell-manage_media-*")).not.toBeChecked();
  });

  it("AC-K surface-admin §9.4 toggling shows the save bar; save asks with the diff and sends one PUT with the whole list", async () => {
    setUser("seed-admin");
    const requests = recordRequests();
    renderRoute("/roles/editor");
    fireEvent.click(await screen.findByTestId("cell-publish-album"));
    fireEvent.click(screen.getByTestId("cell-manage_media-*"));
    expect(await screen.findByTestId("save-bar")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("save-bar-save"));
    const dialog = await screen.findByTestId("confirm-dialog");
    expect(dialog).toHaveTextContent("新增 1 項、移除 1 項");
    fireEvent.click(within(dialog).getByTestId("confirm-submit"));
    expect(await screen.findByText("已儲存權限")).toBeInTheDocument();
    const puts = writes(requests);
    expect(puts.map((r) => `${r.method} ${r.path}`)).toEqual(["PUT /api/v1/roles/editor/permissions"]);
    expect(puts[0].body).toEqual([
      { action: "read_published", contentTypeCode: null, predicateJson: null, allowedSurfaces: ["front", "back", "admin"] },
      { action: "read_draft", contentTypeCode: null, predicateJson: null, allowedSurfaces: ["back", "admin"] },
      { action: "create", contentTypeCode: null, predicateJson: null, allowedSurfaces: ["back", "admin"] },
      { action: "update", contentTypeCode: null, predicateJson: null, allowedSurfaces: ["back", "admin"] },
      { action: "publish", contentTypeCode: "album" },
    ]);
    await waitFor(() => expect(screen.queryByTestId("save-bar")).not.toBeInTheDocument());
    expect(db.rolePermissions.editor.find((p) => p.action === "publish")?.allowedSurfaces).toEqual(["back", "admin"]);
  });

  it("AC-K leaving with unsaved cells asks first; discard restores the grants", async () => {
    setUser("seed-admin");
    const { router } = renderRoute("/roles/operator");
    fireEvent.click(await screen.findByTestId("cell-delete-*"));
    fireEvent.click(screen.getByTestId("nav-principals"));
    expect(await screen.findByTestId("leave-dialog")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("leave-stay"));
    expect(router.state.location.pathname).toBe("/roles/operator");
    fireEvent.click(screen.getByTestId("save-bar-discard"));
    expect(screen.getByTestId("cell-delete-*")).toBeChecked();
    await waitFor(() => expect(screen.queryByTestId("save-bar")).not.toBeInTheDocument());
  });

  it("W4-FM08 a rejected save keeps the edits and says why", async () => {
    setUser("seed-admin");
    renderRoute("/roles/anonymous");
    for (const type of ["album", "photo", "page", "project", "milestone", "vet", "clinic_profile"]) {
      fireEvent.click(await screen.findByTestId(`cell-read_published-${type}`));
    }
    fireEvent.click(screen.getByTestId("save-bar-save"));
    fireEvent.click(within(await screen.findByTestId("confirm-dialog")).getByTestId("confirm-submit"));
    expect(await screen.findByText("權限設定不正確，變更沒有儲存。")).toBeInTheDocument();
    expect(screen.getByTestId("save-bar")).toBeInTheDocument();
    expect(screen.getByTestId("cell-read_published-album")).not.toBeChecked();
  });

  it("AC-H the admin role is read only", async () => {
    setUser("seed-admin");
    renderRoute("/roles/admin");
    expect(await screen.findByTestId("role-locked")).toBeInTheDocument();
    expect(screen.getByTestId("cell-manage_principals-*")).toBeDisabled();
    expect(screen.getByTestId("cell-manage_principals-*")).toBeChecked();
  });

  it("W4-FM05 an unknown role code goes to /404", async () => {
    setUser("seed-admin");
    const { router } = renderRoute("/roles/nope");
    await waitFor(() => expect(router.state.location.pathname).toBe("/404"));
  });

  it("W4-FM07 a failed load shows the retry state", async () => {
    setUser("seed-admin");
    setScenario("error500");
    renderRoute("/roles/editor");
    expect(await screen.findByTestId("query-error")).toBeInTheDocument();
  });
});
