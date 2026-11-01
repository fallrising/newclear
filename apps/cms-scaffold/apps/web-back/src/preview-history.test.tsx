import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { db, fixtures, setUser } from "@cms/mocks";
import { describe, expect, it } from "vitest";
import { visibleUuids } from "./test-helpers";
import { recordRequests, renderRoute } from "./test-utils";

const entry = (slug: string) => db.workEntries.find((e) => e.slug === slug)!;

describe("preview (surface-back §3.4)", () => {
  it("AC-PREV-01 預覽 opens the Back preview of the saved work copy; nothing is read from the public API", async () => {
    setUser("mock-operator-notes");
    const requests = recordRequests();
    const { router } = renderRoute(`/entries/note/${entry("buy-film").id}`);
    fireEvent.click(await screen.findByTestId("details-preview"));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/entries/note/${entry("buy-film").id}/preview`));
    expect(await screen.findByRole("heading", { level: 1, name: "預覽：Buy film" })).toBeInTheDocument();
    expect(screen.getByTestId("preview-note")).toHaveTextContent("公開網站只顯示已發布的版本。");
    const body = screen.getByTestId("preview-content");
    expect(within(body).getByText("two").tagName).toBe("STRONG");
    expect(within(within(body).getByRole("region", { name: "分類" })).getByText("待辦")).toBeInTheDocument();
    expect(within(within(body).getByRole("region", { name: "置頂" })).getByText("是")).toBeInTheDocument();
    expect(within(body).getByRole("region", { name: "到期時間" })).toHaveTextContent("2026年10月1日");
    const image = await within(body).findByTestId("preview-image");
    expect(image).toHaveAttribute("src", expect.stringContaining("/file/web"));
    expect(within(body).queryByRole("region", { name: "位置" })).not.toBeInTheDocument();
    expect(requests.filter((r) => r.path.startsWith("/api/v1/preview/")).map((r) => r.path)).toEqual([`/api/v1/preview/entries/${entry("buy-film").id}`]);
    expect(requests.some((r) => r.path.startsWith("/api/v1/public/"))).toBe(false);
    expect(visibleUuids()).toEqual([]);
    fireEvent.click(screen.getByRole("link", { name: "回到編輯" }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/entries/note/${entry("buy-film").id}`));
  });

  it("01 §8 the preview of a missing entry is /not-found; of an unreadable one /forbidden", async () => {
    setUser("mock-operator-notes");
    const { router } = renderRoute("/entries/note/30000000-0000-4000-8000-00000000ffff/preview");
    await waitFor(() => expect(router.state.location.pathname).toBe("/not-found"));
    await router.navigate(`/entries/album/${entry("coast-light-2026").id}/preview`);
    await waitFor(() => expect(router.state.location.pathname).toBe("/forbidden"));
  });
});

describe("preview edge cases", () => {
  it("W2-FM14 a type that is not previewable sends /preview back to the editor, and the editor has no 預覽", async () => {
    const note = fixtures.workContentTypes.items.find((t) => t.key === "note")!;
    note.previewable = false;
    try {
      setUser("mock-operator-notes");
      const { router } = renderRoute(`/entries/note/${entry("buy-film").id}/preview`);
      await waitFor(() => expect(router.state.location.pathname).toBe(`/entries/note/${entry("buy-film").id}`));
      expect(await screen.findByLabelText(/^標題/)).toHaveValue("Buy film");
      expect(screen.queryByTestId("details-preview")).not.toBeInTheDocument();
    } finally {
      note.previewable = true;
    }
  });
});

describe("revision history (01 §7.2 /entries/:type/:id/history)", () => {
  it("lists publish snapshots newest first; 還原到這一版 asks, copies the snapshot into the draft and returns to the editor", async () => {
    setUser("mock-operator-notes");
    const requests = recordRequests();
    const version = entry("spring-ideas").version;
    const { router } = renderRoute(`/entries/note/${entry("spring-ideas").id}`);
    fireEvent.click(await screen.findByTestId("history-link"));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/entries/note/${entry("spring-ideas").id}/history`));
    expect(await screen.findByRole("heading", { level: 1, name: "修訂紀錄" })).toBeInTheDocument();
    const rows = screen.getAllByTestId("history-row");
    expect(rows.map((r) => r.textContent)).toEqual([expect.stringMatching(/^第 1 版最新2026年9月20日.*spring-ideas還原到這一版$/)]);
    fireEvent.click(screen.getByRole("button", { name: "還原到第 1 版" }));
    const dialog = await screen.findByTestId("confirm-revert");
    expect(dialog).toHaveTextContent("把第 1 版的內容複製到草稿？");
    fireEvent.click(within(dialog).getByTestId("confirm-revert-confirm"));
    expect(await screen.findByText("已把第 1 版的內容複製到草稿")).toBeInTheDocument();
    await waitFor(() => expect(router.state.location.pathname).toBe(`/entries/note/${entry("spring-ideas").id}`));
    expect(await screen.findByLabelText(/^內文/)).toHaveValue("Harbour at night.");
    expect(within(screen.getByTestId("card-meta")).getByText(String(version + 1))).toBeInTheDocument();
    expect(requests.filter((r) => r.method === "POST" && r.path.includes("/revisions/")).map((r) => r.path)).toEqual([
      `/api/v1/entries/${entry("spring-ideas").id}/revisions/1/revert`,
    ]);
  });

  it("a never-published entry has an empty history; an archived one cannot be reverted", async () => {
    setUser("mock-operator-notes");
    const { router } = renderRoute(`/entries/note/${entry("buy-film").id}/history`);
    expect(await screen.findByTestId("history-empty")).toHaveTextContent("還沒有發布紀錄");
    entry("lens-notes").publicationState = "archived";
    await router.navigate(`/entries/note/${entry("lens-notes").id}/history`);
    expect(await screen.findByTestId("history-read-only")).toHaveTextContent("已封存的項目不能編輯。");
    expect(screen.getAllByTestId("history-row")).toHaveLength(1);
    expect(screen.queryByTestId("history-revert")).not.toBeInTheDocument();
  });

  it("a publish adds a revision: the history shows it after 發布變更", async () => {
    setUser("mock-operator-notes");
    const { router } = renderRoute(`/entries/note/${entry("spring-ideas").id}`);
    fireEvent.click(await screen.findByTestId("details-publish"));
    await waitFor(() => expect(within(screen.getByTestId("card-publish")).getByTestId("status-badge")).toHaveTextContent(/^已發布$/));
    await router.navigate(`/entries/note/${entry("spring-ideas").id}/history`);
    await waitFor(() => expect(screen.getAllByTestId("history-row").map((r) => r.textContent?.match(/^第 \d 版(最新)?/)?.[0])).toEqual(["第 2 版最新", "第 1 版"]));
  });

  it("W2-FM13 a revert that fails (the revision is gone) says so and stays on the history", async () => {
    setUser("mock-operator-notes");
    const { router } = renderRoute(`/entries/note/${entry("spring-ideas").id}/history`);
    fireEvent.click(await screen.findByRole("button", { name: "還原到第 1 版" }));
    db.revisions[entry("spring-ideas").id] = [];
    fireEvent.click(within(await screen.findByTestId("confirm-revert")).getByTestId("confirm-revert-confirm"));
    expect(await screen.findByText("操作沒有完成，請再試一次。")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(`/entries/note/${entry("spring-ideas").id}/history`);
  });
});
