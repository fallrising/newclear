import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { db, setUser } from "@cms/mocks";
import { server } from "@cms/mocks/node";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { recordRequests, renderRoute } from "./test-utils";

const entry = (slug: string) => db.workEntries.find((e) => e.slug === slug)!;
const writes = (requests: ReturnType<typeof recordRequests>) => requests.filter((r) => r.method !== "GET" && r.path !== "/api/v1/auth/csrf");
/** Puts an open publish request on an entry, as seed-editor-album would have. */
function askedFor(slug: string) {
  Object.assign(entry(slug), { publishRequestedAt: "2026-09-21T02:00:00Z", publishRequestedBy: "10000000-0000-4000-8000-000000000002" });
}

describe("G-03 publish requests in the editor (surface-back §4.7)", () => {
  it("AC-PUB-01 an editor without publish gets 請求發布 as the primary action; it asks, keeps the draft and shows the request", async () => {
    setUser("seed-editor-album");
    const requests = recordRequests();
    renderRoute(`/entries/photo/${entry("studio-polaroid").id}`);
    const version = entry("studio-polaroid").version;
    const ask = await screen.findByTestId("details-request-publish");
    expect(ask).toHaveTextContent("請求發布");
    expect(screen.queryByTestId("details-publish")).not.toBeInTheDocument();
    fireEvent.click(ask);
    expect(await screen.findByText("已送出發布請求")).toBeInTheDocument();
    expect(writes(requests)).toEqual([{ method: "POST", path: `/api/v1/entries/${entry("studio-polaroid").id}/publish-request`, search: "", body: null }]);
    const card = screen.getByTestId("publish-request");
    expect(card).toHaveTextContent("請求發布 2026");
    expect(card).toHaveTextContent("已請求發布，等待有發布權限的人處理。");
    expect(within(screen.getByTestId("page-header")).getByTestId("status-requested")).toHaveTextContent("等待發布");
    expect(screen.queryByTestId("details-request-publish")).not.toBeInTheDocument();
    expect(entry("studio-polaroid").publicationState).toBe("draft");
    expect(entry("studio-polaroid").version).toBe(version + 1);
    fireEvent.change(screen.getByLabelText(/^標題/), { target: { value: "Requested edit" } });
    fireEvent.click(screen.getByTestId("save-bar-save"));
    await waitFor(() => expect(requests.find((r) => r.method === "PATCH")?.body).toEqual({ version: version + 1, payload: { title: "Requested edit" } }));
  });

  it("G-03 撤回請求 clears the request and brings 請求發布 back", async () => {
    setUser("seed-editor-album");
    askedFor("studio-polaroid");
    renderRoute(`/entries/photo/${entry("studio-polaroid").id}`);
    fireEvent.click(await screen.findByTestId("details-cancel-request"));
    expect(await screen.findByText("已撤回發布請求")).toBeInTheDocument();
    expect(screen.queryByTestId("publish-request")).not.toBeInTheDocument();
    expect(await screen.findByTestId("details-request-publish")).toBeInTheDocument();
    expect(entry("studio-polaroid").publishRequestedAt).toBeNull();
  });

  it("G-03 a published entry without changes cannot be requested; unsaved changes hide the request action", async () => {
    setUser("seed-editor-album");
    renderRoute(`/entries/photo/${entry("coast-harbour").id}`);
    await screen.findByLabelText(/^標題/);
    expect(screen.queryByTestId("details-request-publish")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/^標題/), { target: { value: "Harbour wall at dusk" } });
    expect(await screen.findByTestId("save-bar")).toBeInTheDocument();
    expect(screen.queryByTestId("details-request-publish")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("save-bar-save"));
    expect(await screen.findByTestId("details-request-publish")).toBeInTheDocument();
  });

  it("G-03 a publisher sees the request and 發布 clears it", async () => {
    setUser("seed-operator-album");
    askedFor("private-studio");
    renderRoute(`/entries/album/${entry("private-studio").id}`);
    expect(await screen.findByTestId("publish-request")).toBeInTheDocument();
    fireEvent.click(await screen.findByTestId("details-publish"));
    await waitFor(() => expect(within(screen.getByTestId("card-publish")).getByTestId("status-badge")).toHaveAttribute("data-state", "published"));
    expect(screen.queryByTestId("publish-request")).not.toBeInTheDocument();
    expect(entry("private-studio")).toMatchObject({ publicationState: "published", publishRequestedAt: null });
  });
});

