import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { keys } from "@cms/api";
import { db, setUser } from "@cms/mocks";
import { describe, expect, it } from "vitest";
import { visibleUuids } from "./test-helpers";
import { recordRequests, renderRoute } from "./test-utils";

const entry = (slug: string) => db.workEntries.find((e) => e.slug === slug)!;
const media = (title: string) => db.media.find((m) => m.title === title)!;
const writes = (requests: ReturnType<typeof recordRequests>) => requests.filter((r) => r.method !== "GET" && r.path !== "/api/v1/auth/csrf");

/** Opens the picker of `button`, picks the option whose name matches `option` and confirms. */
async function pick(button: string, dialogTestId: string, option: RegExp) {
  fireEvent.click(await screen.findByRole("button", { name: button }));
  const dialog = await screen.findByTestId(dialogTestId);
  fireEvent.click(await within(dialog).findByRole("radio", { name: option }));
  fireEvent.click(within(dialog).getByTestId("picker-confirm"));
  await waitFor(() => expect(screen.queryByTestId(dialogTestId)).not.toBeInTheDocument());
}

describe("pickers in the editor (01 §6.4, B-S4)", () => {
  it("V2-AC-05 AC-MEDIA-01 choosing a cover stays on the page, marks the form dirty and saves only the new id", async () => {
    setUser("seed-operator-album");
    const requests = recordRequests();
    const version = entry("coast-light-2026").version;
    const { router } = renderRoute(`/entries/album/${entry("coast-light-2026").id}`);
    expect(await within(await screen.findByTestId("group-media")).findByText("Harbour wall")).toBeInTheDocument();
    await pick("更換封面", "media-picker", /Softbox/);
    expect(router.state.location.pathname).toBe(`/entries/album/${entry("coast-light-2026").id}`);
    expect(within(screen.getByTestId("group-media")).getByText("Softbox")).toBeInTheDocument();
    fireEvent.click(await screen.findByTestId("save-bar-save"));
    await screen.findByText("已儲存");
    expect(writes(requests)).toEqual([
      { method: "PATCH", path: `/api/v1/entries/${entry("coast-light-2026").id}`, search: "", body: { version, payload: { cover: media("Softbox").id } } },
    ]);
    expect(visibleUuids()).toEqual([]);
  });

  it("V2-AC-05 the relations card picks a ref by title; C-05 移除 sends null", async () => {
    setUser("seed-operator-album");
    const requests = recordRequests();
    const version = entry("coast-sun").version;
    renderRoute(`/entries/photo/${entry("coast-sun").id}`);
    const relations = await screen.findByTestId("card-relations");
    expect(await within(relations).findByText("Coast Light 2026")).toBeInTheDocument();
    await pick("更換相簿", "relation-picker", /Studio \(unpublished\)/);
    expect(within(relations).getByText("Studio (unpublished)")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "移除圖片" }));
    fireEvent.click(await screen.findByTestId("save-bar-save"));
    await screen.findByText("已儲存");
    expect(writes(requests).map((r) => r.body)).toEqual([{ version, payload: { album: entry("private-studio").id, media: null } }]);
  });

  it("V2-AC-05 a new photo gets its album and image from the pickers", async () => {
    setUser("seed-operator-album");
    const requests = recordRequests();
    renderRoute("/entries/photo/new");
    fireEvent.change(await screen.findByLabelText(/^標題/), { target: { value: "Pier" } });
    await pick("選擇相簿", "relation-picker", /Coast Light 2026/);
    await pick("選擇圖片", "media-picker", /Salt air/);
    fireEvent.click(await screen.findByTestId("save-bar-save"));
    await screen.findByText("已建立");
    const create = writes(requests)[0];
    expect(create).toMatchObject({ method: "POST", path: "/api/v1/content-types/photo/entries" });
    expect(create.body).toMatchObject({ payload: { title: "Pier", album: entry("coast-light-2026").id, media: media("Salt air").id } });
  });

  it("a background refetch preserves a newly selected media id and the original version until a conflict is resolved", async () => {
    setUser("seed-operator-album");
    const current = entry("coast-light-2026");
    const version = current.version;
    const requests = recordRequests();
    const { queryClient } = renderRoute(`/entries/album/${current.id}`);
    await pick("更換封面", "media-picker", /Softbox/);
    current.version += 1;
    current.payload.cover = media("Window light").id;
    await act(async () => { await queryClient.invalidateQueries({ queryKey: keys.entries.detail(current.id) }); });
    expect(within(screen.getByTestId("group-media")).getByText("Softbox")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("save-bar-save"));
    expect(await screen.findByTestId("conflict-dialog")).toBeInTheDocument();
    expect(writes(requests).map((r) => r.body)).toEqual([{ version, payload: { cover: media("Softbox").id } }]);
    fireEvent.click(screen.getByTestId("conflict-keep"));
    expect(within(screen.getByTestId("group-media")).getByText("Softbox")).toBeInTheDocument();
  });

  it("read-only entries show the values without picker buttons", async () => {
    setUser("seed-operator-album");
    entry("coast-sun").publicationState = "archived";
    renderRoute(`/entries/photo/${entry("coast-sun").id}`);
    expect(await screen.findByTestId("details-read-only")).toBeInTheDocument();
    expect(await within(screen.getByTestId("card-relations")).findByText("Coast Light 2026")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^(選擇|更換|移除)/ })).not.toBeInTheDocument();
  });
});
