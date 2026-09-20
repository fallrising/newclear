import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const publicEntries = vi.fn();
const publicBySlug = vi.fn();
const publicById = vi.fn();

vi.mock("./api", () => ({
  api: {
    base: "http://localhost:8080",
    publicEntries: (...args: unknown[]) => publicEntries(...args),
    publicBySlug: (...args: unknown[]) => publicBySlug(...args),
    publicById: (...args: unknown[]) => publicById(...args),
    login: vi.fn(),
    csrf: vi.fn(),
  },
}));

import App from "./App";

const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "App.tsx"), "utf8");

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

describe("CMS Front", () => {
  beforeEach(() => {
    cleanup();
    publicEntries.mockReset();
    publicBySlug.mockReset();
    publicById.mockReset();
  });

  it("T-FO-01 unpublished album URL is an empty/404 state without draft fields", async () => {
    publicBySlug.mockRejectedValue(new Error("not found"));
    renderAt("/album/albums/private-studio");
    expect(await screen.findByRole("heading", { name: "找不到相簿" })).toBeInTheDocument();
    expect(screen.getByText(/尚未發布/)).toBeInTheDocument();
    expect(screen.queryByText(/publicationState|draft/i)).not.toBeInTheDocument();
  });

  it("T-FO-02 album list only calls the public published API", async () => {
    publicEntries.mockResolvedValue({
      items: [{ id: "1", contentType: "album", slug: "coast-light-2026", title: "Coast Light 2026", payload: {} }],
    });
    renderAt("/album");
    await waitFor(() => expect(publicEntries).toHaveBeenCalled());
    expect(publicEntries).toHaveBeenCalledWith("album");
    expect(source).toContain('api.publicEntries("album")');
    expect(source).not.toContain("/api/v1/entries");
    expect(source).not.toContain("includeDraft");
    expect(await screen.findByText("Coast Light 2026")).toBeInTheDocument();
  });

  it("T-FO-03 unlisted albums are not in the index but a known slug is readable", async () => {
    publicEntries.mockResolvedValue({
      items: [{ id: "1", contentType: "album", slug: "coast-light-2026", title: "Coast Light 2026", payload: {} }],
    });
    renderAt("/album");
    expect(await screen.findByText("Coast Light 2026")).toBeInTheDocument();
    expect(screen.queryByText("Unlisted proof")).not.toBeInTheDocument();

    publicBySlug.mockResolvedValue({
      id: "2",
      contentType: "album",
      slug: "unlisted-proof",
      title: "Unlisted proof",
      payload: { visibility: "unlisted" },
    });
    publicEntries.mockResolvedValue({ items: [] });
    renderAt("/album/albums/unlisted-proof");
    expect(await screen.findByText("Unlisted proof")).toBeInTheDocument();
  });
});
