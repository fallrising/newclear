import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { db, setScenario, setUser } from "@cms/mocks";
import { describe, expect, it } from "vitest";
import { publicEntry, recordRequests, renderRoute } from "./test-utils";

const WEB = "http://localhost:8080/api/v1/public/media/20000000-0000-4000-8000-000000000002/file/web";

describe("album site (F-S1, F-S2, F-S3)", () => {
  it("AC-02 anonymous album flow → photo wall → lightbox only calls /api/v1/public and never sends draft parameters", async () => {
    const requests = recordRequests();
    renderRoute("/album");
    fireEvent.click(await screen.findByRole("link", { name: /Coast Light 2026/ }));
    expect(await screen.findByRole("heading", { level: 1, name: "Coast Light 2026" })).toBeInTheDocument();
    const tiles = await screen.findAllByTestId("photo-tile");
    expect(tiles).toHaveLength(6);
    fireEvent.click(tiles[1]);
    expect(await screen.findByTestId("lightbox")).toBeInTheDocument();
    expect(requests.length).toBeGreaterThan(0);
    expect(requests.every((r) => r.path.startsWith("/api/v1/public/"))).toBe(true);
    expect(requests.some((r) => r.path.includes("/api/v1/entries") || /previewToken|publicationState|includeDraft/.test(r.search))).toBe(false);
  });

  it("AC-03 no published album: /album/albums shows empty.albums, not NotFound and not a login wall", async () => {
    setScenario("empty");
    const { router } = renderRoute("/album/albums");
    expect(await screen.findByTestId("empty-published")).toHaveTextContent("還沒有公開相簿");
    expect(screen.getByText("發布後會出現在這裡。")).toBeInTheDocument();
    expect(screen.queryByTestId("not-found-public")).not.toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/album/albums");
  });

  it("T-FO-03 an unlisted album is not listed but its slug is readable", async () => {
    renderRoute("/album/albums");
    expect(await screen.findByText("Coast Light 2026")).toBeInTheDocument();
    expect(screen.queryByText("Unlisted proof")).not.toBeInTheDocument();
    cleanup();
    renderRoute("/album/albums/unlisted-proof");
    expect(await screen.findByRole("heading", { level: 1, name: "Unlisted proof" })).toBeInTheDocument();
  });

  it.each(["/album/albums/private-studio", "/album/albums/private-studio?preview=abc", "/album/albums/no-such-album"])(
    "AC-07 AC-15 %s renders NotFoundPublic without the draft's title, and does not go to /login",
    async (path) => {
      const requests = recordRequests();
      const { router } = renderRoute(path);
      expect(await screen.findByRole("heading", { level: 1, name: "找不到這個頁面" })).toBeInTheDocument();
      expect(screen.queryByText(/Studio \(unpublished\)/)).not.toBeInTheDocument();
      expect(router.state.location.pathname).not.toBe("/login");
      expect(requests.some((r) => /preview/.test(r.search))).toBe(false);
    },
  );

  it("W3-FM03 a signed-in Back user opening a draft album on Front still gets NotFoundPublic", async () => {
    setUser("seed-operator-album");
    const requests = recordRequests();
    renderRoute("/album/albums/private-studio");
    expect(await screen.findByTestId("not-found-public")).toBeInTheDocument();
    expect(requests.every((r) => r.path.startsWith("/api/v1/public/"))).toBe(true);
  });

  it("W3-FM24 an album with more than 100 photos shows the first 100 (one request, the API maximum)", async () => {
    const base = publicEntry("photo", "coast-ferry");
    for (let i = 1; i <= 100; i += 1) {
      const n = String(i).padStart(3, "0");
      db.publicEntries.push({ ...structuredClone(base), id: `30000000-0000-4000-8000-00000000f${n}`, slug: `extra-${n}`, title: `Extra ${n}` });
    }
    const requests = recordRequests();
    renderRoute("/album/albums/coast-light-2026");
    expect(await screen.findAllByTestId("photo-tile")).toHaveLength(100);
    expect(requests.find((r) => r.path === "/api/v1/public/content-types/photo/entries")?.search).toContain("size=100");
  });

  it("C-14 album card and photo tiles: thumbnail variant, width/height, lazy, alt from altText", async () => {
    renderRoute("/album/albums/coast-light-2026");
    const tiles = await screen.findAllByTestId("photo-tile");
    const img = within(tiles[0]).getByRole("img");
    expect(img).toHaveAttribute("src", "http://localhost:8080/api/v1/public/media/20000000-0000-4000-8000-000000000001/file/thumbnail");
    expect(img).toHaveAttribute("width", "64");
    expect(img).toHaveAttribute("height", "64");
    expect(img).toHaveAttribute("loading", "lazy");
    expect(img).toHaveAttribute("alt", "Harbour wall");
    expect(tiles[0]).toHaveAttribute("href", "/album/photos/coast-harbour");
  });

  it("C-14 alt falls back to the caption, then the title, when altText is empty", async () => {
    const harbour = publicEntry("photo", "coast-harbour");
    const harbourMedia = db.media.find((asset) => asset.id === (harbour.payload.media as { mediaId: string }).mediaId)!;
    harbourMedia.altText = "";
    const salt = publicEntry("photo", "coast-salt");
    const saltMedia = db.media.find((asset) => asset.id === (salt.payload.media as { mediaId: string }).mediaId)!;
    saltMedia.altText = "";
    renderRoute("/album/albums/coast-light-2026");
    const tiles = await screen.findAllByTestId("photo-tile");
    expect(within(tiles[0]).getByRole("img")).toHaveAttribute("alt", "Tide against the harbour wall.");
    expect(within(tiles[3]).getByRole("img")).toHaveAttribute("alt", "Salt air");
  });

  it("C-13 the album description is rendered as Markdown", async () => {
    publicEntry("album", "coast-light-2026").payload.description = "Sea and **concrete**.";
    renderRoute("/album/albums/coast-light-2026");
    expect((await screen.findByText("concrete")).tagName).toBe("STRONG");
  });

  it("F-S2 a click opens the lightbox with the web variant, syncs ?photo=, and ←/→ move within the album", async () => {
    const { router } = renderRoute("/album/albums/coast-light-2026");
    fireEvent.click((await screen.findAllByTestId("photo-tile"))[1]);
    const box = await screen.findByTestId("lightbox");
    expect(router.state.location.search).toBe("?photo=coast-sun");
    expect(within(box).getByRole("heading", { name: "Late sun" })).toBeInTheDocument();
    expect(within(box).getByTestId("lightbox-image")).toHaveAttribute("src", WEB);
    expect(within(box).getByTestId("lightbox-counter")).toHaveTextContent("2 / 6");
    expect(within(box).getByText("Late sun on the flats.")).toBeInTheDocument();
    fireEvent.keyDown(box, { key: "ArrowRight" });
    await waitFor(() => expect(router.state.location.search).toBe("?photo=coast-concrete"));
    expect(within(screen.getByTestId("lightbox")).getByTestId("lightbox-counter")).toHaveTextContent("3 / 6");
    fireEvent.keyDown(screen.getByTestId("lightbox"), { key: "ArrowLeft" });
    fireEvent.keyDown(screen.getByTestId("lightbox"), { key: "ArrowLeft" });
    await waitFor(() => expect(router.state.location.search).toBe("?photo=coast-harbour"));
    expect(screen.getByTestId("lightbox-previous")).toBeDisabled();
    fireEvent.keyDown(screen.getByTestId("lightbox"), { key: "ArrowLeft" });
    expect(router.state.location.search).toBe("?photo=coast-harbour");
  });

  it("F-S2 the close button and Esc close the lightbox and remove ?photo=", async () => {
    const { router } = renderRoute("/album/albums/coast-light-2026?photo=coast-ferry");
    const box = await screen.findByTestId("lightbox");
    expect(within(box).getByTestId("lightbox-counter")).toHaveTextContent("6 / 6");
    expect(within(box).getByTestId("lightbox-next")).toBeDisabled();
    fireEvent.click(within(box).getByTestId("lightbox-close"));
    await waitFor(() => expect(screen.queryByTestId("lightbox")).not.toBeInTheDocument());
    expect(router.state.location.search).toBe("");
    fireEvent.click(screen.getAllByTestId("photo-tile")[0]);
    fireEvent.keyDown(await screen.findByTestId("lightbox"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByTestId("lightbox")).not.toBeInTheDocument());
    expect(router.state.location.search).toBe("");
  });

  it("W3-FM13 an unknown ?photo= leaves the lightbox closed", async () => {
    renderRoute("/album/albums/coast-light-2026?photo=nope");
    expect(await screen.findAllByTestId("photo-tile")).toHaveLength(6);
    expect(screen.queryByTestId("lightbox")).not.toBeInTheDocument();
  });

  it("F-S2 Ctrl-click on a tile follows the link to the photo page instead of opening the lightbox", async () => {
    renderRoute("/album/albums/coast-light-2026");
    const tile = (await screen.findAllByTestId("photo-tile"))[0];
    const click = new MouseEvent("click", { bubbles: true, cancelable: true, ctrlKey: true, button: 0 });
    tile.dispatchEvent(click);
    expect(screen.queryByTestId("lightbox")).not.toBeInTheDocument();
  });

  it("V2-AC-04 C-01 the photo page uses the web variant with width and height", async () => {
    renderRoute("/album/photos/coast-sun");
    const img = await screen.findByTestId("photo-image");
    expect(img).toHaveAttribute("src", WEB);
    expect(img).toHaveAttribute("width", "64");
    expect(img).toHaveAttribute("height", "64");
    expect(img).toHaveAttribute("loading", "eager");
    expect(screen.getByRole("heading", { level: 1, name: "Late sun" })).toBeInTheDocument();
    expect(document.title).toBe("Late sun · 相簿");
  });

  it("F-S3 the photo page links its album and the previous / next photos; takenAt shows as a local date", async () => {
    publicEntry("photo", "coast-sun").payload.takenAt = "2026-02-28T16:30:00Z";
    renderRoute("/album/photos/coast-sun");
    const album = await screen.findByTestId("photo-album");
    expect(within(album).getByRole("link", { name: "Coast Light 2026" })).toHaveAttribute("href", "/album/albums/coast-light-2026");
    expect(await screen.findByTestId("photo-previous")).toHaveAttribute("href", "/album/photos/coast-harbour");
    expect(screen.getByTestId("photo-next")).toHaveAttribute("href", "/album/photos/coast-concrete");
    expect(screen.getByTestId("photo-taken-at")).toHaveTextContent("2026年3月1日");
  });

  it("F-S3 the first photo has no previous link; a photo without an image says so", async () => {
    delete publicEntry("photo", "coast-harbour").payload.media;
    renderRoute("/album/photos/coast-harbour");
    expect(await screen.findByText("這張相片沒有公開的圖片。")).toBeInTheDocument();
    expect(await screen.findByTestId("photo-next")).toHaveAttribute("href", "/album/photos/coast-sun");
    expect(screen.queryByTestId("photo-previous")).not.toBeInTheDocument();
  });

  it("AC-07 an unpublished photo slug renders NotFoundPublic", async () => {
    renderRoute("/album/photos/studio-polaroid");
    expect(await screen.findByTestId("not-found-public")).toBeInTheDocument();
    expect(screen.queryByText("Polaroid test")).not.toBeInTheDocument();
  });
});
