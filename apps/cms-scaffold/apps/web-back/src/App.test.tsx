import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { db, setScenario, setUser } from "@cms/mocks";
import { describe, expect, it } from "vitest";
import { copy } from "./copy";
import { recordRequests, renderRoute } from "./test-utils";

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$|test-(setup|utils)\.tsx?$/.test(name) ? [path] : [];
  });
}
const source = sources(__dirname).map((f) => readFileSync(f, "utf8")).join("\n");
const studio = () => db.workEntries.find((e) => e.slug === "private-studio")!;

describe("CMS Back shell", () => {
  it("T-BO-01 has no Admin / content-type / settings navigation", async () => {
    setUser("seed-operator-album");
    renderRoute("/");
    expect(await screen.findByRole("heading", { level: 1, name: "作業台" })).toBeInTheDocument();
    expect(screen.queryByText("內容類型")).not.toBeInTheDocument();
    expect(screen.queryByText("系統設定")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Admin" })).not.toBeInTheDocument();
    expect(source).not.toContain('to="/admin"');
  });

  it("T-BO-03 W0-FM03 a member cannot enter Back work routes", async () => {
    setUser("seed-member-clinic");
    renderRoute("/");
    expect(await screen.findByRole("heading", { level: 1, name: "沒有權限" })).toBeInTheDocument();
    expect(screen.queryByText("作業台")).not.toBeInTheDocument();
  });

  it("C-17 W0-FM01 an anonymous deep link goes to /sign-in?returnTo=… and /auth/me is read once", async () => {
    const requests = recordRequests();
    const { router } = renderRoute("/entries/album");
    await waitFor(() => expect(router.state.location.pathname).toBe("/sign-in"));
    expect(router.state.location.search).toBe("?returnTo=%2Fentries%2Falbum");
    expect(requests.filter((r) => r.path === "/api/v1/auth/me")).toHaveLength(1);
  });

  it("01 §13.2 /login redirects to /sign-in and keeps the query", async () => {
    const { router } = renderRoute("/login?returnTo=%2Fentries%2Falbum");
    await waitFor(() => expect(router.state.location.pathname).toBe("/sign-in"));
    expect(router.state.location.search).toBe("?returnTo=%2Fentries%2Falbum");
  });

  it("F-05 E-01 the shell is AppFrame and the page title reaches document.title", async () => {
    setUser("seed-operator-album");
    renderRoute("/entries/album");
    expect(await screen.findByText("Coast Light 2026")).toBeInTheDocument();
    expect(screen.getByTestId("product-name")).toHaveTextContent("CMS 作業台");
    expect(document.title).toBe("album · CMS 作業台");
  });
});

describe("CMS Back editor", () => {
  it("T-BO-02 an editor does not see Publish; an operator does", async () => {
    setUser("seed-editor-album");
    renderRoute(`/entries/album/${studio().id}`);
    expect(await screen.findByLabelText("title (string)")).toHaveValue("Studio (unpublished)");
    expect(screen.queryByRole("button", { name: "發布" })).not.toBeInTheDocument();
  });

  it("T-BO-02 an operator publishes and the editor shows the new state", async () => {
    setUser("seed-operator-album");
    renderRoute(`/entries/album/${studio().id}`);
    fireEvent.click(await screen.findByRole("button", { name: "發布" }));
    expect(await screen.findByTestId("editor-notice")).toHaveTextContent("published");
  });

  it("W0-FM07 a 409 on save shows the error and keeps the typed value", async () => {
    setUser("seed-operator-album");
    setScenario("conflict");
    renderRoute(`/entries/album/${studio().id}`);
    const title = await screen.findByLabelText("title (string)");
    fireEvent.change(title, { target: { value: "Studio renamed" } });
    fireEvent.click(screen.getByRole("button", { name: "儲存草稿" }));
    expect(await screen.findByText("操作失敗")).toBeInTheDocument();
    expect(screen.getByLabelText("title (string)")).toHaveValue("Studio renamed");
  });

  it("T-BO-04 preview stays on the work API, not the Front origin", () => {
    expect(copy["editor.previewNote"]).toContain("草稿預覽留在 Back");
    expect(source).not.toContain("localhost:5173");
    expect(source).not.toContain("web-front");
  });

  it("S-03 two writes fetch the CSRF token at most once", async () => {
    setUser("seed-operator-album");
    const requests = recordRequests();
    renderRoute(`/entries/album/${studio().id}`);
    fireEvent.click(await screen.findByRole("button", { name: "發布" }));
    await screen.findByTestId("editor-notice");
    fireEvent.click(screen.getByRole("button", { name: "下架" }));
    await waitFor(() => expect(screen.getByTestId("editor-notice")).toHaveTextContent("draft"));
    // The token lives in the module-level client, so an earlier test may already have fetched it.
    expect(requests.filter((r) => r.path === "/api/v1/auth/csrf").length).toBeLessThanOrEqual(1);
    expect(requests.filter((r) => r.method === "POST")).toHaveLength(2);
  });
});

describe("CMS Back custom views", () => {
  it("E-01 album.composer (v1 behaviour) reorders photos with two PATCH sortOrder writes", async () => {
    setUser("seed-operator-album");
    const requests = recordRequests();
    renderRoute("/views/album.composer");
    expect(await screen.findByText("Harbour wall")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "下移" })[0]);
    await waitFor(() => expect(requests.filter((r) => r.method === "PATCH")).toHaveLength(2));
    const patches = requests.filter((r) => r.method === "PATCH");
    expect(patches.map((p) => p.body)).toEqual([
      { payload: { sortOrder: 20 }, version: 2 },
      { payload: { sortOrder: 10 }, version: 2 },
    ]);
    expect(source).not.toContain("/albums");
  });

  it("E-01 clinic.schedule (v1 behaviour) lists visits for the selected day from generic entries", async () => {
    setUser("seed-operator-clinic");
    renderRoute("/views/clinic.schedule");
    fireEvent.change(await screen.findByLabelText("日期"), { target: { value: "2026-03-01" } });
    expect(await screen.findByText("Leo rabies shot")).toBeInTheDocument();
    expect(screen.queryByText("Leo checkup")).not.toBeInTheDocument();
  });

  it("T-BO-05 the board moves a card with PATCH status and never publishes", async () => {
    setUser("seed-operator-projects");
    const requests = recordRequests();
    renderRoute("/views/projects.board");
    const select = await screen.findByLabelText("狀態 Kanban DnD");
    fireEvent.change(select, { target: { value: "in_progress" } });
    const column = await screen.findByRole("region", { name: "in_progress" });
    await waitFor(() => expect(within(column).getByText("Kanban DnD")).toBeInTheDocument());
    const writes = requests.filter((r) => r.method !== "GET");
    expect(writes).toEqual([{ method: "PATCH", path: expect.stringMatching(/^\/api\/v1\/entries\//), body: { payload: { status: "in_progress" }, version: 1 } }]);
    expect(source).not.toContain("/boards");
    expect(source).not.toContain("/kanban");
  });
});
