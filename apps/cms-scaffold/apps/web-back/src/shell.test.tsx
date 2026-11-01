import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { screen, waitFor, within } from "@testing-library/react";
import { db, setUser } from "@cms/mocks";
import { describe, expect, it } from "vitest";
import { recordRequests, renderRoute } from "./test-utils";

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$|test-(setup|utils|helpers)\.tsx?$/.test(name) ? [path] : [];
  });
}
const files = sources(__dirname);
const source = files.map((f) => readFileSync(f, "utf8")).join("\n");

/** Waits until the side navigation lists exactly `expected` (type labels arrive with the schema list). */
async function expectNav(expected: string[]) {
  const nav = await screen.findByRole("navigation", { name: "主要導覽" });
  await waitFor(() => expect(within(nav).getAllByRole("link").map((a) => a.textContent)).toEqual(expected));
}

describe("CMS Back shell (W1)", () => {
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

  it("C-07 U-02 G-01 the nav lists workable types by pluralDisplayName, then the views they allow", async () => {
    setUser("seed-editor-album");
    renderRoute("/");
    // Editor-album may read clinic_profile, page… published only (read_published): not workable, not listed.
    await expectNav(["首頁", "Albums", "Photos", "相簿編排", "媒體庫"]);
  });

  it("C-07 an admin gets every type and all three views", async () => {
    setUser("seed-admin");
    renderRoute("/");
    await expectNav(["首頁", "Albums", "Clinic profiles", "Issues", "Milestones", "Notes", "Owners", "Pages", "Pets", "Photos", "Projects", "Vets", "Visits", "相簿編排", "當日行程", "看板", "媒體庫"]);
  });

  it("V2-AC-10 a notes-only fixture user sees only Notes, and its list and editor work without code changes", async () => {
    setUser("mock-operator-notes");
    const { router } = renderRoute("/");
    await expectNav(["首頁", "Notes", "媒體庫"]);
    expect(await screen.findByTestId("home-type-note")).toHaveTextContent("Notes");
    expect(screen.queryByTestId("home-view-album.composer")).not.toBeInTheDocument();
    await router.navigate("/entries/note");
    expect(await screen.findByRole("link", { name: "Ideas for spring" })).toBeInTheDocument();
    await router.navigate(`/entries/note/${db.workEntries.find((e) => e.slug === "buy-film")!.id}`);
    expect(await screen.findByLabelText(/^標題/)).toHaveValue("Buy film");
  });

  it("F-05 E-01 the shell is AppFrame and the page title reaches document.title", async () => {
    setUser("seed-operator-album");
    renderRoute("/entries/album");
    expect(await screen.findByText("Coast Light 2026")).toBeInTheDocument();
    expect(screen.getByTestId("product-name")).toHaveTextContent("CMS 作業台");
    expect(document.title).toBe("Albums · CMS 作業台");
  });

  it("01 §8 a type without read_draft goes to /forbidden, an unknown type or route to /not-found", async () => {
    setUser("seed-editor-album");
    const { router } = renderRoute("/entries/visit");
    await waitFor(() => expect(router.state.location.pathname).toBe("/forbidden"));
    expect(await screen.findByTestId("forbidden")).toBeInTheDocument();
    await router.navigate("/entries/nope");
    await waitFor(() => expect(router.state.location.pathname).toBe("/not-found"));
    expect(await screen.findByTestId("not-found")).toBeInTheDocument();
    await router.navigate("/something/else");
    expect(await screen.findByTestId("not-found")).toBeInTheDocument();
  });

  it("T-BO-04 drafts never leave Back: only front-links.ts knows the public origin (used for published entries)", () => {
    const others = files.filter((f) => !/front-links\.ts$|\.d\.ts$/.test(f)).map((f) => readFileSync(f, "utf8")).join("\n");
    expect(others).not.toContain("VITE_FRONT_ORIGIN");
    expect(others).not.toContain("localhost:5173");
    expect(others).not.toContain("web-front");
  });
});
