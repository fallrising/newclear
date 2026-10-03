import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { db, setUser } from "@cms/mocks";
import { describe, expect, it } from "vitest";
import { copy } from "./copy";
import { FORBIDDEN_WORDS } from "./test-helpers";
import { recordRequests, renderRoute } from "./test-utils";

const slugId = (slug: string) => db.workEntries.find((e) => e.slug === slug)!.id;

describe("CMS Back custom views (W1 wording; W2 redoes the behaviour)", () => {
  it("E-01 album.composer reorders photos with two sortOrder writes and says so without field names", async () => {
    setUser("seed-operator-album");
    const requests = recordRequests();
    renderRoute("/views/album.composer");
    // Albums are listed newest first (G-02 default sort), so pick the one with photos.
    await screen.findByRole("option", { name: "Coast Light 2026" });
    fireEvent.change(screen.getByLabelText("相簿"), { target: { value: slugId("coast-light-2026") } });
    expect(await screen.findByText("Harbour wall")).toBeInTheDocument();
    expect(screen.getAllByText(/^第 \d+ 張/).map((p) => p.textContent?.split(" · ")[0])).toEqual(["第 1 張", "第 2 張", "第 3 張", "第 4 張", "第 5 張", "第 6 張"]);
    const photoVersions = db.workEntries.filter((entry) => entry.contentType === "photo").slice(0, 2).map((entry) => entry.version);
    fireEvent.click(screen.getAllByRole("button", { name: "下移" })[0]);
    await waitFor(() => expect(requests.filter((r) => r.method === "PATCH")).toHaveLength(2));
    expect(requests.filter((r) => r.method === "PATCH").map((p) => p.body)).toEqual([
      { payload: { sortOrder: 20 }, version: photoVersions[0] },
      { payload: { sortOrder: 10 }, version: photoVersions[1] },
    ]);
    expect(await screen.findByText("已更新順序")).toBeInTheDocument();
  });

  it("E-01 clinic.schedule lists the day's visits with the visit kind label and a status badge", async () => {
    setUser("seed-operator-clinic");
    renderRoute("/views/clinic.schedule");
    fireEvent.change(await screen.findByLabelText("日期"), { target: { value: "2026-03-01" } });
    const visit = (await screen.findByText("Leo rabies shot")).closest("a")!;
    expect(within(visit).getByTestId("status-badge")).toHaveTextContent("已發布");
    expect(screen.queryByText("Leo checkup")).not.toBeInTheDocument();
  });

  it("T-BO-05 G-06 the board's columns are the status enumLabels; a move writes status only and never publishes", async () => {
    setUser("seed-operator-projects");
    const requests = recordRequests();
    renderRoute(`/views/projects.board?project=${slugId("cms-scaffold")}`);
    await screen.findByText("Kanban DnD");
    expect(screen.getAllByTestId(/^board-column-/).map((r) => r.getAttribute("aria-label"))).toEqual(["待辦", "就緒", "進行中", "審查中", "完成"]);
    fireEvent.change(screen.getByLabelText("「Kanban DnD」的狀態"), { target: { value: "in_progress" } });
    const column = await screen.findByRole("region", { name: "進行中" });
    await waitFor(() => expect(within(column).getByText("Kanban DnD")).toBeInTheDocument());
    const writes = requests.filter((r) => r.method !== "GET" && r.path !== "/api/v1/auth/csrf");
    expect(writes).toEqual([{ method: "PATCH", path: expect.stringMatching(/^\/api\/v1\/entries\//), search: "", body: { payload: { status: "in_progress" }, version: 1 } }]);
    expect(await screen.findByText("已把「Kanban DnD」移到「進行中」")).toBeInTheDocument();
  });
});

describe("U-01 V2-AC-15 no engineering words on screen", () => {
  it("no copy string contains an engineering word", () => {
    const offenders = Object.entries(copy).filter(([, text]) => FORBIDDEN_WORDS.some((word) => text.includes(word)));
    expect(offenders).toEqual([]);
  });

  const pages: [string, string, string][] = [
    ["home", "seed-admin", "/"],
    ["index", "seed-operator-album", "/entries/photo"],
    ["details", "seed-operator-album", "/entries/photo/"],
    ["composer", "seed-operator-album", "/views/album.composer"],
    ["schedule", "seed-operator-clinic", "/views/clinic.schedule"],
    ["board", "seed-operator-projects", "/views/projects.board"],
  ];
  it.each(pages)("%s shows none of PATCH, sortOrder, origin, (string)", async (_, user, path) => {
    setUser(user);
    const target = path.endsWith("/") ? `${path}${db.workEntries.find((e) => e.slug === "coast-harbour")!.id}` : path;
    renderRoute(target);
    await screen.findByTestId("page-header");
    await waitFor(() => expect(screen.queryAllByTestId(/query-loading|index-row-loading/)).toEqual([]));
    const text = document.body.textContent ?? "";
    expect(FORBIDDEN_WORDS.filter((word) => text.includes(word))).toEqual([]);
  });
});
