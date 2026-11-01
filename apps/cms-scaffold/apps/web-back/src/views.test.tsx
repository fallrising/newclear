import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { db, setScenario, setUser } from "@cms/mocks";
import { afterEach, describe, expect, it, vi } from "vitest";
import { copy } from "./copy";
import { useDropClickGuard } from "./pages/view-common";
import { FORBIDDEN_WORDS } from "./test-helpers";
import { recordRequests, renderRoute } from "./test-utils";

const entry = (slug: string) => db.workEntries.find((e) => e.slug === slug)!;
const writes = (requests: ReturnType<typeof recordRequests>) => requests.filter((r) => r.method !== "GET" && r.path !== "/api/v1/auth/csrf");
const photoTitles = () => screen.getAllByTestId("composer-photo").map((p) => p.querySelector("strong")?.textContent);
const column = (status: string) => screen.getByTestId(`board-column-${status}`);
/** Waits until the card `title` is in the column (columns re-mount when the project changes). */
const inColumn = (status: string, title: string) => waitFor(() => expect(within(column(status)).getByText(title)).toBeInTheDocument());

/** Opens a Radix menu or select trigger (they open on Enter in jsdom). */
function open(trigger: HTMLElement) {
  fireEvent.keyDown(trigger, { key: "Enter" });
}

/** Chooses `option` in the Radix Select labelled `label`. */
async function choose(label: string, option: string) {
  open(screen.getByLabelText(label));
  fireEvent.keyDown(await screen.findByRole("option", { name: option }), { key: "Enter" });
}

afterEach(() => {
  vi.useRealTimers();
});

describe("pointer release behavior", () => {
  it("swallows the click immediately after a drag, then allows a fresh pointer click on card actions", () => {
    const select = vi.fn();
    function CardAction({ dragging }: { dragging: boolean }) {
      const guard = useDropClickGuard(dragging);
      return <div {...guard}><button onClick={select}>編輯</button></div>;
    }
    const view = render(<CardAction dragging={false} />);
    view.rerender(<CardAction dragging />);
    view.rerender(<CardAction dragging={false} />);
    const button = screen.getByRole("button", { name: "編輯" });
    expect(fireEvent.click(button)).toBe(false);
    expect(select).not.toHaveBeenCalled();
    fireEvent.pointerDown(button);
    fireEvent.click(button);
    expect(select).toHaveBeenCalledTimes(1);
  });
});

