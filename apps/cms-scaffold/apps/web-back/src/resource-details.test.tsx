import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { db, setScenario, setUser } from "@cms/mocks";
import { describe, expect, it } from "vitest";
import { openMoreActions, visibleUuids } from "./test-helpers";
import { recordRequests, renderRoute } from "./test-utils";

const entry = (slug: string) => db.workEntries.find((e) => e.slug === slug)!;
const writes = (requests: ReturnType<typeof recordRequests>) => requests.filter((r) => r.method !== "GET" && r.path !== "/api/v1/auth/csrf");

async function editTitle(value: string, label = /^標題/) {
  const title = await screen.findByLabelText(label);
  fireEvent.change(title, { target: { value } });
  return title;
}

describe("Resource details: fields and layout", () => {
  it("V2-AC-05 C-05 every field type gets its §6.4 control and no raw UUID is visible", async () => {
    setUser("mock-operator-notes");
    renderRoute(`/entries/note/${entry("lens-notes").id}`);
    expect(await screen.findByLabelText(/^標題/)).toHaveValue("Lens notes");
    const type = (key: string) => screen.getByTestId(`field-${key}-row`).getAttribute("data-field-type");
    expect(["title", "body", "category", "color", "priority", "pinned", "dueAt", "related", "attachment", "location"].map(type)).toEqual([
      "string", "markdown", "enum", "enum", "int", "boolean", "datetime", "ref", "media-ref", "unknown",
    ]);
    expect(screen.getByTestId("field-category-radio")).toBeInTheDocument();
    expect(screen.getByTestId("field-color-select")).toBeInTheDocument();
    expect(screen.getByLabelText(/^優先順序/)).toHaveValue("1");
    expect(screen.getByTestId("field-location-unknown")).toBeInTheDocument();
    // The ref shows the linked note's title, the media its title; neither shows an id.
    const relations = screen.getByTestId("card-relations");
    expect(await within(relations).findByText("Buy film")).toBeInTheDocument();
    await waitFor(() => expect(visibleUuids()).toEqual([]));
  });

  it("B-S3 groups: 基本資料 and 媒體 in the main column; 發布, 關聯, 網址, 中繼資料 on the side", async () => {
    setUser("seed-operator-album");
    renderRoute(`/entries/album/${entry("coast-light-2026").id}`);
    await screen.findByLabelText(/^標題/);
    expect(screen.getAllByTestId(/^group-/).map((g) => g.getAttribute("data-testid"))).toEqual(["group-main", "group-media", "group-settings"]);
    expect(within(screen.getByTestId("card-meta")).getByText("30000000")).toBeInTheDocument();
    expect(screen.getByLabelText(/^網址代稱/)).toHaveValue("coast-light-2026");
    expect(screen.getByTestId("public-link")).toHaveAttribute("href", "http://localhost:5173/album/albums/coast-light-2026");
  });

  it("T-BO-04 a draft has no public link", async () => {
    setUser("seed-operator-album");
    renderRoute(`/entries/album/${entry("private-studio").id}`);
    await screen.findByLabelText(/^標題/);
    expect(screen.queryByTestId("public-link")).not.toBeInTheDocument();
    expect(screen.getByTestId("card-url")).toHaveTextContent("發布後才能開啟公開網址。");
  });

  it("01 §8 an entry of another type is redirected to its own type; a missing entry goes to /not-found", async () => {
    setUser("seed-operator-album");
    const { router } = renderRoute(`/entries/photo/${entry("private-studio").id}`);
    await waitFor(() => expect(router.state.location.pathname).toBe(`/entries/album/${entry("private-studio").id}`));
    await router.navigate("/entries/album/30000000-0000-4000-8000-00000000ffff");
    await waitFor(() => expect(router.state.location.pathname).toBe("/not-found"));
  });
});

