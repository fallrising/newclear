import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { keys } from "@cms/api";
import { db, setUser } from "@cms/mocks";
import { describe, expect, it } from "vitest";
import { readAuditFilters, toAuditQuery } from "./pages/audit";
import { ConfirmDialog } from "./confirm";
import { IDS, openMoreActions, recordRequests, renderRoute, writes } from "./test-utils";

describe("W4 reviewed governance boundaries", () => {
  it("PP1FM07_nonPurgeConsumersRemainCompatible", () => {
    let confirmed = false;
    render(
      <ConfirmDialog
        open
        title="停用帳號？"
        description="資料仍會保留。"
        confirmLabel="停用"
        phrase="seed-operator-album"
        destructive
        pending={false}
        onConfirm={() => { confirmed = true; }}
        onCancel={() => undefined}
      />,
    );
    const dialog = screen.getByTestId("confirm-dialog");
    fireEvent.change(within(dialog).getByTestId("confirm-input"), { target: { value: " seed-operator-album " } });
    expect(within(dialog).getByTestId("confirm-submit")).toBeEnabled();
    fireEvent.click(within(dialog).getByTestId("confirm-submit"));
    expect(confirmed).toBe(true);
    expect(within(dialog).queryByTestId("confirm-word")).not.toBeInTheDocument();
    expect(within(dialog).queryByTestId("confirm-acknowledgement")).not.toBeInTheDocument();
  });

  it("drops malformed UUID-shaped target filters before requesting the audit API", () => {
    for (const id of ["-".repeat(36), "a".repeat(36), "0000000-00000-0000-0000-000000000000"]) {
      expect(toAuditQuery(readAuditFilters(new URLSearchParams({ targetId: id }))).targetId).toBeUndefined();
    }
    expect(readAuditFilters(new URLSearchParams({ targetId: IDS.coast })).targetId).toBe(IDS.coast);
  });

  it("keeps the current disabled account alongside 50 active choices and after search", async () => {
    setUser("seed-admin");
    const current = { id: "10000000-0000-4000-8000-000000009999", username: "zz.current", displayName: "Current linked account", email: null, status: "disabled" as const };
    db.principals.push(current);
    for (let i = 0; i < 55; i++) db.principals.push({ ...current, id: `10000000-0000-4000-8000-${String(1000 + i).padStart(12, "0")}`, username: `aa.${i}`, displayName: `Active ${i}`, status: "active" });
    db.workEntries.find((e) => e.id === IDS.betty)!.payload.ownerPrincipalId = current.id;
    renderRoute(`/entries/${IDS.betty}`);
    fireEvent.click(await screen.findByTestId("member-edit"));
    const dialog = await screen.findByTestId("member-dialog");
    await waitFor(() => expect(within(dialog).getAllByTestId("member-option")).toHaveLength(51));
    expect(within(dialog).getByRole("radio", { name: /Current linked account/ })).toBeChecked();
    fireEvent.change(within(dialog).getByTestId("member-search"), { target: { value: "no-active-match" } });
    expect(within(dialog).getAllByTestId("member-option")).toHaveLength(1);
    expect(within(dialog).getByRole("radio", { name: /Current linked account/ })).toBeChecked();
    expect(within(dialog).getByTestId("member-save")).toBeDisabled();
  });

  it("does not carry a disable confirmation to another cached principal", async () => {
    setUser("seed-admin");
    const requests = recordRequests();
    const { router, queryClient } = renderRoute(`/principals/${IDS.operatorAlbum}`);
    await screen.findByTestId("principal-disable");
    queryClient.setQueryData(keys.admin.principal(IDS.editorAlbum), structuredClone(db.principals.find(p => p.id === IDS.editorAlbum)!));
    fireEvent.click(screen.getByTestId("principal-disable"));
    await screen.findByTestId("confirm-dialog");
    await act(async () => { await router.navigate(`/principals/${IDS.editorAlbum}`); });
    await waitFor(() => expect(screen.queryByTestId("confirm-dialog")).not.toBeInTheDocument());
    await screen.findByRole("heading", { level: 1, name: "Album editor" });
    expect(writes(requests)).toEqual([]);
  });

  it("forgets a temporary password when navigating to another cached principal", async () => {
    setUser("seed-admin");
    const { router, queryClient } = renderRoute(`/principals/${IDS.operatorAlbum}`);
    fireEvent.click(await screen.findByTestId("principal-reset"));
    fireEvent.click(within(await screen.findByTestId("confirm-dialog")).getByTestId("confirm-submit"));
    await screen.findByTestId("temp-password");
    queryClient.setQueryData(keys.admin.principal(IDS.editorAlbum), structuredClone(db.principals.find(p => p.id === IDS.editorAlbum)!));
    await act(async () => { await router.navigate(`/principals/${IDS.editorAlbum}`); });
    await waitFor(() => expect(screen.queryByTestId("temp-password")).not.toBeInTheDocument());
    await screen.findByRole("heading", { level: 1, name: "Album editor" });
  });

  it("does not carry a purge confirmation to another cached entry", async () => {
    setUser("seed-admin");
    const requests = recordRequests();
    const { router, queryClient } = renderRoute(`/entries/${IDS.harbour}`);
    await openMoreActions();
    fireEvent.click(await screen.findByTestId("entry-purge"));
    await screen.findByTestId("confirm-dialog");
    queryClient.setQueryData(keys.entries.detail(IDS.coast), structuredClone(db.workEntries.find(e => e.id === IDS.coast)!));
    await act(async () => { await router.navigate(`/entries/${IDS.coast}`); });
    await waitFor(() => expect(screen.queryByTestId("confirm-dialog")).not.toBeInTheDocument());
    await screen.findByRole("heading", { level: 1, name: "Coast Light 2026" });
    expect(writes(requests)).toEqual([]);
  });

  it("does not keep the previous type's disable dialog after a detail-route change", async () => {
    setUser("seed-admin");
    const { router } = renderRoute("/types/album");
    fireEvent.click(await screen.findByTestId("type-toggle"));
    await screen.findByTestId("confirm-dialog");
    await act(async () => { await router.navigate("/types/photo"); });
    await waitFor(() => expect(screen.queryByTestId("confirm-dialog")).not.toBeInTheDocument());
    await screen.findByRole("heading", { level: 1, name: "Photo" });
  });
});