describe("album.composer (B-S5, C-08, G-09)", () => {
  it("C-08 G-09 往後移 writes one batch that renumbers only the photos that moved; the new order shows at once", async () => {
    setUser("seed-operator-album");
    const requests = recordRequests();
    renderRoute(`/views/album.composer?album=${entry("coast-light-2026").id}`);
    await waitFor(() => expect(photoTitles()).toEqual(["Harbour wall", "Late sun", "Concrete edge", "Salt air", "Window light", "Last ferry"]));
    expect(within(screen.getAllByTestId("composer-photo")[0]).getByTestId("composer-cover")).toHaveTextContent("封面");
    const photoVersions = new Map(db.workEntries.filter((entry) => entry.contentType === "photo").map((entry) => [entry.id, entry.version]));
    open(screen.getByRole("button", { name: "「Harbour wall」的動作" }));
    fireEvent.click(await screen.findByTestId("composer-right"));
    await waitFor(() => expect(photoTitles().slice(0, 2)).toEqual(["Late sun", "Harbour wall"]));
    expect(await screen.findByText("已更新順序")).toBeInTheDocument();
    expect(writes(requests)).toEqual([
      {
        method: "POST",
        path: "/api/v1/entries:batch-patch",
        search: "",
        body: {
          items: [
            { id: entry("coast-sun").id, version: photoVersions.get(entry("coast-sun").id), payload: { sortOrder: 10 } },
            { id: entry("coast-harbour").id, version: photoVersions.get(entry("coast-harbour").id), payload: { sortOrder: 20 } },
          ],
        },
      },
    ]);
    expect(screen.getAllByText(/^第 \d 張$/).map((p) => p.textContent)).toEqual(["第 1 張", "第 2 張", "第 3 張", "第 4 張", "第 5 張", "第 6 張"]);
  });

  it("expanded BW1 media objects retain the cover marker and its disabled no-op action", async () => {
    setUser("seed-operator-album");
    const album = entry("coast-light-2026");
    const photo = entry("coast-harbour");
    album.payload.cover = { mediaId: album.payload.cover };
    photo.payload.media = { mediaId: photo.payload.media };
    const requests = recordRequests();
    renderRoute(`/views/album.composer?album=${album.id}`);
    const first = (await screen.findByText("Harbour wall")).closest("li")!;
    expect(within(first).getByTestId("composer-cover")).toHaveTextContent("封面");
    open(screen.getByRole("button", { name: "「Harbour wall」的動作" }));
    const action = await screen.findByTestId("composer-set-cover");
    expect(action).toHaveAttribute("data-disabled");
    fireEvent.click(action);
    expect(writes(requests)).toEqual([]);
  });

  it("C-08 a failed batch puts the previous order back and says so; nothing was written", async () => {
    setUser("seed-operator-album");
    setScenario("conflict");
    renderRoute(`/views/album.composer?album=${entry("coast-light-2026").id}`);
    await waitFor(() => expect(photoTitles()?.[0]).toBe("Harbour wall"));
    open(screen.getByRole("button", { name: "「Late sun」的動作" }));
    fireEvent.click(await screen.findByTestId("composer-left"));
    expect(await screen.findByText("順序沒有更新，已重新載入目前的順序。")).toBeInTheDocument();
    await waitFor(() => expect(photoTitles().slice(0, 2)).toEqual(["Harbour wall", "Late sun"]));
    expect(entry("coast-harbour").payload.sortOrder).toBe(10);
  });

  it("C-10 ?album= picks the album both ways; 設為封面 writes the album's cover", async () => {
    setUser("seed-operator-album");
    const requests = recordRequests();
    const { router } = renderRoute(`/views/album.composer?album=${entry("private-studio").id}`);
    await waitFor(() => expect(photoTitles()).toEqual(["Polaroid test", "Softbox"]));
    expect(screen.getByLabelText("相簿")).toHaveTextContent("Studio (unpublished)");
    open(screen.getByRole("button", { name: "「Softbox」的動作" }));
    fireEvent.click(await screen.findByTestId("composer-set-cover"));
    expect(await screen.findByText("已設為封面")).toBeInTheDocument();
    expect(writes(requests).map((r) => [r.path, r.body])).toEqual([
      [`/api/v1/entries/${entry("private-studio").id}`, { version: 1, payload: { cover: "20000000-0000-4000-8000-000000000008" } }],
    ]);
    await choose("相簿", "Coast Light 2026");
    await waitFor(() => expect(router.state.location.search).toBe(`?album=${entry("coast-light-2026").id}`));
    await waitFor(() => expect(photoTitles()?.[0]).toBe("Harbour wall"));
    await router.navigate(-1);
    await waitFor(() => expect(photoTitles()).toEqual(["Polaroid test", "Softbox"]));
  });

  it("W2-FM18 an unknown ?album= falls back to the first album", async () => {
    setUser("seed-operator-album");
    renderRoute("/views/album.composer?album=30000000-0000-4000-8000-00000000ffff");
    await waitFor(() => expect(screen.getByLabelText("相簿")).toHaveTextContent(/\S/));
    // Albums come newest first (the list default sort -updatedAt), so the first is the most recently updated one.
    const first = db.workEntries.filter((e) => e.contentType === "album").sort((x, y) => y.updatedAt.localeCompare(x.updatedAt))[0];
    expect(screen.getByLabelText("相簿")).toHaveTextContent(first.title!);
  });

  it("an album without photos shows the empty state", async () => {
    setUser("seed-operator-album");
    renderRoute(`/views/album.composer?album=${entry("unlisted-proof").id}`);
    expect(await screen.findByTestId("composer-empty")).toHaveTextContent("這本相簿還沒有相片");
  });

  it("without albums the page offers 新增相簿", async () => {
    setUser("seed-operator-album");
    setScenario("empty");
    renderRoute("/views/album.composer");
    const none = await screen.findByTestId("composer-no-albums");
    expect(within(none).getByRole("link", { name: "新增相簿" })).toHaveAttribute("href", "/entries/album/new");
  });
});