describe("publish-request write protection", () => {
  it("request and cancel block a second transition and form submission until the returned version is adopted", async () => {
    setUser("seed-editor-album");
    const current = entry("studio-polaroid");
    const requests = recordRequests();
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    server.use(http.post("*/api/v1/entries/:id/publish-request", async () => {
      await pending;
      return HttpResponse.json({ ...current, version: current.version + 1, publishRequestedAt: "2026-09-26T00:00:00Z", publishRequestedBy: "10000000-0000-4000-8000-000000000002" });
    }));
    renderRoute(`/entries/photo/${current.id}`);
    const button = await screen.findByTestId("details-request-publish");
    fireEvent.click(button);
    fireEvent.click(button);
    try {
      await waitFor(() => expect(writes(requests)).toHaveLength(1));
      expect(screen.getByLabelText(/^標題/)).toBeDisabled();
      fireEvent.submit(screen.getByLabelText(/^標題/).closest("form")!);
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(writes(requests)).toHaveLength(1);
    } finally { release(); }
    expect(await screen.findByTestId("details-cancel-request")).toBeEnabled();
  });
});

describe("G-03 publish request failures", () => {
  it("W2-FM09 a request for an entry someone just published is refused; the editor says so and reloads", async () => {
    setUser("seed-editor-album");
    renderRoute(`/entries/photo/${entry("studio-polaroid").id}`);
    const ask = await screen.findByTestId("details-request-publish");
    Object.assign(entry("studio-polaroid"), { publicationState: "published", dirty: false, publishedAt: "2026-09-26T00:00:00Z" });
    fireEvent.click(ask);
    expect(await screen.findByText("這個項目的狀態已被其他人改變，已重新載入。")).toBeInTheDocument();
    await waitFor(() => expect(within(screen.getByTestId("card-publish")).getByTestId("status-badge")).toHaveAttribute("data-state", "published"));
    expect(screen.queryByTestId("details-request-publish")).not.toBeInTheDocument();
  });
});

describe("G-03 finding requests", () => {
  it("the index filter 發布請求 sends publishRequested=true, keeps it in the URL and marks rows 等待發布", async () => {
    setUser("seed-operator-album");
    askedFor("private-studio");
    const requests = recordRequests();
    const { router } = renderRoute("/entries/album?publishRequested=true");
    const row = await screen.findByRole("link", { name: "Studio (unpublished)" });
    expect(screen.getAllByTestId("index-row")).toHaveLength(1);
    expect(within(row.closest("tr")!).getByTestId("status-requested")).toBeInTheDocument();
    expect(requests.some((r) => r.path === "/api/v1/content-types/album/entries" && r.search.includes("publishRequested=true"))).toBe(true);
    fireEvent.click(screen.getByTestId("index-clear"));
    await waitFor(() => expect(router.state.location.search).toBe(""));
    expect(await screen.findByRole("link", { name: "Coast Light 2026" })).toBeInTheDocument();
  });

  it("surface-back §4.4 Home lists types with waiting requests only for users who may publish them", async () => {
    setUser("seed-operator-album");
    askedFor("private-studio");
    askedFor("studio-polaroid");
    renderRoute("/");
    const section = await screen.findByTestId("home-requests");
    expect(within(section).getAllByRole("link").map((a) => [a.getAttribute("href"), a.textContent])).toEqual([
      ["/entries/album?publishRequested=true", "Albums1 筆等待發布"],
      ["/entries/photo?publishRequested=true", "Photos1 筆等待發布"],
    ]);
  });

  it("surface-back §4.4 Home has no request section for an editor or when nothing waits", async () => {
    setUser("seed-editor-album");
    askedFor("private-studio");
    renderRoute("/");
    expect(await screen.findByTestId("home-type-album")).toBeInTheDocument();
    expect(screen.queryByTestId("home-requests")).not.toBeInTheDocument();
  });
});
