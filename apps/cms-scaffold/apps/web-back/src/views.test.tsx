import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { WorkEntry } from "@cms/api";

const entries = vi.fn();
const patchEntry = vi.fn();
const csrf = vi.fn();

vi.mock("./api", () => ({
  api: {
    entries: (...args: unknown[]) => entries(...args),
    patchEntry: (...args: unknown[]) => patchEntry(...args),
    csrf: (...args: unknown[]) => csrf(...args),
  },
}));

import { AlbumComposer, ClinicSchedule, ProjectsBoard } from "./views";

const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "views.tsx"), "utf8");

function entry(partial: Partial<WorkEntry> & Pick<WorkEntry, "id" | "contentType">): WorkEntry {
  return {
    slug: partial.slug,
    title: partial.title || partial.id,
    payload: partial.payload || {},
    publicationState: partial.publicationState || "draft",
    version: partial.version || 1,
    ...partial,
  };
}

describe("Back custom views", () => {
  beforeEach(() => {
    cleanup();
    entries.mockReset();
    patchEntry.mockReset();
    csrf.mockReset();
    csrf.mockResolvedValue("csrf");
    patchEntry.mockImplementation(async (id: string, body: { payload?: Record<string, unknown> }) =>
      entry({
        id,
        contentType: "issue",
        title: "Paint the hull",
        publicationState: "draft",
        version: 2,
        payload: body.payload || {},
      }),
    );
  });

  it("album.composer reorders photos with PATCH sortOrder", async () => {
    const album = entry({ id: "alb-1", contentType: "album", title: "Coast", payload: {} });
    const p1 = entry({ id: "ph-1", contentType: "photo", title: "Harbour", payload: { sortOrder: 10, album: "alb-1", media: "m1" } });
    const p2 = entry({ id: "ph-2", contentType: "photo", title: "Sun", payload: { sortOrder: 20, album: "alb-1", media: "m2" } });
    entries.mockImplementation(async (type: string) => {
      if (type === "album") return { items: [album] };
      return { items: [p1, p2] };
    });
    render(
      <MemoryRouter>
        <AlbumComposer />
      </MemoryRouter>,
    );
    expect(await screen.findByText("Harbour")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "下移" })[0]);
    await waitFor(() => expect(patchEntry).toHaveBeenCalled());
    expect(patchEntry.mock.calls[0][0]).toBe("ph-1");
    expect(patchEntry.mock.calls[0][1].payload).toEqual({ sortOrder: 20 });
    expect(patchEntry.mock.calls[1][1].payload).toEqual({ sortOrder: 10 });
    expect(source).not.toContain("/albums");
  });

  it("clinic.schedule lists visits for the selected day from generic entries", async () => {
    entries.mockResolvedValue({
      items: [
        entry({
          id: "v1",
          contentType: "visit",
          title: "Leo rabies shot",
          payload: { scheduledAt: "2026-03-01T10:00:00Z", visitKind: "vaccine" },
        }),
        entry({
          id: "v2",
          contentType: "visit",
          title: "Other day",
          payload: { scheduledAt: "2026-03-02T10:00:00Z" },
        }),
      ],
    });
    render(
      <MemoryRouter>
        <ClinicSchedule />
      </MemoryRouter>,
    );
    await screen.findByText("當日行程");
    fireEvent.change(screen.getByLabelText("日期"), { target: { value: "2026-03-01" } });
    expect(await screen.findByText("Leo rabies shot")).toBeInTheDocument();
    expect(screen.queryByText("Other day")).not.toBeInTheDocument();
    expect(source).not.toContain('"/clinic/');
  });

  it("T-BO-05 board moves a card with PATCH status and never publishes", async () => {
    const project = entry({ id: "proj-1", contentType: "project", title: "CMS Scaffold", slug: "cms-scaffold" });
    const issue = entry({
      id: "issue-1",
      contentType: "issue",
      title: "Paint the hull",
      publicationState: "draft",
      payload: { status: "backlog", project: "proj-1" },
    });
    entries.mockImplementation(async (type: string) => {
      if (type === "project") return { items: [project] };
      return { items: [issue] };
    });
    render(
      <MemoryRouter>
        <ProjectsBoard />
      </MemoryRouter>,
    );
    expect(await screen.findByText("Paint the hull")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("status-issue-1"), { target: { value: "in_progress" } });
    await waitFor(() => expect(patchEntry).toHaveBeenCalledWith("issue-1", {
      payload: { status: "in_progress" },
      version: 1,
    }));
    expect(source).not.toContain('"/boards"');
    expect(source).not.toContain("'/boards'");
    expect(source).not.toContain("/kanban");
    expect(source).toContain("patchEntry");
    expect(source).not.toContain("api.publish");
  });
});
