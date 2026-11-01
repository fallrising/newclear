import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { db, setScenario, setUser } from "@cms/mocks";
import { describe, expect, it } from "vitest";
import { FORBIDDEN_WORDS, recordRequests, renderRoute, writes } from "./test-utils";

async function rowOf(name: string) {
  const link = await screen.findByRole("link", { name });
  return link.closest("tr")!;
}

describe("web-admin content types", () => {
  it("surface-admin §4.4 lists every type with its state; AC-C there is no new-type control", async () => {
    setUser("seed-admin");
    db.adminTypes.find((t) => t.key === "visit")!.enabled = false;
    renderRoute("/types");
    expect(await screen.findAllByTestId("index-row")).toHaveLength(12);
    expect(within(await rowOf("Visit")).getByText("已停用")).toBeInTheDocument();
    expect(within(await rowOf("Album")).getByText("啟用中")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /新增/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /新增/ })).not.toBeInTheDocument();
    for (const word of FORBIDDEN_WORDS) expect(document.body.textContent).not.toContain(word);
  });

  it("01 §4.4 the state tab and the search live in the URL", async () => {
    setUser("seed-admin");
    db.adminTypes.find((t) => t.key === "visit")!.enabled = false;
    const { router } = renderRoute("/types?enabled=false");
    await waitFor(() => expect(screen.getAllByTestId("index-row")).toHaveLength(1));
    fireEvent.mouseDown(screen.getByTestId("types-tab-all"), { button: 0 });
    await waitFor(() => expect(router.state.location.search).toBe(""));
    fireEvent.change(screen.getByTestId("types-search"), { target: { value: "pho" } });
    await waitFor(() => expect(screen.getAllByTestId("index-row")).toHaveLength(1));
    expect(router.state.location.search).toBe("?q=pho");
    fireEvent.change(screen.getByTestId("types-search"), { target: { value: "zzz" } });
    expect(await screen.findByTestId("types-no-match")).toBeInTheDocument();
  });

  it("V2-AC-16 C-19 disabling needs the type name typed; the request goes out once it matches", async () => {
    setUser("seed-admin");
    const requests = recordRequests();
    renderRoute("/types");
    fireEvent.click(within(await rowOf("Photo")).getByTestId("type-toggle-photo"));
    const dialog = await screen.findByTestId("confirm-dialog");
    expect(dialog).toHaveTextContent("停用「Photo」？");
    expect(dialog).toHaveTextContent("資料不會刪除");
    const submit = within(dialog).getByTestId("confirm-submit");
    expect(submit).toBeDisabled();
    fireEvent.change(within(dialog).getByTestId("confirm-input"), { target: { value: "photo" } });
    expect(submit).toBeDisabled();
    fireEvent.change(within(dialog).getByTestId("confirm-input"), { target: { value: "Photo" } });
    expect(submit).toBeEnabled();
    fireEvent.click(submit);
    expect(await screen.findByText("已停用「Photo」")).toBeInTheDocument();
    await waitFor(() => expect(within(screen.getByRole("link", { name: "Photo" }).closest("tr")!).getByText("已停用")).toBeInTheDocument());
    expect(writes(requests).map((r) => `${r.method} ${r.path}`)).toEqual(["POST /api/v1/admin/content-types/photo/disable"]);
  });

  it("AC-B enabling asks once without typing; cancel sends nothing", async () => {
    setUser("seed-admin");
    db.adminTypes.find((t) => t.key === "visit")!.enabled = false;
    const requests = recordRequests();
    renderRoute("/types");
    fireEvent.click(within(await rowOf("Visit")).getByTestId("type-toggle-visit"));
    fireEvent.click(within(await screen.findByTestId("confirm-dialog")).getByTestId("confirm-cancel"));
    await waitFor(() => expect(screen.queryByTestId("confirm-dialog")).not.toBeInTheDocument());
    fireEvent.click(within(await rowOf("Visit")).getByTestId("type-toggle-visit"));
    const dialog = await screen.findByTestId("confirm-dialog");
    expect(within(dialog).queryByTestId("confirm-input")).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByTestId("confirm-submit"));
    expect(await screen.findByText("已啟用「Visit」")).toBeInTheDocument();
    expect(writes(requests).map((r) => r.path)).toEqual(["/api/v1/admin/content-types/visit/enable"]);
  });

  it("W4-FM06 a failed toggle keeps the dialog open and shows a toast", async () => {
    setUser("seed-admin");
    renderRoute("/types");
    fireEvent.click(within(await rowOf("Page")).getByTestId("type-toggle-page"));
    const dialog = await screen.findByTestId("confirm-dialog");
    fireEvent.change(within(dialog).getByTestId("confirm-input"), { target: { value: "Page" } });
    setScenario("error500");
    fireEvent.click(within(dialog).getByTestId("confirm-submit"));
    expect(await screen.findByText("操作沒有完成，請再試一次。")).toBeInTheDocument();
    expect(screen.getByTestId("confirm-dialog")).toBeInTheDocument();
  });

  it("surface-admin §4.4 the detail page is read only: settings, every field, no field editing", async () => {
    setUser("seed-admin");
    renderRoute("/types/owner");
    expect(await screen.findByRole("heading", { level: 1, name: "Owner" })).toBeInTheDocument();
    const fields = await screen.findAllByTestId("type-field");
    expect(fields.length).toBe(8);
    const owner = fields.find((row) => row.textContent?.includes("ownerPrincipalId"))!;
    expect(owner).toHaveTextContent("會員帳號");
    expect(screen.getByTestId("type-settings")).toHaveTextContent("網址代稱");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /欄位/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("type-toggle"));
    expect(await screen.findByTestId("confirm-input")).toBeInTheDocument();
  });

  it("W4-FM05 an unknown type key goes to /404", async () => {
    setUser("seed-admin");
    const { router } = renderRoute("/types/nope");
    await waitFor(() => expect(router.state.location.pathname).toBe("/404"));
  });

  it("AC-L zero types is an empty state, not an error", async () => {
    setUser("seed-admin");
    setScenario("empty");
    renderRoute("/types");
    expect(await screen.findByTestId("types-none")).toHaveTextContent("尚未載入 demo pack 種子");
  });
});
