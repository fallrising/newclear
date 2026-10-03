import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { fixtures, setScenario, setUser } from "@cms/mocks";
import type { WorkContentType } from "@cms/api";
import { describe, expect, it } from "vitest";
import { readIndexState, toListParams } from "./pages/resource-index";
import { recordRequests, renderRoute } from "./test-utils";

const album = fixtures.workContentTypes.items.find((t) => t.key === "album") as WorkContentType;

function listRequests(requests: ReturnType<typeof recordRequests>, type: string) {
  return requests.filter((r) => r.method === "GET" && r.path === `/api/v1/content-types/${type}/entries`).map((r) => Object.fromEntries(new URLSearchParams(r.search)));
}

function rowTitles() {
  return screen.getAllByTestId("index-row").map((row) => within(row).getAllByRole("link")[0].textContent);
}

describe("Resource index URL state", () => {
  it("01 §4.4 G-02 reads tab, search, sort, page, size and enum filters from the URL", () => {
    const state = readIndexState(album, new URLSearchParams("state=published&q=coast&sort=title&page=2&size=50&filter.visibility=unlisted"));
    expect(state).toEqual({ tab: "published", q: "coast", sort: "title", page: 2, size: 50, filter: { visibility: "unlisted" }, requested: false });
    expect(toListParams(state)).toEqual({ state: "published", q: "coast", filter: { visibility: "unlisted" }, sort: "title", page: 2, size: 50 });
  });

  it("W1-FM04 values the UI cannot produce fall back to defaults, so the API never sees a 400", () => {
    const state = readIndexState(album, new URLSearchParams("state=deleted&sort=payload&page=-3&size=500&filter.visibility=secret&filter.title=x"));
    expect(state).toEqual({ tab: "all", q: "", sort: "-updatedAt", page: 1, size: 20, filter: {}, requested: false });
    expect(toListParams(state)).toEqual({ sort: "-updatedAt", page: 1, size: 20 });
  });
});

describe("Resource index", () => {
  it("B-S2 G-11 lists title, status, listable fields and update time, newest first", async () => {
    setUser("seed-operator-album");
    const requests = recordRequests();
    renderRoute("/entries/album");
    await screen.findByText("Coast Light 2026");
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["標題", "狀態", "可見性", "排序方式", "更新時間"]);
    const unlisted = screen.getByText("Unlisted proof").closest("tr")!;
    expect(within(unlisted).getByTestId("status-badge")).toHaveTextContent("已發布");
    expect(within(unlisted).getByText("不公開列出")).toBeInTheDocument();
    expect(screen.getByTestId("index-total")).toHaveTextContent("共 3 筆");
    expect(listRequests(requests, "album")).toEqual([{ sort: "-updatedAt", page: "1", size: "20" }]);
  });

  it("C-04 a published entry with unpublished changes shows both badges", async () => {
    setUser("mock-operator-notes");
    renderRoute("/entries/note");
    const row = (await screen.findByText("Ideas for spring")).closest("tr")!;
    expect(within(row).getByTestId("status-badge")).toHaveTextContent("已發布有未發布的變更");
  });

  it("G-02 the draft tab and a title sort go to the API and into the URL", async () => {
    setUser("seed-operator-album");
    const requests = recordRequests();
    const { router } = renderRoute("/entries/photo");
    await screen.findByText("Harbour wall");
    fireEvent.mouseDown(screen.getByTestId("tab-draft"));
    await waitFor(() => expect(router.state.location.search).toBe("?state=draft"));
    await waitFor(() => expect(rowTitles()).toEqual(["Softbox", "Polaroid test"]));
    await router.navigate("/entries/photo?state=draft&sort=title");
    await waitFor(() => expect(rowTitles()).toEqual(["Polaroid test", "Softbox"]));
    expect(listRequests(requests, "photo")).toContainEqual({ state: "draft", sort: "title", page: "1", size: "20" });
  });

  it("G-02 search is debounced into ?q= and resets the page", async () => {
    setUser("seed-operator-album");
    const { router } = renderRoute("/entries/photo?page=1");
    fireEvent.change(await screen.findByTestId("index-search"), { target: { value: "sun" } });
    await waitFor(() => expect(router.state.location.search).toBe("?q=sun"));
    await waitFor(() => expect(rowTitles()).toEqual(["Late sun"]));
  });

  it("G-02 an enum filter from the URL narrows the list; no match offers to clear", async () => {
    setUser("seed-operator-album");
    const { router } = renderRoute("/entries/album?filter.visibility=unlisted");
    await waitFor(() => expect(rowTitles()).toEqual(["Unlisted proof"]));
    await router.navigate("/entries/album?q=nothing-like-this");
    expect(await screen.findByTestId("index-no-match")).toHaveTextContent("沒有符合的條目");
    fireEvent.click(screen.getByTestId("index-clear"));
    await waitFor(() => expect(router.state.location.search).toBe(""));
  });

  it("surface-back §4.5 an empty type offers 新增 only to users with create", async () => {
    setUser("seed-operator-album");
    setScenario("empty");
    renderRoute("/entries/album");
    const empty = await screen.findByTestId("index-empty");
    expect(empty).toHaveTextContent("還沒有Albums");
    expect(within(empty).getByRole("link", { name: "新增Album" })).toHaveAttribute("href", "/entries/album/new");
  });

  it("W1-FM05 a singleton type with its one entry has no 新增 action", async () => {
    setUser("seed-operator-clinic");
    renderRoute("/entries/clinic_profile");
    await screen.findByText("Cedar Pet Clinic");
    expect(screen.queryByTestId("entry-create")).not.toBeInTheDocument();
  });

  it("C-02 W0-FM09 a 500 shows the error with retry, never the empty copy", async () => {
    setUser("seed-operator-album");
    setScenario("error500");
    renderRoute("/entries/album");
    expect(await screen.findByTestId("query-error")).toBeInTheDocument();
    expect(screen.queryByTestId("index-empty")).not.toBeInTheDocument();
  });

  it("W1-FM10 a page past the end moves to the last page", async () => {
    setUser("seed-operator-album");
    const { router } = renderRoute("/entries/photo?page=5&sort=title");
    await waitFor(() => expect(router.state.location.search).toBe("?sort=title"));
    expect(await screen.findByText("Concrete edge")).toBeInTheDocument();
  });

  it("a row opens the entry", async () => {
    setUser("seed-operator-album");
    const { router } = renderRoute("/entries/album");
    fireEvent.click(await screen.findByRole("link", { name: "Unlisted proof" }));
    await waitFor(() => expect(router.state.location.pathname).toMatch(/^\/entries\/album\/30000000-/));
  });
});

describe("W1 strict page normalization", () => {
  it.each(["2tail", "1.5", "Infinity", "2147483648", "9007199254740993"])("defaults invalid URL page %s before making a request", (page) => {
    expect(readIndexState(album, new URLSearchParams({ page })).page).toBe(1);
  });
});