describe("Resource details: saving", () => {
  it("V2-AC-06 C-05 G-07 saving sends only the changed keys with the version; a cleared field is null", async () => {
    setUser("mock-operator-notes");
    const requests = recordRequests();
    renderRoute(`/entries/note/${entry("buy-film").id}`);
    await editTitle("Buy more film");
    fireEvent.change(screen.getByLabelText(/^優先順序/), { target: { value: "" } });
    fireEvent.click(await screen.findByTestId("save-bar-save"));
    await screen.findByText("已儲存");
    expect(writes(requests)).toEqual([
      { method: "PATCH", path: `/api/v1/entries/${entry("buy-film").id}`, search: "", body: { version: 1, payload: { title: "Buy more film", priority: null } } },
    ]);
    expect(entry("buy-film").payload.location).toEqual({ lat: 25.03, lng: 121.56 });
    expect(screen.queryByTestId("save-bar")).not.toBeInTheDocument();
    expect(within(screen.getByTestId("card-meta")).getByText("2")).toBeInTheDocument();
  });

  it("C-06 V2-AC-08 unsaved changes show the save bar; leaving asks first and 捨棄 restores the values", async () => {
    setUser("seed-operator-album");
    const { router } = renderRoute(`/entries/album/${entry("private-studio").id}`);
    const title = await editTitle("Studio renamed");
    expect(screen.getByTestId("save-bar")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("link", { name: "Photos" }));
    expect(await screen.findByTestId("leave-dialog")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("leave-stay"));
    expect(router.state.location.pathname).toBe(`/entries/album/${entry("private-studio").id}`);
    expect(title).toHaveValue("Studio renamed");
    fireEvent.click(screen.getByTestId("save-bar-discard"));
    expect(title).toHaveValue("Studio (unpublished)");
    expect(screen.queryByTestId("save-bar")).not.toBeInTheDocument();
  });

  it("B-06 zod marks a bad value before sending; nothing is written", async () => {
    setUser("mock-operator-notes");
    const requests = recordRequests();
    renderRoute(`/entries/note/${entry("buy-film").id}`);
    fireEvent.change(await screen.findByLabelText(/^優先順序/), { target: { value: "1.5" } });
    fireEvent.click(screen.getByTestId("save-bar-save"));
    expect(await screen.findByTestId("field-priority-error")).toHaveTextContent("格式不正確。");
    expect(writes(requests)).toEqual([]);
  });

  it("V2-AC-09 W1-FM01 a 409 opens the conflict dialog and keeps the typed value; 載入最新版本 replaces it", async () => {
    setUser("seed-operator-album");
    renderRoute(`/entries/album/${entry("private-studio").id}`);
    const title = await editTitle("Studio renamed");
    setScenario("conflict");
    fireEvent.click(screen.getByTestId("save-bar-save"));
    expect(await screen.findByTestId("conflict-dialog")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("conflict-keep"));
    expect(title).toHaveValue("Studio renamed");
    expect(screen.getByTestId("save-bar")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("save-bar-save"));
    fireEvent.click(await screen.findByTestId("conflict-reload"));
    await waitFor(() => expect(screen.getByLabelText(/^標題/)).toHaveValue("Studio (unpublished)"));
    expect(screen.queryByTestId("save-bar")).not.toBeInTheDocument();
  });

  it("W1-FM16 a save rejected because someone archived the entry reloads it read-only", async () => {
    setUser("seed-operator-album");
    renderRoute(`/entries/album/${entry("private-studio").id}`);
    await editTitle("Studio renamed");
    entry("private-studio").publicationState = "archived";
    fireEvent.click(screen.getByTestId("save-bar-save"));
    expect(await screen.findByText("這個項目的狀態已被其他人改變，已重新載入。")).toBeInTheDocument();
    expect(await screen.findByTestId("details-read-only")).toBeInTheDocument();
    expect(screen.getByLabelText(/^標題/)).toHaveValue("Studio (unpublished)");
  });

  it("W1-FM09 a session that expires while editing asks before leaving for the sign-in page", async () => {
    setUser("seed-operator-album");
    const { router } = renderRoute(`/entries/album/${entry("private-studio").id}`);
    await editTitle("Studio renamed");
    setUser(null);
    fireEvent.click(screen.getByTestId("save-bar-save"));
    expect(await screen.findByTestId("leave-dialog")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("leave-confirm"));
    await waitFor(() => expect(router.state.location.pathname).toBe("/sign-in"));
  });

  it("W1-FM02 a slug already used in the type is marked on the slug field", async () => {
    setUser("seed-operator-album");
    renderRoute(`/entries/album/${entry("private-studio").id}`);
    fireEvent.change(await screen.findByLabelText(/^網址代稱/), { target: { value: "coast-light-2026" } });
    fireEvent.click(screen.getByTestId("save-bar-save"));
    expect(await screen.findByTestId("field-slug-error")).toHaveTextContent("這個網址代稱已被使用，請換一個。");
  });

  it("W1-FM03 an existing slug cannot be cleared (PATCH cannot clear it); nothing is sent", async () => {
    setUser("seed-operator-album");
    const requests = recordRequests();
    renderRoute(`/entries/album/${entry("private-studio").id}`);
    fireEvent.change(await screen.findByLabelText(/^網址代稱/), { target: { value: "" } });
    fireEvent.click(screen.getByTestId("save-bar-save"));
    expect(await screen.findByTestId("field-slug-error")).toHaveTextContent("已設定的網址代稱不能清空。");
    expect(writes(requests)).toEqual([]);
  });

  it("B-S3 a new entry is created with the full payload, then opens at its own URL", async () => {
    setUser("mock-operator-notes");
    const requests = recordRequests();
    const { router } = renderRoute("/entries/note/new");
    expect(await screen.findByRole("heading", { level: 1, name: "新增Note" })).toBeInTheDocument();
    await editTitle("Pack lenses");
    fireEvent.click(screen.getByTestId("save-bar-save"));
    await waitFor(() => expect(router.state.location.pathname).toMatch(/^\/entries\/note\/[0-9a-f-]{36}$/));
    expect(writes(requests)).toEqual([
      {
        method: "POST",
        path: "/api/v1/content-types/note/entries",
        search: "",
        body: { slug: null, payload: { title: "Pack lenses", body: null, category: null, color: null, priority: null, pinned: false, dueAt: null } },
      },
    ]);
    expect(await screen.findByTestId("details-publish")).toHaveTextContent("發布");
    expect(screen.queryByTestId("leave-dialog")).not.toBeInTheDocument();
  });

  it("W1-FM05 creating a second entry of a singleton type shows why it failed", async () => {
    setUser("seed-operator-clinic");
    renderRoute("/entries/clinic_profile/new");
    await editTitle("Second clinic", /^名稱/);
    fireEvent.click(screen.getByTestId("save-bar-save"));
    expect(await screen.findByText("這個類型只能有一筆，已經存在。")).toBeInTheDocument();
  });

  it("01 §8 /new without create goes to /forbidden", async () => {
    setUser("seed-editor-album");
    const { router } = renderRoute("/entries/page/new");
    await waitFor(() => expect(router.state.location.pathname).toBe("/forbidden"));
  });
});

