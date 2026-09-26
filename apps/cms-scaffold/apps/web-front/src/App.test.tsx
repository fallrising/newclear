import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { setScenario } from "@cms/mocks";
import { describe, expect, it } from "vitest";
import { recordRequests, renderRoute } from "./test-utils";

const SRC = join(__dirname);

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$|test-(setup|utils)\.tsx?$/.test(name) ? [path] : [];
  });
}

describe("CMS Front", () => {
  it("T-FO-01 an unpublished album URL shows the not-found state without draft fields", async () => {
    renderRoute("/album/albums/private-studio");
    expect(await screen.findByRole("heading", { level: 1, name: "找不到相簿" })).toBeInTheDocument();
    expect(screen.getByText("這本相簿不存在或尚未發布。")).toBeInTheDocument();
    expect(screen.queryByText(/Studio \(unpublished\)|publicationState|draft/i)).not.toBeInTheDocument();
  });

  it("T-FO-02 AC-02 the album list only calls /api/v1/public", async () => {
    const paths = recordRequests();
    renderRoute("/album");
    expect(await screen.findByText("Coast Light 2026")).toBeInTheDocument();
    expect(paths.length).toBeGreaterThan(0);
    expect(paths.every((p) => p.startsWith("/api/v1/public/"))).toBe(true);
  });

  it("T-FO-03 an unlisted album is not listed but its slug is readable", async () => {
    renderRoute("/album");
    expect(await screen.findByText("Coast Light 2026")).toBeInTheDocument();
    expect(screen.queryByText("Unlisted proof")).not.toBeInTheDocument();
    renderRoute("/album/albums/unlisted-proof");
    expect(await screen.findByRole("heading", { level: 1, name: "Unlisted proof" })).toBeInTheDocument();
  });

  it("F-05 a detail page sets document.title to '<title> · <site>'", async () => {
    renderRoute("/album/albums/coast-light-2026");
    expect(await screen.findAllByTestId("photo-tile")).toHaveLength(6);
    expect(document.title).toBe("Coast Light 2026 · 相簿");
  });

  it("C-02 an empty list shows the empty copy once loaded", async () => {
    setScenario("empty");
    renderRoute("/projects");
    expect(await screen.findByTestId("empty-state")).toHaveTextContent("還沒有公開專案");
  });

  it("C-03 a 500 on a list shows the error with retry, not the empty state", async () => {
    setScenario("error500");
    renderRoute("/clinic");
    expect(await screen.findAllByTestId("query-error")).not.toHaveLength(0);
    expect(screen.queryByTestId("empty-state")).not.toBeInTheDocument();
  });

  it("S-01 AC-13 login ignores an external next and lands on /", async () => {
    const { router } = renderRoute("/login?next=https%3A%2F%2Fevil.example%2Fsteal");
    fireEvent.change(await screen.findByLabelText("帳號"), { target: { value: "seed-member-clinic" } });
    fireEvent.change(screen.getByLabelText("密碼"), { target: { value: "pw" } });
    fireEvent.click(screen.getByTestId("login-submit"));
    await waitFor(() => expect(router.state.location.pathname).toBe("/"));
    expect(await screen.findByRole("heading", { level: 1, name: "CMS Scaffold" })).toBeInTheDocument();
  });

  it("AC-08 web-front source imports @cms/api only through @cms/api/public", () => {
    const offenders = sources(SRC).filter((file) => /from "@cms\/api"/.test(readFileSync(file, "utf8")));
    expect(offenders).toEqual([]);
  });
});