describe("clinic.schedule (B-S7, C-09, G-02, G-10)", () => {
  it("V2-AC-11 at 07:30 in Asia/Taipei the default day is the local today, not the UTC date", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-19T23:30:00Z"));
    setUser("seed-operator-clinic");
    const requests = recordRequests();
    renderRoute("/views/clinic.schedule");
    expect(await screen.findByTestId("schedule-day")).toHaveTextContent("2026年9月20日 星期日");
    expect(await screen.findByText("Leo checkup")).toBeInTheDocument();
    const list = requests.find((r) => r.path === "/api/v1/content-types/visit/entries")!;
    expect(list.search).toBe(
      "size=100&sort=scheduledAt&include=refs&filter.scheduledAt.from=2026-09-19T16:00:00.000Z&filter.scheduledAt.to=2026-09-20T16:00:00.000Z",
    );
    expect(screen.getByTestId("schedule-today")).toBeDisabled();
  });

  it("C-09 a visit at 01:00 local belongs to the next day; ‹ › and 今天 move the day through ?date=", async () => {
    setUser("seed-operator-clinic");
    db.workEntries.push({
      ...entry("leo-checkup"),
      id: "30000000-0000-4000-8000-000000000099",
      slug: "basil-nails",
      title: "Basil nail trim",
      payload: { ...entry("leo-checkup").payload, title: "Basil nail trim", pet: entry("basil").id, scheduledAt: "2026-09-20T17:00:00Z" },
    });
    const { router } = renderRoute("/views/clinic.schedule?date=2026-09-20");
    expect(await screen.findByText("Leo checkup")).toBeInTheDocument();
    expect(screen.queryByText("Basil nail trim")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("schedule-next"));
    await waitFor(() => expect(router.state.location.search).toBe("?date=2026-09-21"));
    const visit = (await screen.findByText("Basil nail trim")).closest("a")!;
    expect(within(visit).getByTestId("schedule-time")).toHaveTextContent("01:00");
    fireEvent.click(screen.getByTestId("schedule-today"));
    await waitFor(() => expect(router.state.location.search).toBe(""));
  });

  it("W2-FM16 an invalid ?date= shows the local today", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-19T23:30:00Z"));
    setUser("seed-operator-clinic");
    renderRoute("/views/clinic.schedule?date=2026-02-30");
    expect(await screen.findByTestId("schedule-day")).toHaveTextContent("2026年9月20日 星期日");
  });

  it("G-10 each visit shows its time, pet and vet names from include=refs, the visit kind label and a status badge", async () => {
    setUser("seed-operator-clinic");
    const requests = recordRequests();
    renderRoute("/views/clinic.schedule?date=2026-03-01");
    const visit = (await screen.findByText("Leo rabies shot")).closest("a")!;
    expect(visit).toHaveAttribute("href", `/entries/visit/${entry("leo-rabies").id}`);
    expect(within(visit).getByTestId("schedule-time")).toHaveTextContent("18:00");
    expect(visit).toHaveTextContent("寵物Leo");
    expect(visit).toHaveTextContent("獸醫James Carter");
    expect(visit).toHaveTextContent("疫苗");
    expect(screen.queryByText("Leo checkup")).not.toBeInTheDocument();
    expect(within(visit).getAllByTestId("status-badge")).toHaveLength(1);
    expect(within(visit).getByTestId("status-badge")).toHaveTextContent("已發布");
    expect(requests.filter((r) => r.path.startsWith("/api/v1/entries/"))).toEqual([]);
    fireEvent.click(screen.getByTestId("schedule-previous"));
    expect(await screen.findByTestId("schedule-empty")).toHaveTextContent("這一天沒有就診");
  });
});

