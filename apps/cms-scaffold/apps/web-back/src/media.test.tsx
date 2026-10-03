import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { db, fixtures, setScenario, setUser } from "@cms/mocks";
import { describe, expect, it } from "vitest";
import { openMoreActions, visibleUuids } from "./test-helpers";
import { renderRoute } from "./test-utils";

const titles = () => screen.getAllByTestId("media-card").map((card) => card.querySelector("span.font-semibold")?.textContent);

describe("media library (01 §7.2 /media, surface-back §4.8)", () => {
  it("lists every file newest first as a grid; the search is kept in ?q=; a card opens the file", async () => {
    setUser("seed-operator-album");
    const { router } = renderRoute("/media");
    expect(await screen.findByRole("heading", { level: 1, name: "媒體庫" })).toBeInTheDocument();
    await waitFor(() => expect(titles()).toEqual(["Softbox", "Polaroid test", "Last ferry", "Window light", "Salt air", "Concrete edge", "Late sun", "Harbour wall"]));
    expect(screen.getByTestId("index-pagination")).toHaveTextContent("共 8 筆");
    fireEvent.change(screen.getByLabelText("搜尋名稱"), { target: { value: "sun" } });
    await waitFor(() => expect(router.state.location.search).toBe("?q=sun"));
    await waitFor(() => expect(titles()).toEqual(["Late sun"]));
    fireEvent.click(screen.getByRole("link", { name: /Late sun/ }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/media/${db.media.find((m) => m.title === "Late sun")!.id}`));
    expect(visibleUuids()).toEqual([]);
  });

  it("01 §4.4 pages are in the URL; a search without matches offers 清除搜尋", async () => {
    setUser("seed-operator-album");
    for (let i = 1; i <= 25; i += 1) db.media.push({ ...db.media[0], id: `20000000-0000-4000-8000-${String(900 + i).padStart(12, "0")}`, title: `Extra ${i}` });
    const { router } = renderRoute("/media");
    await waitFor(() => expect(titles()).toHaveLength(20));
    fireEvent.click(screen.getByRole("button", { name: "下一頁" }));
    await waitFor(() => expect(router.state.location.search).toBe("?page=2"));
    await waitFor(() => expect(titles()).toHaveLength(13));
    await router.navigate("/media?q=nothing");
    expect(await screen.findByTestId("media-no-match")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "清除搜尋" }));
    await waitFor(() => expect(router.state.location.search).toBe(""));
  });

  it("C-02 the empty library says so, with 上傳; a failed load offers a retry", async () => {
    setUser("seed-operator-album");
    setScenario("empty");
    const { router } = renderRoute("/media");
    const empty = await screen.findByTestId("media-empty");
    expect(within(empty).getByRole("button", { name: "上傳" })).toBeInTheDocument();
    setScenario("error500");
    await router.navigate("/media/20000000-0000-4000-8000-000000000001");
    expect(await screen.findByTestId("query-error")).toBeInTheDocument();
  });

  it("/media/:id shows the file facts; 移到回收 asks, removes it from the library and returns there", async () => {
    setUser("seed-operator-album");
    const softbox = db.media.find((m) => m.title === "Softbox")!;
    const { router } = renderRoute(`/media/${softbox.id}`);
    expect(await screen.findByRole("heading", { level: 1, name: "Softbox" })).toBeInTheDocument();
    const info = screen.getByTestId("media-info");
    expect(info).toHaveTextContent("格式 image/png");
    expect(info).toHaveTextContent("大小 1.2 KB");
    expect(info).toHaveTextContent("尺寸 64 × 64 像素");
    expect(screen.getByTestId("media-image")).toHaveAttribute("src", expect.stringContaining(`/api/v1/media/${softbox.id}/file/web`));
    await openMoreActions();
    fireEvent.click(await screen.findByTestId("media-delete"));
    fireEvent.click(within(await screen.findByTestId("confirm-media-delete")).getByTestId("confirm-media-delete-confirm"));
    expect(await screen.findByText("已移到回收")).toBeInTheDocument();
    await waitFor(() => expect(router.state.location.pathname).toBe("/media"));
    await waitFor(() => expect(titles()).toHaveLength(7));
    expect(titles()).not.toContain("Softbox");
  });

  it("01 §8 an unknown file is /not-found", async () => {
    setUser("seed-operator-album");
    const { router } = renderRoute("/media/20000000-0000-4000-8000-00000000ffff");
    await waitFor(() => expect(router.state.location.pathname).toBe("/not-found"));
  });

  it("W2-FM03 without manage_media the library is /forbidden and missing from the nav", async () => {
    const global = fixtures.capabilities["seed-editor-album"].back.global;
    global.splice(0, global.length);
    try {
      setUser("seed-editor-album");
      const { router } = renderRoute("/media");
      await waitFor(() => expect(router.state.location.pathname).toBe("/forbidden"));
      const nav = await screen.findByRole("navigation", { name: "主要導覽" });
      await waitFor(() => expect(within(nav).getAllByRole("link").map((a) => a.textContent)).toEqual(["首頁", "Albums", "Photos", "相簿編排"]));
    } finally {
      global.push("manage_media");
    }
  });
});
