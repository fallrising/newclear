import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { keys } from "@cms/api";
import { db, setScenario, setUser } from "@cms/mocks";
import { describe, expect, it } from "vitest";
import { IDS, recordRequests, renderRoute, writes } from "./test-utils";

describe("web-admin principals", () => {
  it("surface-admin §4.4 lists principals; status tab, search and page live in the URL", async () => {
    setUser("seed-admin");
    db.principals.find((p) => p.id === IDS.editorAlbum)!.status = "locked";
    const { router } = renderRoute("/principals");
    expect(await screen.findAllByTestId("index-row")).toHaveLength(10);
    expect(screen.getAllByTestId("index-row")[0]).toHaveTextContent("mock-operator-notes");
    fireEvent.mouseDown(screen.getByTestId("principals-tab-locked"), { button: 0 });
    await waitFor(() => expect(screen.getAllByTestId("index-row")).toHaveLength(1));
    expect(screen.getByTestId("index-row")).toHaveTextContent("已鎖定");
    expect(router.state.location.search).toBe("?status=locked");
    fireEvent.mouseDown(screen.getByTestId("principals-tab-all"), { button: 0 });
    fireEvent.change(screen.getByTestId("principals-search"), { target: { value: "clinic" } });
    await waitFor(() => expect(screen.getAllByTestId("index-row")).toHaveLength(3));
    fireEvent.change(screen.getByTestId("principals-search"), { target: { value: "nobody" } });
    expect(await screen.findByTestId("principals-empty")).toBeInTheDocument();
    expect(document.title).toBe("使用者 · Admin center");
  });

  it("flow B AC-D creates an operator with clinic types; the temporary password shows once, then the detail page", async () => {
    setUser("seed-admin");
    const requests = recordRequests();
    const { router } = renderRoute("/principals/new");
    fireEvent.change(await screen.findByTestId("new-username"), { target: { value: "clinic.op" } });
    fireEvent.change(screen.getByTestId("new-name"), { target: { value: "Clinic desk" } });
    fireEvent.click(screen.getByTestId("role-operator"));
    fireEvent.click(await screen.findByTestId("new-submit"));
    expect(await screen.findByText("請至少選一個類型。")).toBeInTheDocument();
    expect(writes(requests)).toEqual([]);
    for (const type of ["owner", "pet", "vet", "visit"]) fireEvent.click(screen.getByTestId(`role-operator-type-${type}`));
    fireEvent.click(screen.getByTestId("new-submit"));
    const dialog = await screen.findByTestId("password-dialog");
    expect(within(dialog).getByTestId("temp-password")).toHaveTextContent(/^mock-temporary-password-\d+$/);
    expect(writes(requests).map((r) => `${r.method} ${r.path}`)).toEqual([
      "POST /api/v1/principals",
      expect.stringMatching(/^PUT \/api\/v1\/principals\/10000000-0000-4000-8000-0000000001\d\d\/roles$/),
    ]);
    expect(writes(requests)[0].body).toEqual({ username: "clinic.op", displayName: "Clinic desk", email: null });
    expect(writes(requests)[1].body).toEqual([{ code: "operator", contentTypeCodes: ["owner", "pet", "vet", "visit"] }]);
    fireEvent.click(within(dialog).getByTestId("password-done"));
    await waitFor(() => expect(router.state.location.pathname).toMatch(/^\/principals\/10000000-/));
    expect(await screen.findByRole("heading", { level: 1, name: "Clinic desk" })).toBeInTheDocument();
    expect(screen.queryByTestId("temp-password")).not.toBeInTheDocument();
    expect(await screen.findByTestId("role-operator-type-visit")).toBeChecked();
  });

  it("W4-FM09 an invalid or taken username is refused with an inline message", async () => {
    setUser("seed-admin");
    renderRoute("/principals/new");
    fireEvent.change(await screen.findByTestId("new-username"), { target: { value: "AB" } });
    fireEvent.click(screen.getByTestId("new-submit"));
    expect(await screen.findByText(/3 到 32 個字元/)).toHaveClass("text-critical");
    fireEvent.change(screen.getByTestId("new-username"), { target: { value: "seed-admin" } });
    fireEvent.click(screen.getByTestId("new-submit"));
    expect(await screen.findByTestId("principal-rejected")).toBeInTheDocument();
  });

  it("surface-admin §4.4 the detail page edits the profile and the roles with PUT", async () => {
    setUser("seed-admin");
    const requests = recordRequests();
    renderRoute(`/principals/${IDS.operatorAlbum}`);
    expect(await screen.findByRole("heading", { level: 1, name: "Album operator" })).toBeInTheDocument();
    expect(await screen.findByTestId("role-operator-type-album")).toBeChecked();
    fireEvent.change(screen.getByTestId("profile-name"), { target: { value: "Album desk" } });
    fireEvent.click(screen.getByTestId("profile-save"));
    expect(await screen.findByText("已儲存基本資料")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("role-operator-type-page"));
    fireEvent.click(screen.getByTestId("roles-save"));
    expect(await screen.findByText("已儲存角色")).toBeInTheDocument();
    expect(writes(requests).map((r) => [r.method, r.path, r.body])).toEqual([
      ["PATCH", `/api/v1/principals/${IDS.operatorAlbum}`, { displayName: "Album desk" }],
      ["PUT", `/api/v1/principals/${IDS.operatorAlbum}/roles`, [{ code: "operator", contentTypeCodes: ["album", "photo", "page"] }]],
    ]);
  });

  it("AC-H own account: no disable button, the admin role cannot be unchecked", async () => {
    setUser("seed-admin");
    renderRoute(`/principals/${IDS.admin}`);
    expect(await screen.findByTestId("principal-self")).toBeInTheDocument();
    expect(screen.queryByTestId("principal-disable")).not.toBeInTheDocument();
    expect(await screen.findByTestId("role-admin")).toBeDisabled();
    expect(screen.getByTestId("role-admin")).toBeChecked();
  });

  it("C-19 disabling asks for the username; W4-FM10 LAST_ADMIN is a toast and nothing changes", async () => {
    setUser("seed-admin");
    // Make seed-operator-album the only active admin, so disabling it is refused (403 LAST_ADMIN).
    db.principalRoles[IDS.operatorAlbum] = [{ code: "admin", contentTypeCodes: [] }];
    db.principalRoles[IDS.admin] = [];
    renderRoute(`/principals/${IDS.operatorAlbum}`);
    fireEvent.click(await screen.findByTestId("principal-disable"));
    const dialog = await screen.findByTestId("confirm-dialog");
    expect(within(dialog).getByTestId("confirm-submit")).toBeDisabled();
    fireEvent.change(within(dialog).getByTestId("confirm-input"), { target: { value: "seed-operator-album" } });
    fireEvent.click(within(dialog).getByTestId("confirm-submit"));
    expect(await screen.findByText("這個變更會讓系統沒有任何可用的管理員，已取消。")).toBeInTheDocument();
    expect(db.principals.find((p) => p.id === IDS.operatorAlbum)!.status).toBe("active");
  });

  it("disable, re-enable, unlock and reset password", async () => {
    setUser("seed-admin");
    const { queryClient } = renderRoute(`/principals/${IDS.editorAlbum}`);
    fireEvent.click(await screen.findByTestId("principal-disable"));
    const dialog = await screen.findByTestId("confirm-dialog");
    fireEvent.change(within(dialog).getByTestId("confirm-input"), { target: { value: "seed-editor-album" } });
    fireEvent.click(within(dialog).getByTestId("confirm-submit"));
    expect(await screen.findByText("已停用帳號")).toBeInTheDocument();
    expect(screen.getAllByTestId("principal-status")[0]).toHaveTextContent("已停用");
    fireEvent.click(await screen.findByTestId("principal-enable"));
    expect(await screen.findByText("已重新啟用")).toBeInTheDocument();
    db.principals.find((p) => p.id === IDS.editorAlbum)!.status = "locked";
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: keys.admin.principal(IDS.editorAlbum) });
    });
    fireEvent.click(await screen.findByTestId("principal-unlock"));
    expect(await screen.findByText("已解除鎖定")).toBeInTheDocument();
    expect(db.principals.find((p) => p.id === IDS.editorAlbum)!.status).toBe("active");
    expect(screen.getAllByTestId("principal-status")[0]).toHaveTextContent("啟用中");
    fireEvent.click(screen.getByTestId("principal-reset"));
    fireEvent.click(within(await screen.findByTestId("confirm-dialog")).getByTestId("confirm-submit"));
    expect(await screen.findByTestId("temp-password")).toHaveTextContent(/^mock-temporary-password-/);
    fireEvent.click(screen.getByTestId("password-done"));
    await waitFor(() => expect(screen.queryByTestId("password-dialog")).not.toBeInTheDocument());
  });

  it("W4-FM05 an unknown principal id goes to /404; W4-FM07 a 500 shows the retry state", async () => {
    setUser("seed-admin");
    const { router } = renderRoute("/principals/10000000-0000-4000-8000-00000000ffff");
    await waitFor(() => expect(router.state.location.pathname).toBe("/404"));
    setScenario("error500");
    router.navigate(`/principals/${IDS.editorAlbum}`);
    expect(await screen.findByTestId("query-error")).toBeInTheDocument();
  });
});
