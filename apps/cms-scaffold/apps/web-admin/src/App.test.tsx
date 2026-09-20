import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Me } from "@cms/api";

const me = vi.fn();
const principals = vi.fn();
const adminTypes = vi.fn();

vi.mock("./api", () => ({
  api: {
    me: (...args: unknown[]) => me(...args),
    csrf: vi.fn(),
    logout: vi.fn(),
    principals: (...args: unknown[]) => principals(...args),
    adminTypes: (...args: unknown[]) => adminTypes(...args),
  },
}));

import App from "./App";

const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "App.tsx"), "utf8");

const admin: Me = {
  principal: { id: "a1", username: "seed-admin", displayName: "Platform admin", status: "active" },
  roles: [{ code: "admin", contentTypeCodes: [] }],
  surfaces: { front: true, back: true, admin: true },
};

const operator: Me = {
  principal: { id: "o1", username: "seed-operator-album", displayName: "Album operator", status: "active" },
  roles: [{ code: "operator", contentTypeCodes: ["album", "photo"] }],
  surfaces: { front: true, back: true, admin: false },
};

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

describe("CMS Admin", () => {
  beforeEach(() => {
    cleanup();
    me.mockReset();
    principals.mockReset();
    adminTypes.mockReset();
    principals.mockResolvedValue({ items: [] });
    adminTypes.mockResolvedValue({ items: [] });
  });

  it("T-AC-01 is governance only: no day-to-day board / clinic / writing bench", async () => {
    me.mockResolvedValue(admin);
    renderAt("/");
    expect(await screen.findByText("治理台")).toBeInTheDocument();
    expect(screen.getByText(/日常編輯請用 Back office/)).toBeInTheDocument();
    expect(source).not.toContain("/entries/");
    expect(source).not.toContain("看板");
    expect(source).not.toContain("看診");
    expect(source).not.toContain("kanban");
  });

  it("T-AC-02 unauthorized users/types routes fail closed", async () => {
    me.mockResolvedValue(operator);
    renderAt("/users");
    expect(await screen.findByText("沒有權限")).toBeInTheDocument();
    expect(principals).not.toHaveBeenCalled();
    renderAt("/types");
    expect(await screen.findByText("沒有權限")).toBeInTheDocument();
    expect(adminTypes).not.toHaveBeenCalled();
  });
});
