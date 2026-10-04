import { fireEvent, screen, waitFor } from "@testing-library/react";
import { db, fixtures, setScenario } from "@cms/mocks";
import { describe, expect, it } from "vitest";
import { publicEntry, renderRoute } from "./test-utils";

/** Removes `type` from the public types for the test (the mock then answers 403 FORBIDDEN); returns the restore function. */
function hidePublicType(type: string) {
  const items = fixtures.publicContentTypes.items;
  const at = items.findIndex((t) => t.key === type);
  const [removed] = items.splice(at, 1);
  return () => items.splice(at, 0, removed);
}

/** Adds `count` published albums after the fixture ones (ids …a01, slugs extra-01…). */
function addAlbums(count: number) {
  const base = publicEntry("album", "coast-light-2026");
  for (let i = 1; i <= count; i += 1) {
    const n = String(i).padStart(2, "0");
    db.publicEntries.push({ ...structuredClone(base), id: `30000000-0000-4000-8000-000000000a${n}`, slug: `extra-${n}`, title: `Extra ${n}` });
  }
}

describe("public states (01 §7.1 F-S6)", () => {
  it.each([
    ["/album/albums", "album-card", "還沒有公開相簿"],
    ["/clinic/vets", "vet-card", "目前沒有可顯示的獸醫"],
    ["/projects", "project-card", "還沒有公開專案"],
  ])("V2-AC-02 C-02 %s: while the list API is slow only the skeleton shows, never the empty copy", async (path, cardId, emptyCopy) => {
    setScenario("slow");
    renderRoute(path);
    expect((await screen.findAllByTestId("query-loading")).length).toBeGreaterThan(0);
    await new Promise((resolve) => setTimeout(resolve, 1000));
    expect(screen.getAllByTestId("query-loading").length).toBeGreaterThan(0);
    expect(screen.queryByText(emptyCopy)).not.toBeInTheDocument();
    expect(await screen.findAllByTestId(cardId, {}, { timeout: 4000 })).not.toHaveLength(0);
    expect(screen.queryByText(emptyCopy)).not.toBeInTheDocument();
  });

  it.each([
    ["/album/albums/coast-light-2026", "Coast Light 2026"],
    ["/album/photos/coast-sun", "Late sun"],
    ["/clinic/vets/james-carter", "James Carter"],
    ["/projects/cms-scaffold", "CMS Scaffold"],
  ])("V2-AC-03 C-03 %s: a 500 shows ErrorPublic with retry, not NotFoundPublic; retry loads the page", async (path, title) => {
    setScenario("error500");
    renderRoute(path);
    expect(await screen.findByRole("heading", { level: 1, name: "暫時無法載入" })).toBeInTheDocument();
    expect(screen.getByText("請檢查網路連線後再試一次。")).toBeInTheDocument();
    expect(screen.queryByTestId("not-found-public")).not.toBeInTheDocument();
    setScenario("none");
    fireEvent.click(screen.getByTestId("error-retry"));
    expect(await screen.findByRole("heading", { level: 1, name: title })).toBeInTheDocument();
  });

  it("W3-FM04 a 403 on a content route renders NotFoundPublic, the same as a 404", async () => {
    const restore = hidePublicType("vet");
    try {
      renderRoute("/clinic/vets/james-carter");
      expect(await screen.findByTestId("not-found-public")).toBeInTheDocument();
      expect(screen.queryByTestId("error-public")).not.toBeInTheDocument();
    } finally {
      restore();
    }
  });

  it("W3-FM07 the photo list failing inside an album shows ErrorPublic in place, under the album heading", async () => {
    const restore = hidePublicType("photo");
    try {
      renderRoute("/album/albums/coast-light-2026");
      expect(await screen.findByTestId("error-public")).toHaveTextContent("暫時無法載入");
      expect(screen.getByRole("heading", { level: 1, name: "Coast Light 2026" })).toBeInTheDocument();
    } finally {
      restore();
    }
  });

  it("W3-FM08 the home hero falls back to the site copy when the page entry is missing", async () => {
    renderRoute("/album");
    expect(await screen.findByRole("heading", { level: 1, name: "相簿" })).toBeInTheDocument();
    expect(screen.getByText("公開的相簿與相片。")).toBeInTheDocument();
    expect(screen.queryByTestId("error-public")).not.toBeInTheDocument();
  });

  it("W3-FM08 a published page 'home' fills the album hero, body as Markdown", async () => {
    db.publicEntries.push({
      id: "30000000-0000-4000-8000-000000000b01",
      contentType: "page",
      slug: "home",
      title: "Coast Light",
      payload: { title: "Coast Light", body: "A year of **sea** and concrete." },
      publishedAt: "2026-09-20T00:00:00Z",
    });
    renderRoute("/album");
    expect(await screen.findByRole("heading", { level: 1, name: "Coast Light" })).toBeInTheDocument();
    expect(screen.getByText("sea").tagName).toBe("STRONG");
    expect(document.title).toBe("相簿");
  });

  it("W3-FM12 a list longer than one page gets a pager; ?page= past the end goes to the last page", async () => {
    addAlbums(13);
    const { router } = renderRoute("/album/albums");
    expect(await screen.findAllByTestId("album-card")).toHaveLength(12);
    expect(screen.getByTestId("list-pager")).toHaveTextContent("第 1 / 2 頁");
    expect(screen.queryByTestId("pager-previous")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("pager-next"));
    await waitFor(() => expect(router.state.location.search).toBe("?page=2"));
    await waitFor(() => expect(screen.getAllByTestId("album-card")).toHaveLength(2));
    expect(screen.getByTestId("pager-previous")).toHaveAttribute("href", "/album/albums");
    await router.navigate("/album/albums?page=9");
    await waitFor(() => expect(router.state.location.search).toBe("?page=2"));
    await waitFor(() => expect(screen.getAllByTestId("album-card")).toHaveLength(2));
  });

  it("W3-FM12 an invalid ?page= is page 1", async () => {
    addAlbums(13);
    renderRoute("/album/albums?page=abc");
    expect(await screen.findAllByTestId("album-card")).toHaveLength(12);
    expect(screen.getByTestId("list-pager")).toHaveTextContent("第 1 / 2 頁");
  });
});
