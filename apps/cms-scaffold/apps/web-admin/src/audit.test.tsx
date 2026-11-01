import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { db, setScenario, setUser } from "@cms/mocks";
import { describe, expect, it } from "vitest";
import { IDS, recordRequests, renderRoute, writes } from "./test-utils";

function auditGets(requests: ReturnType<typeof recordRequests>) {
  return requests.filter((r) => r.path === "/api/v1/admin/audit").map((r) => r.search);
}

describe("web-admin audit", () => {
  it("A-S3 lists events newest first with actor, action, target and outcome", async () => {
    setUser("seed-admin");
    renderRoute("/audit");
    const rows = await screen.findAllByTestId("index-row");
    expect(rows).toHaveLength(12);
    expect(rows[0]).toHaveTextContent("Platform admin");
    expect(rows[0]).toHaveTextContent("停用內容類型");
    const denied = rows.find((r) => r.textContent?.includes("嘗試管理內容類型"))!;
    expect(within(denied).getByText("被拒")).toBeInTheDocument();
    expect(screen.getByTestId("index-total")).toHaveTextContent("共 12 筆");
    expect(screen.queryByRole("button", { name: /刪除|修改/ })).not.toBeInTheDocument();
  });

  it("01 §4.4 filters go to the URL and to the API; days become local midnights; the end day is inclusive", async () => {
    setUser("seed-admin");
    const requests = recordRequests();
    const { router } = renderRoute("/audit");
    await screen.findAllByTestId("index-row");
    fireEvent.mouseDown(screen.getByTestId("audit-tab-denied"), { button: 0 });
    await waitFor(() => expect(screen.getAllByTestId("index-row")).toHaveLength(1));
    expect(router.state.location.search).toBe("?outcome=denied");
    fireEvent.mouseDown(screen.getByTestId("audit-tab-all"), { button: 0 });
    fireEvent.change(screen.getByTestId("audit-from"), { target: { value: "2026-09-20" } });
    fireEvent.change(screen.getByTestId("audit-to"), { target: { value: "2026-09-20" } });
    fireEvent.change(screen.getByTestId("audit-actor"), { target: { value: "seed-operator-album" } });
    fireEvent.click(screen.getByTestId("audit-apply"));
    await waitFor(() => expect(screen.getAllByTestId("index-row")).toHaveLength(2));
    expect(router.state.location.search).toBe("?from=2026-09-20&to=2026-09-20&actor=seed-operator-album");
    expect(auditGets(requests).at(-1)).toBe("page=1&size=20&from=2026-09-19T16:00:00.000Z&to=2026-09-20T16:00:00.000Z&actor=seed-operator-album");
    expect(writes(requests)).toEqual([]);
  });

  it("flow C AC-E who published an entry: the target filter narrows to that entry's publish events", async () => {
    setUser("seed-admin");
    renderRoute(`/audit?targetId=${IDS.coast}&action=entry.publish`);
    const rows = await screen.findAllByTestId("index-row");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent("Album operator");
    expect(rows[0]).toHaveTextContent("發布條目");
    expect(screen.getByTestId("audit-target-filter")).toBeInTheDocument();
    expect(within(rows[0]).getByTestId("audit-target-link")).toHaveAttribute("href", `/entries/${IDS.coast}`);
  });

  it("surface-admin §7.3 paging is server side and resets on a new filter", async () => {
    setUser("seed-admin");
    for (let i = 0; i < 25; i += 1) {
      db.audit.push({ ...db.audit[0], id: `71000000-0000-4000-8000-${String(i).padStart(12, "0")}`, at: "2026-09-01T00:00:00Z" });
    }
    const requests = recordRequests();
    const { router } = renderRoute("/audit");
    await screen.findAllByTestId("index-row");
    expect(screen.getByTestId("index-total")).toHaveTextContent("共 37 筆");
    fireEvent.click(screen.getByTestId("page-next"));
    await waitFor(() => expect(router.state.location.search).toBe("?page=2"));
    await waitFor(() => expect(auditGets(requests).at(-1)).toBe("page=2&size=20"));
    fireEvent.mouseDown(screen.getByTestId("audit-tab-ok"), { button: 0 });
    await waitFor(() => expect(router.state.location.search).toBe("?outcome=ok"));
  });

  it("surface-admin §4.4 an empty window says so, not an error", async () => {
    setUser("seed-admin");
    renderRoute("/audit?from=2020-01-01&to=2020-01-02");
    expect(await screen.findByTestId("audit-empty")).toHaveTextContent("這個時間窗沒有事件。");
  });

  it("A-S3 the detail page shows the summary and the read-only detail JSON", async () => {
    setUser("seed-admin");
    renderRoute(`/audit/${IDS.auditRetention}`);
    expect(await screen.findByRole("heading", { level: 1, name: "修改審計保留期限" })).toBeInTheDocument();
    expect(screen.getByTestId("audit-detail-json").textContent).toBe(JSON.stringify({ from: 30, to: 90 }, null, 2));
    expect(screen.getByTestId("audit-summary")).toHaveTextContent("settings.retention_updated");
    expect(screen.queryByRole("button", { name: /刪除|修改/ })).not.toBeInTheDocument();
  });

  it("W4-FM05 an unknown event id goes to /404; W4-FM07 a 500 shows retry", async () => {
    setUser("seed-admin");
    const { router } = renderRoute("/audit/70000000-0000-4000-8000-00000000ffff");
    await waitFor(() => expect(router.state.location.pathname).toBe("/404"));
    setScenario("error500");
    router.navigate("/audit");
    expect(await screen.findByTestId("query-error")).toBeInTheDocument();
  });
});
