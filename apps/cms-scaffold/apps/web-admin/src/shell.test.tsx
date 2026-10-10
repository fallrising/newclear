import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import { fixtures, setScenario, setUser } from "@cms/mocks";
import { describe, expect, it } from "vitest";
import { FORBIDDEN_WORDS, recordRequests, renderRoute } from "./test-utils";

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$|test-(setup|utils)\.tsx?$/.test(name) ? [path] : [];
  });
}
const source = sources(__dirname).map((f) => readFileSync(f, "utf8")).join("\n");

async function navLinks() {
  const nav = await screen.findByRole("navigation", { name: "主要導覽" });
  return within(nav).getAllByRole("link").map((a) => a.textContent);
}

describe("web-admin shell", () => {
  it("T-AC-01 is governance only: no field editor, board, schedule or writing bench", async () => {
    setUser("seed-admin");
    renderRoute("/");
    expect(await screen.findByRole("heading", { level: 1, name: "總覽" })).toBeInTheDocument();
    expect(screen.getByText(/日常編輯請用 Back office/)).toBeInTheDocument();
    expect(screen.getByTestId("admin-accent")).toBeInTheDocument();
    expect(source).not.toContain("@cms/fields");
    expect(source).not.toContain("看板");
    expect(source).not.toContain("看診");
    expect(source).not.toContain("kanban");
  });

  it("surface-admin §4.3 the side menu lists the seven governance items in order", async () => {
    setUser("seed-admin");
    renderRoute("/");
    expect(await navLinks()).toEqual(["總覽", "內容類型", "角色與權限", "使用者", "審計", "媒體與儲存", "設定"]);
  });

  it("AC-A T-AC-02 W0-FM03 non-admin users see the forbidden page and no governance API is called", async () => {
    setUser("seed-operator-album");
    const requests = recordRequests();
    for (const path of ["/principals", "/types", "/roles/editor", "/audit"]) {
      renderRoute(path);
      expect(await screen.findByRole("heading", { level: 1, name: "沒有權限" })).toBeInTheDocument();
      expect(screen.queryByTestId("index-table")).not.toBeInTheDocument();
      cleanup();
    }
    expect(requests.map((r) => r.path).filter((p) => p !== "/api/v1/auth/me")).toEqual([]);
  });

  it("S-02 the forbidden page names no seed account", async () => {
    setUser("seed-operator-album");
    renderRoute("/");
    expect(await screen.findByRole("heading", { level: 1, name: "沒有權限" })).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("seed-");
    expect(source).not.toContain("seed-");
  });

  it("C-17 W0-FM01 anonymous users go to /login?next=<path>", async () => {
    const { router } = renderRoute("/principals/new");
    await waitFor(() => expect(router.state.location.pathname).toBe("/login"));
    expect(router.state.location.search).toBe("?next=%2Fprincipals%2Fnew");
  });

  it("W4-FM03 an admin-surface user without a capability gets /403 and the item leaves the menu", async () => {
    const global = fixtures.capabilities["seed-admin"].admin.global;
    const saved = [...global];
    global.splice(global.indexOf("read_audit"), 1);
    try {
      setUser("seed-admin");
      const { router } = renderRoute("/audit");
      await waitFor(() => expect(router.state.location.pathname).toBe("/403"));
      expect(await screen.findByTestId("forbidden")).toBeInTheDocument();
      expect(await navLinks()).not.toContain("審計");
      expect(screen.queryByTestId("overview-audit")).not.toBeInTheDocument();
    } finally {
      global.splice(0, global.length, ...saved);
    }
  });

  it("AC-I W4-FM04 /impersonate and unknown paths are the 404 page", async () => {
    setUser("seed-admin");
    renderRoute("/impersonate");
    expect(await screen.findByTestId("not-found")).toBeInTheDocument();
    cleanup();
    renderRoute("/types/new/fields");
    expect(await screen.findByTestId("not-found")).toBeInTheDocument();
  });

  it("A-S1 AC-L the overview shows the three summaries and the latest events; zero types is an empty state", async () => {
    setUser("seed-admin");
    renderRoute("/");
    expect(await within(await screen.findByTestId("overview-types")).findByText("12 個，0 個停用")).toBeInTheDocument();
    expect(await within(screen.getByTestId("overview-principals")).findByText("10 位，0 位停用或鎖定")).toBeInTheDocument();
    expect(await within(screen.getByTestId("overview-media")).findByText("32.1 KB / 1 GB")).toBeInTheDocument();
    expect(await screen.findAllByTestId("overview-audit-row")).toHaveLength(10);
    expect(screen.getAllByTestId("overview-audit-row")[0]).toHaveTextContent("停用內容類型");
    for (const word of FORBIDDEN_WORDS) expect(document.body.textContent).not.toContain(word);
    cleanup();
    setScenario("empty");
    renderRoute("/");
    expect(await screen.findByTestId("overview-no-types")).toHaveTextContent("尚未載入 demo pack 種子");
  });

  it("C-02 the overview never shows the empty copy while loading", async () => {
    setUser("seed-admin");
    setScenario("slow");
    renderRoute("/");
    expect(await screen.findByRole("heading", { level: 1, name: "總覽" }, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.getAllByTestId("query-loading").length).toBeGreaterThan(0);
    expect(screen.queryByText("還沒有審計事件。")).not.toBeInTheDocument();
    expect(screen.queryByTestId("overview-no-types")).not.toBeInTheDocument();
  });
});
