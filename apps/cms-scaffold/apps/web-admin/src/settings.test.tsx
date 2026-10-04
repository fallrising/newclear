import { fireEvent, screen, waitFor } from "@testing-library/react";
import { db, fixtures, setUser } from "@cms/mocks";
import { describe, expect, it } from "vitest";
import { recordRequests, renderRoute, writes } from "./test-utils";

describe("web-admin settings and media", () => {
  it("surface-admin §4.4 the settings index links to the pages that exist", async () => {
    setUser("seed-admin");
    renderRoute("/settings");
    expect(await screen.findByTestId("settings-audit")).toBeInTheDocument();
    expect(screen.getByTestId("settings-media")).toBeInTheDocument();
    expect(screen.getByTestId("settings-entries")).toBeInTheDocument();
  });

  it("surface-admin §7.2 retention: explicit save, one PATCH, the page shows the new value", async () => {
    setUser("seed-admin");
    const requests = recordRequests();
    renderRoute("/settings/audit");
    expect(await screen.findByTestId("retention-90")).toBeChecked();
    expect(screen.getByTestId("retention-updated")).toHaveTextContent("目前是預設值。");
    fireEvent.click(screen.getByTestId("retention-30"));
    expect(await screen.findByTestId("save-bar")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("save-bar-save"));
    expect(await screen.findByText("已更新保留期限")).toBeInTheDocument();
    expect(writes(requests).map((r) => [r.method, r.path, r.body])).toEqual([["PATCH", "/api/v1/admin/settings/audit", { retentionDays: 30 }]]);
    expect(db.auditSettings.retentionDays).toBe(30);
    await waitFor(() => expect(screen.queryByTestId("save-bar")).not.toBeInTheDocument());
    expect(screen.getByTestId("retention-updated")).toHaveTextContent("上次變更");
  });

  it("AC-K leaving the retention page with a change asks first", async () => {
    setUser("seed-admin");
    renderRoute("/settings/audit");
    fireEvent.click(await screen.findByTestId("retention-365"));
    fireEvent.click(screen.getByTestId("nav-overview"));
    expect(await screen.findByTestId("leave-dialog")).toBeInTheDocument();
  });

  it("surface-admin §4.4 media: library usage bar and limits; 80% or more shows the warning", async () => {
    setUser("seed-admin");
    renderRoute("/media");
    expect(await screen.findByTestId("media-bytes")).toHaveTextContent("已使用 32.1 KB，上限 1 GB（0%）");
    expect(screen.getByTestId("media-usage")).toHaveTextContent("8 / 2000 個檔案");
    expect(screen.getByTestId("media-usage")).toHaveTextContent("單一檔案上限 15 MB");
    expect(screen.queryByTestId("media-warning")).not.toBeInTheDocument();
    expect(screen.getByTestId("media-backend")).toHaveTextContent("S3");
  });

  it("W4-FM11 media usage at 80% shows the warning", async () => {
    setUser("seed-admin");
    // Current mocks calculate usage from stored media variants; resetMocks restores this test's changes.
    db.media[0].variants.original!.byteSize = Math.round(fixtures.mediaQuota.maxLibraryBytes * 0.85);
    renderRoute("/media");
    expect(await screen.findByTestId("media-warning")).toBeInTheDocument();
  });
});