describe("projects.board (B-S6, C-10, U-03, V2-AC-12)", () => {
  it("C-10 ?project= follows the URL both ways", async () => {
    setUser("seed-operator-projects");
    const { router } = renderRoute(`/views/projects.board?project=${entry("internal-ops").id}`);
    await inColumn("backlog", "Secret infra task");
    expect(screen.getByLabelText("專案")).toHaveTextContent("Internal Ops");
    await router.navigate(`/views/projects.board?project=${entry("cms-scaffold").id}`);
    await inColumn("ready", "Kanban DnD");
    expect(screen.getByLabelText("專案")).toHaveTextContent("CMS Scaffold");
    await choose("專案", "Internal Ops");
    await waitFor(() => expect(router.state.location.search).toBe(`?project=${entry("internal-ops").id}`));
    await inColumn("backlog", "Secret infra task");
  });

  it("T-BO-05 AC-BOARD-01 columns are the status enumLabels with counts; 移到 writes status only and never publishes", async () => {
    setUser("seed-operator-projects");
    const requests = recordRequests();
    renderRoute(`/views/projects.board?project=${entry("cms-scaffold").id}`);
    await inColumn("ready", "Kanban DnD");
    expect(screen.getAllByTestId(/^board-column-/).map((r) => r.getAttribute("aria-label"))).toEqual(["待辦", "就緒", "進行中", "審查中", "完成"]);
    expect(within(column("in_review")).getByRole("heading")).toHaveTextContent("審查中（0）");
    open(screen.getByRole("button", { name: "「Kanban DnD」的動作" }));
    open(await screen.findByTestId("board-move"));
    fireEvent.keyDown(await screen.findByTestId("board-move-in_progress"), { key: "Enter" });
    await waitFor(() => expect(within(column("in_progress")).getByText("Kanban DnD")).toBeInTheDocument());
    expect(await screen.findByText("已把「Kanban DnD」移到「進行中」")).toBeInTheDocument();
    expect(writes(requests)).toEqual([
      { method: "PATCH", path: `/api/v1/entries/${entry("kanban-dnd").id}`, search: "", body: { version: 1, payload: { status: "in_progress" } } },
    ]);
    expect(entry("kanban-dnd").publicationState).toBe("draft");
  });

  it("V2-AC-12 when the move fails the card goes back to its column and a toast says so", async () => {
    setUser("seed-operator-projects");
    setScenario("conflict");
    renderRoute(`/views/projects.board?project=${entry("cms-scaffold").id}`);
    await inColumn("ready", "Kanban DnD");
    open(screen.getByRole("button", { name: "「Kanban DnD」的動作" }));
    open(await screen.findByTestId("board-move"));
    fireEvent.keyDown(await screen.findByTestId("board-move-done"), { key: "Enter" });
    expect(await screen.findByText("沒有移動成功，卡片已回到原本的欄位。")).toBeInTheDocument();
    await waitFor(() => expect(within(column("ready")).getByText("Kanban DnD")).toBeInTheDocument());
    expect(within(column("done")).queryByText("Kanban DnD")).not.toBeInTheDocument();
  });

  it("篩選標題 narrows the cards; archived issues show only with 顯示已封存", async () => {
    setUser("seed-operator-projects");
    entry("private-project-leak-test").publicationState = "archived";
    const requests = recordRequests();
    renderRoute(`/views/projects.board?project=${entry("cms-scaffold").id}`);
    await inColumn("ready", "Kanban DnD");
    expect(screen.queryByText("Private project leak test")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("switch", { name: "顯示已封存" }));
    await inColumn("backlog", "Private project leak test");
    expect(requests.some((r) => r.search.includes("state=draft,published,archived"))).toBe(true);
    fireEvent.change(screen.getByLabelText("篩選標題"), { target: { value: "kanban" } });
    expect(screen.getAllByTestId("board-card")).toHaveLength(1);
  });
});

