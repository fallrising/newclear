import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Me } from "@cms/api";

const me = vi.fn();
const type = vi.fn();
const getEntry = vi.fn();
const publish = vi.fn();

vi.mock("./api", () => ({
  api: {
    base: "http://localhost:8080",
    me: (...args: unknown[]) => me(...args),
    csrf: vi.fn(),
    logout: vi.fn(),
    type: (...args: unknown[]) => type(...args),
    getEntry: (...args: unknown[]) => getEntry(...args),
    entries: vi.fn().mockResolvedValue({ items: [] }),
    publish: (...args: unknown[]) => publish(...args),
    unpublish: vi.fn(),
    archive: vi.fn(),
  },
}));

import App from "./App";

const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "App.tsx"), "utf8");

const editor: Me = {
  principal: { id: "e1", username: "seed-editor-album", displayName: "Album editor", status: "active" },
  roles: [{ code: "editor", contentTypeCodes: ["album", "photo"] }],
  surfaces: { front: true, back: true, admin: false },
};

const operator: Me = {
  principal: { id: "o1", username: "seed-operator-album", displayName: "Album operator", status: "active" },
  roles: [{ code: "operator", contentTypeCodes: ["album", "photo"] }],
  surfaces: { front: true, back: true, admin: false },
};

const member: Me = {
  principal: { id: "m1", username: "seed-member-clinic", displayName: "Clinic member", status: "active" },
  roles: [{ code: "member", contentTypeCodes: [] }],
  surfaces: { front: true, back: false, admin: false },
};

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

describe("CMS Back", () => {
  beforeEach(() => {
    cleanup();
    me.mockReset();
    type.mockReset();
    getEntry.mockReset();
    publish.mockReset();
  });

  it("T-BO-01 has no Admin / content-type / settings navigation", async () => {
    me.mockResolvedValue(operator);
    renderAt("/");
    expect(await screen.findByText("作業台")).toBeInTheDocument();
    expect(screen.queryByText("內容類型")).not.toBeInTheDocument();
    expect(screen.queryByText("系統設定")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Admin" })).not.toBeInTheDocument();
    expect(source).not.toContain('to="/admin"');
    expect(source).not.toContain("系統設定");
  });

  it("T-BO-02 editor does not see Publish; operator does", async () => {
    type.mockResolvedValue({ key: "album", fields: [] });
    getEntry.mockResolvedValue({
      id: "entry-1",
      contentType: "album",
      slug: "draft",
      title: "Draft",
      payload: {},
      publicationState: "draft",
      version: 1,
    });
    me.mockResolvedValue(editor);
    renderAt("/entries/album/entry-1");
    await waitFor(() => expect(type).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: "發布" })).not.toBeInTheDocument();
    cleanup();
    me.mockResolvedValue(operator);
    renderAt("/entries/album/entry-1");
    expect(await screen.findByRole("button", { name: "發布" })).toBeInTheDocument();
  });

  it("T-BO-03 member cannot enter Back work routes", async () => {
    me.mockResolvedValue(member);
    renderAt("/");
    expect(await screen.findByText("沒有權限")).toBeInTheDocument();
    expect(screen.queryByText("作業台")).not.toBeInTheDocument();
  });

  it("T-BO-04 preview stays on the work API, not the Front origin", () => {
    expect(source).toContain("草稿預覽留在 Back");
    expect(source).not.toContain("localhost:5173");
    expect(source).not.toContain("web-front");
  });

  it("T-BO-05 has no board write API; issue status is a field PATCH", () => {
    expect(source).not.toContain("/boards");
    expect(source).not.toContain("/kanban");
    expect(source).toContain("patchEntry");
  });
});