describe("Resource details: publishing and lifecycle", () => {
  it("V2-AC-07 a draft with publish rights has 發布 as the only primary action and no 下架", async () => {
    setUser("mock-operator-notes");
    renderRoute(`/entries/note/${entry("buy-film").id}`);
    expect(await screen.findByTestId("details-publish")).toHaveTextContent("發布");
    expect(screen.queryByTestId("details-unpublish")).not.toBeInTheDocument();
  });

  it("V2-AC-07 published and unchanged: no primary action, 下架 on the side; dirty: 發布變更", async () => {
    setUser("mock-operator-notes");
    const { router } = renderRoute(`/entries/note/${entry("lens-notes").id}`);
    await screen.findByLabelText(/^標題/);
    expect(screen.queryByTestId("details-publish")).not.toBeInTheDocument();
    expect(screen.getByTestId("details-unpublish")).toBeInTheDocument();
    await router.navigate(`/entries/note/${entry("spring-ideas").id}`);
    expect(await screen.findByTestId("details-publish")).toHaveTextContent("發布變更");
  });

  it("T-BO-02 C-04 an editor (no publish, archive or delete) gets no publish button and no 更多動作 menu", async () => {
    setUser("seed-editor-album");
    renderRoute(`/entries/album/${entry("private-studio").id}`);
    expect(await screen.findByLabelText(/^標題/)).toHaveValue("Studio (unpublished)");
    expect(screen.queryByTestId("details-publish")).not.toBeInTheDocument();
    expect(screen.queryByTestId("page-more-actions")).not.toBeInTheDocument();
  });

  it("T-BO-02 the primary action is hidden while there are unsaved changes", async () => {
    setUser("mock-operator-notes");
    renderRoute(`/entries/note/${entry("buy-film").id}`);
    await editTitle("Buy film now");
    expect(screen.queryByTestId("details-publish")).not.toBeInTheDocument();
  });

  it("T-BO-02 S-03 publishing updates the badge and shows a toast", async () => {
    setUser("seed-operator-album");
    const requests = recordRequests();
    renderRoute(`/entries/album/${entry("private-studio").id}`);
    fireEvent.click(await screen.findByTestId("details-publish"));
    expect(await screen.findByText("已發布", { selector: "[data-sonner-toast] *" })).toBeInTheDocument();
    expect(within(screen.getByTestId("page-header")).getByTestId("status-badge")).toHaveAttribute("data-state", "published");
    expect(writes(requests).map((r) => `${r.method} ${r.path}`)).toEqual([`POST /api/v1/entries/${entry("private-studio").id}/publish`]);
    expect(requests.filter((r) => r.path === "/api/v1/auth/csrf").length).toBeLessThanOrEqual(1);
  });

  it("B-06 publishing with an empty required field is stopped in the browser and the field is marked", async () => {
    setUser("mock-operator-notes");
    entry("buy-film").payload.title = "";
    const requests = recordRequests();
    renderRoute(`/entries/note/${entry("buy-film").id}`);
    fireEvent.click(await screen.findByTestId("details-publish"));
    expect(await screen.findByTestId("field-title-error")).toHaveTextContent("這是必填欄位。");
    expect(writes(requests)).toEqual([]);
  });

  it("B-06 a server 422 on publish puts every error.fields entry on its field", async () => {
    setUser("mock-operator-notes");
    entry("buy-film").payload.related = "30000000-0000-4000-8000-00000000ffff";
    renderRoute(`/entries/note/${entry("buy-film").id}`);
    fireEvent.click(await screen.findByTestId("details-publish"));
    expect(await screen.findByTestId("field-related-error")).toHaveTextContent("連結的項目已不存在。");
    expect(await screen.findByText("有欄位需要修正。")).toBeInTheDocument();
  });

  it("C-06 封存 asks first, then the entry is read-only with 還原為草稿", async () => {
    setUser("seed-operator-album");
    renderRoute(`/entries/album/${entry("private-studio").id}`);
    await openMoreActions();
    fireEvent.click(await screen.findByTestId("details-archive"));
    const dialog = await screen.findByTestId("confirm-archive");
    expect(dialog).toHaveTextContent("封存「Studio (unpublished)」？");
    fireEvent.click(within(dialog).getByTestId("confirm-archive-confirm"));
    expect(await screen.findByTestId("details-read-only")).toHaveTextContent("已封存的項目不能編輯。");
    expect(screen.getByLabelText(/^標題/)).toBeDisabled();
    await openMoreActions();
    fireEvent.click(await screen.findByTestId("details-restore"));
    await waitFor(() => expect(screen.queryByTestId("details-read-only")).not.toBeInTheDocument());
  });

  it("C-06 移到回收 asks first and returns to the list", async () => {
    setUser("seed-operator-album");
    const { router } = renderRoute(`/entries/album/${entry("unlisted-proof").id}`);
    await openMoreActions();
    fireEvent.click(await screen.findByTestId("details-delete"));
    fireEvent.click(await screen.findByTestId("confirm-delete-confirm"));
    await waitFor(() => expect(router.state.location.pathname).toBe("/entries/album"));
    expect(await screen.findByText("已移到回收")).toBeInTheDocument();
  });

  it("W1-FM06 移到回收 of a referenced entry explains the REF_CONSTRAINT and stays", async () => {
    setUser("seed-operator-album");
    const { router } = renderRoute(`/entries/album/${entry("coast-light-2026").id}`);
    await openMoreActions();
    fireEvent.click(await screen.findByTestId("details-delete"));
    fireEvent.click(await screen.findByTestId("confirm-delete-confirm"));
    expect(await screen.findByText("還有其他項目連結到它，不能移到回收。")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(`/entries/album/${entry("coast-light-2026").id}`);
  });
});