describe("complete composition reads and atomic request bounds", () => {
  it("reads every composer photo and refuses more than 100 changed items before sending an atomic batch", async () => {
    setUser("seed-operator-album");
    const template = entry("coast-harbour");
    for (let i = 0; i < 100; i += 1) db.workEntries.push({ ...template, id: `30000000-0000-4000-8000-${String(1500 + i).padStart(12, "0")}`, slug: `extra-photo-${i}`, title: `Extra photo ${i}`, payload: { ...template.payload, title: `Extra photo ${i}`, sortOrder: 61 + i } });
    const requests = recordRequests();
    renderRoute(`/views/album.composer?album=${entry("coast-light-2026").id}`);
    await waitFor(() => expect(screen.getAllByTestId("composer-photo")).toHaveLength(106));
    const before = photoTitles();
    open(screen.getByRole("button", { name: "「Harbour wall」的動作" }));
    fireEvent.click(await screen.findByTestId("composer-right"));
    expect(await screen.findByText("這次排序需要更新超過 100 張相片，請縮小移動範圍後再試。")).toBeInTheDocument();
    expect(photoTitles()).toEqual(before);
    expect(writes(requests)).toEqual([]);
    expect(requests.some((r) => r.path.endsWith("/photo/entries") && r.search.includes("page=2"))).toBe(true);
  });

  it("an album beyond the first page remains selectable through its URL", async () => {
    setUser("seed-operator-album");
    const template = entry("coast-light-2026");
    for (let i = 0; i < 101; i += 1) db.workEntries.push({ ...template, id: `30000000-0000-4000-8000-${String(1700 + i).padStart(12, "0")}`, slug: `extra-album-${i}`, title: `Extra album ${i}`, updatedAt: "2020-01-01T00:00:00Z" });
    const last = db.workEntries.at(-1)!;
    const requests = recordRequests();
    renderRoute(`/views/album.composer?album=${last.id}`);
    await waitFor(() => expect(screen.getByLabelText("相簿")).toHaveTextContent(last.title!));
    expect(await screen.findByTestId("composer-empty")).toBeInTheDocument();
    expect(requests.some((r) => r.path.endsWith("/album/entries") && r.search.includes("page=2"))).toBe(true);
  });
});

describe("view limits", () => {
  it("W2-FM17 more than 100 issues: the board shows the first 100 and says so", async () => {
    setUser("seed-operator-projects");
    const base = entry("kanban-dnd");
    for (let i = 0; i < 100; i += 1) db.workEntries.push({ ...base, id: `30000000-0000-4000-8000-${String(500 + i).padStart(12, "0")}`, slug: `extra-${i}`, title: `Extra ${i}` });
    renderRoute(`/views/projects.board?project=${entry("cms-scaffold").id}`);
    expect(await screen.findByText("這個專案超過 100 筆議題，只列出前 100 筆。")).toBeInTheDocument();
    expect(screen.getAllByTestId("board-card")).toHaveLength(100);
  });
});

describe("U-01 V2-AC-15 no engineering words on screen", () => {
  it("no copy string contains an engineering word", () => {
    const offenders = Object.entries(copy).filter(([, text]) => FORBIDDEN_WORDS.some((word) => text.includes(word)));
    expect(offenders).toEqual([]);
  });

  const pages: [string, string, () => string][] = [
    ["home", "seed-admin", () => "/"],
    ["index", "seed-operator-album", () => "/entries/photo"],
    ["details", "seed-operator-album", () => `/entries/photo/${entry("coast-harbour").id}`],
    ["preview", "seed-operator-album", () => `/entries/photo/${entry("coast-harbour").id}/preview`],
    ["history", "seed-operator-album", () => `/entries/photo/${entry("coast-harbour").id}/history`],
    ["media", "seed-operator-album", () => "/media"],
    ["composer", "seed-operator-album", () => `/views/album.composer?album=${entry("coast-light-2026").id}`],
    ["schedule", "seed-operator-clinic", () => "/views/clinic.schedule?date=2026-03-01"],
    ["board", "seed-operator-projects", () => "/views/projects.board"],
  ];
  it.each(pages)("%s shows none of PATCH, sortOrder, origin, (string)", async (_, user, path) => {
    setUser(user);
    renderRoute(path());
    await screen.findByTestId("page-header");
    await waitFor(() => expect(screen.queryAllByTestId(/query-loading|index-row-loading|picker-loading/)).toEqual([]));
    const text = document.body.textContent ?? "";
    expect(FORBIDDEN_WORDS.filter((word) => text.includes(word))).toEqual([]);
  });
});
