import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { setUser } from "@cms/mocks";
import { describe, expect, it } from "vitest";
import { recordRequests, renderRoute } from "./test-utils";

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$|test-(setup|utils)\.tsx?$/.test(name) ? [path] : [];
  });
}
const source = sources(__dirname).map((f) => readFileSync(f, "utf8")).join("\n");

describe("CMS Admin", () => {
  it("T-AC-01 is governance only: no day-to-day board / clinic / writing bench", async () => {
    setUser("seed-admin");
    renderRoute("/");
    expect(await screen.findByRole("heading", { level: 1, name: "治理台" })).toBeInTheDocument();
    expect(screen.getByText(/日常編輯請用 Back office/)).toBeInTheDocument();
    expect(screen.getByTestId("admin-accent")).toBeInTheDocument();
    expect(source).not.toContain("/entries/");
    expect(source).not.toContain("看板");
    expect(source).not.toContain("看診");
    expect(source).not.toContain("kanban");
  });

  it("T-AC-02 W0-FM03 non-admin users/types routes fail closed without calling governance APIs", async () => {
    setUser("seed-operator-album");
    const requests = recordRequests();
    renderRoute("/users");
    expect(await screen.findByRole("heading", { level: 1, name: "沒有權限" })).toBeInTheDocument();
    cleanup();
    renderRoute("/types");
    expect(await screen.findByRole("heading", { level: 1, name: "沒有權限" })).toBeInTheDocument();
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
    const { router } = renderRoute("/types");
    await waitFor(() => expect(router.state.location.pathname).toBe("/login"));
    expect(router.state.location.search).toBe("?next=%2Ftypes");
  });

  it("E-01 (v1 behaviour) disables and re-enables a content type", async () => {
    setUser("seed-admin");
    renderRoute("/types");
    const visit = await screen.findByTestId("type-visit");
    fireEvent.click(within(visit).getByRole("button", { name: "停用" }));
    expect(await within(screen.getByTestId("type-visit")).findByRole("button", { name: "啟用" })).toBeInTheDocument();
  });

  it("F-05 lists principals and sets the title", async () => {
    setUser("seed-admin");
    renderRoute("/users");
    expect(await screen.findByText(/seed-operator-album · Album operator · active/)).toBeInTheDocument();
    expect(document.title).toBe("使用者 · Admin center");
  });
});
