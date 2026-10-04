import { cleanup, screen, within } from "@testing-library/react";
import { db } from "@cms/mocks";
import { describe, expect, it } from "vitest";
import { publicEntry, recordRequests, renderRoute } from "./test-utils";

describe("projects site (F-S5)", () => {
  it("AC-05 /projects lists only the public published project; the private one's URL renders NotFoundPublic", async () => {
    renderRoute("/projects");
    const cards = await screen.findAllByTestId("project-card");
    expect(cards.map((card) => card.getAttribute("href"))).toEqual(["/projects/cms-scaffold"]);
    expect(screen.queryByText("Internal Ops")).not.toBeInTheDocument();
    expect(within(cards[0]).getByTestId("badge-lifecycle")).toHaveTextContent("進行中");
    cleanup();
    renderRoute("/projects/internal-ops");
    expect(await screen.findByTestId("not-found-public")).toBeInTheDocument();
    expect(screen.queryByText("Internal Ops")).not.toBeInTheDocument();
  });

  it("AC-06 the project page shows the milestone timeline and never requests issues", async () => {
    const requests = recordRequests();
    renderRoute("/projects/cms-scaffold");
    expect(await screen.findByRole("heading", { level: 1, name: "CMS Scaffold" })).toBeInTheDocument();
    const items = await screen.findAllByTestId("milestone-item");
    expect(items.map((item) => within(item).getByRole("link").textContent)).toEqual(["M1 Specs", "M2 Kernel", "M3 Surfaces"]);
    expect(within(items[0]).getByTestId("badge-status")).toHaveTextContent("已規劃");
    expect(within(items[0]).getByRole("link")).toHaveAttribute("href", "/projects/cms-scaffold/milestones/m1-specs");
    expect(screen.getByRole("link", { name: "全部里程碑" })).toHaveAttribute("href", "/projects/cms-scaffold/milestones");
    expect(requests.some((r) => r.path.includes("/issue"))).toBe(false);
    const milestones = requests.find((r) => r.path === "/api/v1/public/content-types/milestone/entries");
    expect(milestones?.search).toBe(`?size=5&ref.project=${publicEntry("project", "cms-scaffold").id}`);
    expect(screen.getByTestId("badge-lifecycle")).toHaveTextContent("進行中");
    expect(document.body.textContent).not.toMatch(/Kanban|看板/);
  });

  it("C-13 the project summary is Markdown; a due date shows as a local date", async () => {
    publicEntry("project", "cms-scaffold").payload.summary = "Reusable **CMS** kernel.";
    publicEntry("milestone", "m1-specs").payload.dueDate = "2026-09-30T16:00:00Z";
    renderRoute("/projects/cms-scaffold");
    expect((await screen.findByText("CMS", { selector: "strong" })).tagName).toBe("STRONG");
    const [first] = await screen.findAllByTestId("milestone-item");
    expect(first).toHaveTextContent("預計完成 2026年10月1日");
  });

  it("F-S5 /projects/:slug/milestones lists every milestone under the project's breadcrumb", async () => {
    renderRoute("/projects/cms-scaffold/milestones");
    expect(await screen.findByRole("heading", { level: 1, name: "CMS Scaffold 的里程碑" })).toBeInTheDocument();
    expect(await screen.findAllByTestId("milestone-item")).toHaveLength(3);
    const crumbs = screen.getByRole("navigation", { name: "頁面路徑" });
    expect(within(crumbs).getByRole("link", { name: "CMS Scaffold" })).toHaveAttribute("href", "/projects/cms-scaffold");
  });

  it("F-S5 empty.milestones when the project has no public milestone", async () => {
    db.publicEntries = db.publicEntries.filter((e) => e.contentType !== "milestone");
    renderRoute("/projects/cms-scaffold/milestones");
    expect(await screen.findByTestId("empty-published")).toHaveTextContent("這個專案還沒有公開里程碑");
  });

  it("F-S5 the milestone page shows status, due date and the description as Markdown", async () => {
    const m2 = publicEntry("milestone", "m2-kernel");
    m2.payload.status = "reached";
    m2.payload.description = "Kernel **done**.";
    renderRoute("/projects/cms-scaffold/milestones/m2-kernel");
    expect(await screen.findByRole("heading", { level: 1, name: "M2 Kernel" })).toBeInTheDocument();
    expect(screen.getByTestId("badge-status")).toHaveTextContent("已達成");
    expect(screen.getByText("done").tagName).toBe("STRONG");
    expect(screen.queryByTestId("milestone-due")).not.toBeInTheDocument();
    expect(document.title).toBe("M2 Kernel · 專案");
  });

  it("W3-FM11 a milestone under another project's path renders NotFoundPublic", async () => {
    publicEntry("milestone", "m2-kernel").payload.project = "30000000-0000-4000-8000-000000000099";
    renderRoute("/projects/cms-scaffold/milestones/m2-kernel");
    expect(await screen.findByTestId("not-found-public")).toBeInTheDocument();
  });

  it("AC-05 the milestones of a private project are not reachable", async () => {
    renderRoute("/projects/internal-ops/milestones");
    expect(await screen.findByTestId("not-found-public")).toBeInTheDocument();
  });
});
