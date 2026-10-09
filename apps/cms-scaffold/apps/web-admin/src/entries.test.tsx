import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { StrictMode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryRouter, RouterProvider } from "react-router";
import { keys } from "@cms/api";
import { createAppQueryClient, SessionProvider } from "@cms/auth";
import { db, setUser } from "@cms/mocks";
import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";
import { server } from "@cms/mocks/node";
import { toast, Toaster } from "@cms/ui";
import { api } from "./api";
import { routes } from "./routes";
import { IDS, openMoreActions, recordRequests, renderRoute, writes } from "./test-utils";

function completePurgeConfirmation(dialog: HTMLElement, phrase: string) {
  fireEvent.change(within(dialog).getByTestId("confirm-input"), { target: { value: phrase } });
  fireEvent.change(within(dialog).getByTestId("confirm-word"), { target: { value: "DELETE" } });
  fireEvent.click(within(dialog).getByTestId("confirm-acknowledgement"));
}

function renderStrictRoute(path: string) {
  const queryClient = createAppQueryClient();
  queryClient.setDefaultOptions({ queries: { ...queryClient.getDefaultOptions().queries, retry: false } });
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <SessionProvider auth={api.auth}>
          <RouterProvider router={router} />
          <Toaster />
        </SessionProvider>
      </QueryClientProvider>
    </StrictMode>,
  );
  return { router, queryClient };
}

describe("web-admin emergency entry inspector", () => {
  it("surface-admin §4.4 lookup: pick a type, search by title; rows show metadata only", async () => {
    setUser("seed-admin");
    const requests = recordRequests();
    const { router } = renderRoute("/entries?type=album");
    await waitFor(() => expect(screen.getAllByTestId("index-row")).toHaveLength(3));
    expect(requests.find((r) => r.path === "/api/v1/content-types/album/entries")?.search).toBe("state=draft,published,archived&page=1&size=20&sort=-updatedAt");
    fireEvent.change(screen.getByTestId("lookup-q"), { target: { value: "coast" } });
    fireEvent.click(screen.getByTestId("lookup-submit"));
    await waitFor(() => expect(screen.getAllByTestId("index-row")).toHaveLength(1));
    expect(router.state.location.search).toBe("?type=album&q=coast");
    expect(document.body.textContent).not.toContain("Sea and concrete.");
  });

  it("W4-FM12 without a type the page asks for one and calls no list API", async () => {
    setUser("seed-admin");
    const requests = recordRequests();
    renderRoute("/entries");
    expect(await screen.findByTestId("lookup-pick")).toBeInTheDocument();
    expect(requests.some((r) => r.path.endsWith("/entries"))).toBe(false);
  });

  it("flow C AC-E the inspector shows metadata and the publish history from the audit log", async () => {
    setUser("seed-admin");
    const requests = recordRequests();
    renderRoute(`/entries/${IDS.coast}`);
    expect(await screen.findByRole("heading", { level: 1, name: "Coast Light 2026" })).toBeInTheDocument();
    expect(screen.getByTestId("entry-meta")).toHaveTextContent("coast-light-2026");
    const history = await screen.findAllByTestId("entry-history-row");
    expect(history.map((r) => r.textContent)).toEqual([expect.stringContaining("發布條目"), expect.stringContaining("建立條目")]);
    expect(history[0]).toHaveTextContent("Album operator");
    expect(requests.find((r) => r.path === "/api/v1/admin/audit")?.search).toBe(`targetId=${IDS.coast}&action=entry.&size=20`);
    expect(document.body.textContent).not.toContain("Sea and concrete.");
  });

  it("surface-admin §6.6 force unpublish and archive ask first and use the work actions", async () => {
    setUser("seed-admin");
    const requests = recordRequests();
    renderRoute(`/entries/${IDS.lens}`);
    await openMoreActions();
    fireEvent.click(await screen.findByTestId("entry-unpublish"));
    fireEvent.click(within(await screen.findByTestId("confirm-dialog")).getByTestId("confirm-submit"));
    expect(await screen.findByText("已下架")).toBeInTheDocument();
    await openMoreActions();
    expect(screen.queryByTestId("entry-unpublish")).not.toBeInTheDocument();
    fireEvent.click(await screen.findByTestId("entry-archive"));
    fireEvent.click(within(await screen.findByTestId("confirm-dialog")).getByTestId("confirm-submit"));
    expect(await screen.findByText("已封存")).toBeInTheDocument();
    expect(writes(requests).map((r) => r.path)).toEqual([`/api/v1/entries/${IDS.lens}/unpublish`, `/api/v1/entries/${IDS.lens}/archive`]);
  });

  it("W4-FM15 a state changed meanwhile (409 INVALID_STATE_TRANSITION) reloads the entry and says so", async () => {
    setUser("seed-admin");
    renderRoute(`/entries/${IDS.lens}`);
    await openMoreActions();
    fireEvent.click(await screen.findByTestId("entry-unpublish"));
    const dialog = await screen.findByTestId("confirm-dialog");
    // Someone unpublished it in Back while the dialog was open.
    db.workEntries.find((e) => e.id === IDS.lens)!.publicationState = "draft";
    fireEvent.click(within(dialog).getByTestId("confirm-submit"));
    expect(await screen.findByText("狀態已經改變，已重新載入。")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("status-badge")).toHaveAttribute("data-state", "draft"));
  });

  it("C-19 surface-admin §8 purge needs the slug typed; W4-FM13 a referenced entry is refused with a toast", async () => {
    setUser("seed-admin");
    // The draft album "Studio" still has two photos pointing at it (payload.album).
    renderRoute(`/entries/${IDS.studio}`);
    await openMoreActions();
    fireEvent.click(await screen.findByTestId("entry-purge"));
    const dialog = await screen.findByTestId("confirm-dialog");
    expect(within(dialog).getByTestId("confirm-submit")).toBeDisabled();
    completePurgeConfirmation(dialog, "private-studio");
    fireEvent.click(within(dialog).getByTestId("confirm-submit"));
    expect(await screen.findByText("還有其他條目連到它，請先在 Back 移除這些連結。")).toBeInTheDocument();
    expect(db.workEntries.some((e) => e.id === IDS.studio)).toBe(true);
  });

  it("purge of an unreferenced entry returns to the lookup list", async () => {
    setUser("seed-admin");
    const { router } = renderRoute(`/entries/${IDS.harbour}`);
    await openMoreActions();
    fireEvent.click(await screen.findByTestId("entry-purge"));
    const dialog = await screen.findByTestId("confirm-dialog");
    completePurgeConfirmation(dialog, "coast-harbour");
    fireEvent.click(within(dialog).getByTestId("confirm-submit"));
    expect(await screen.findByText("已永久刪除")).toBeInTheDocument();
    await waitFor(() => expect(router.state.location.pathname + router.state.location.search).toBe("/entries?type=photo"));
    expect(db.workEntries.some((e) => e.id === IDS.harbour)).toBe(false);
  });

  it("PP1-FM07 submits a same-tick double click once and keeps normal success under StrictMode", async () => {
    setUser("seed-admin");
    const requests = recordRequests();
    const { router } = renderStrictRoute(`/entries/${IDS.harbour}`);
    await openMoreActions();
    fireEvent.click(await screen.findByTestId("entry-purge"));
    const dialog = await screen.findByTestId("confirm-dialog");
    completePurgeConfirmation(dialog, "coast-harbour");
    const submit = within(dialog).getByTestId("confirm-submit");
    act(() => {
      fireEvent.click(submit);
      fireEvent.click(submit);
    });
    expect(await screen.findByText("已永久刪除")).toBeInTheDocument();
    await waitFor(() => expect(router.state.location.pathname).toBe("/entries"));
    expect(writes(requests).filter((request) => request.path.endsWith(`/entries/${IDS.harbour}/purge`))).toHaveLength(1);
  });

  it("PP1-FM07 stale purge success invalidates only its captured list and target audit", async () => {
    setUser("seed-admin");
    let release!: () => void;
    let started!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const requestStarted = new Promise<void>((resolve) => { started = resolve; });
    server.use(http.post("*/api/v1/admin/entries/:id/purge", async () => {
      started();
      await held;
      return new HttpResponse(null, { status: 204 });
    }));
    const { router, queryClient } = renderRoute(`/entries/${IDS.harbour}`);
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const successToast = vi.spyOn(toast, "success");
    await openMoreActions();
    fireEvent.click(await screen.findByTestId("entry-purge"));
    const dialog = await screen.findByTestId("confirm-dialog");
    completePurgeConfirmation(dialog, "coast-harbour");
    fireEvent.click(within(dialog).getByTestId("confirm-submit"));
    await requestStarted;
    queryClient.setQueryData(keys.entries.detail(IDS.coast), structuredClone(db.workEntries.find((entry) => entry.id === IDS.coast)!));
    await act(async () => { await router.navigate(`/entries/${IDS.coast}`); });
    await screen.findByRole("heading", { level: 1, name: "Coast Light 2026" });
    await act(async () => { release(); });
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: keys.admin.audit({ targetId: IDS.harbour, action: "entry.", size: 20 }), exact: true }));
    const keysInvalidated = invalidate.mock.calls.map(([filters]) => filters?.queryKey);
    expect(keysInvalidated).toContainEqual(keys.entries.lists("photo"));
    expect(keysInvalidated).not.toContainEqual(keys.entries.lists("album"));
    expect(keysInvalidated).not.toContainEqual(keys.admin.audit({ targetId: IDS.coast, action: "entry.", size: 20 }));
    expect(keysInvalidated).not.toContainEqual(keys.admin.auditAll());
    expect(successToast).not.toHaveBeenCalled();
    expect(router.state.location.pathname).toBe(`/entries/${IDS.coast}`);
    successToast.mockRestore();
  });

  it("PP1-FM07 clears a fully completed purge when the target changes to another id with the same slug", async () => {
    setUser("seed-admin");
    const requests = recordRequests();
    const { router, queryClient } = renderRoute(`/entries/${IDS.harbour}`);
    await screen.findByRole("heading", { level: 1, name: "Harbour wall" });
    await openMoreActions();
    fireEvent.click(await screen.findByTestId("entry-purge"));
    const dialog = await screen.findByTestId("confirm-dialog");
    completePurgeConfirmation(dialog, "coast-harbour");

    const sameSlugDifferentEntry = structuredClone(db.workEntries.find((entry) => entry.id === IDS.coast)!);
    sameSlugDifferentEntry.slug = "coast-harbour";
    queryClient.setQueryData(keys.entries.detail(IDS.coast), sameSlugDifferentEntry);
    await router.navigate(`/entries/${IDS.coast}`);

    await screen.findByRole("heading", { level: 1, name: "Coast Light 2026" });
    expect(screen.queryByTestId("confirm-dialog")).not.toBeInTheDocument();
    await openMoreActions();
    fireEvent.click(await screen.findByTestId("entry-purge"));
    const reopened = await screen.findByTestId("confirm-dialog");
    expect(within(reopened).getByTestId("confirm-input")).toHaveValue("");
    expect(within(reopened).getByTestId("confirm-word")).toHaveValue("");
    expect(within(reopened).getByTestId("confirm-acknowledgement")).not.toBeChecked();
    expect(within(reopened).getByTestId("confirm-submit")).toBeDisabled();
    expect(writes(requests)).toEqual([]);
  });

  it("PP1-FM07 resets confirmation when the same entry version changes", async () => {
    setUser("seed-admin");
    const requests = recordRequests();
    const { queryClient } = renderRoute(`/entries/${IDS.harbour}`);
    await screen.findByRole("heading", { level: 1, name: "Harbour wall" });
    await openMoreActions();
    fireEvent.click(await screen.findByTestId("entry-purge"));
    const dialog = await screen.findByTestId("confirm-dialog");
    fireEvent.change(within(dialog).getByTestId("confirm-input"), { target: { value: "coast-harbour" } });

    const changed = structuredClone(db.workEntries.find((entry) => entry.id === IDS.harbour)!);
    changed.version += 1;
    queryClient.setQueryData(keys.entries.detail(IDS.harbour), changed);

    await waitFor(() => expect(screen.getByTestId("entry-meta")).toHaveTextContent(String(changed.version)));
    expect(screen.queryByTestId("confirm-dialog")).not.toBeInTheDocument();
    expect(writes(requests)).toEqual([]);
  });

  it("PP1-FM07 resets confirmation when the same entry slug changes", async () => {
    setUser("seed-admin");
    const requests = recordRequests();
    const { queryClient } = renderRoute(`/entries/${IDS.harbour}`);
    await screen.findByRole("heading", { level: 1, name: "Harbour wall" });
    await openMoreActions();
    fireEvent.click(await screen.findByTestId("entry-purge"));
    completePurgeConfirmation(await screen.findByTestId("confirm-dialog"), "coast-harbour");

    const changed = structuredClone(db.workEntries.find((entry) => entry.id === IDS.harbour)!);
    changed.slug = "coast-harbour-revised";
    queryClient.setQueryData(keys.entries.detail(IDS.harbour), changed);

    await waitFor(() => expect(screen.getByTestId("entry-meta")).toHaveTextContent(changed.slug!));
    expect(screen.queryByTestId("confirm-dialog")).not.toBeInTheDocument();
    expect(writes(requests)).toEqual([]);
  });

  it("PP1-FM07 purge cancel then archive action and reopening purge never reuses fields or submits", async () => {
    setUser("seed-admin");
    const requests = recordRequests();
    renderRoute(`/entries/${IDS.harbour}`);
    await openMoreActions();
    fireEvent.click(await screen.findByTestId("entry-purge"));
    const purge = await screen.findByTestId("confirm-dialog");
    completePurgeConfirmation(purge, "coast-harbour");
    fireEvent.click(within(purge).getByTestId("confirm-cancel"));

    await openMoreActions();
    fireEvent.click(await screen.findByTestId("entry-archive"));
    const archive = await screen.findByTestId("confirm-dialog");
    expect(within(archive).queryByTestId("confirm-word")).not.toBeInTheDocument();
    expect(within(archive).queryByTestId("confirm-acknowledgement")).not.toBeInTheDocument();
    fireEvent.click(within(archive).getByTestId("confirm-cancel"));

    await openMoreActions();
    fireEvent.click(await screen.findByTestId("entry-purge"));
    const reopenedPurge = await screen.findByTestId("confirm-dialog");
    expect(within(reopenedPurge).getByTestId("confirm-input")).toHaveValue("");
    expect(within(reopenedPurge).getByTestId("confirm-word")).toHaveValue("");
    expect(within(reopenedPurge).getByTestId("confirm-acknowledgement")).not.toBeChecked();
    expect(within(reopenedPurge).getByTestId("confirm-submit")).toBeDisabled();
    expect(writes(requests)).toEqual([]);
  });

  it("01 Q-13 B member binding: an owner's principal-ref is linked here with the entry version", async () => {
    setUser("seed-admin");
    const requests = recordRequests();
    const initialVersion = db.workEntries.find((entry) => entry.id === IDS.betty)!.version;
    renderRoute(`/entries/${IDS.betty}`);
    const field = await screen.findByTestId("member-field-ownerPrincipalId");
    expect(within(field).getByTestId("member-current")).toHaveTextContent("未連結");
    fireEvent.click(within(field).getByTestId("member-edit"));
    const dialog = await screen.findByTestId("member-dialog");
    fireEvent.change(within(dialog).getByTestId("member-search"), { target: { value: "member" } });
    await waitFor(() => expect(within(dialog).getAllByTestId("member-option")).toHaveLength(2));
    fireEvent.click(within(dialog).getByLabelText(/Clinic member/));
    fireEvent.click(within(dialog).getByTestId("member-save"));
    expect(await screen.findByText("已更新會員帳號連結")).toBeInTheDocument();
    await waitFor(() => expect(within(screen.getByTestId("member-field-ownerPrincipalId")).getByTestId("member-current")).toHaveTextContent("Clinic member（seed-member-clinic）"));
    expect(writes(requests).map((r) => [r.method, r.path, r.body])).toEqual([
      ["PATCH", `/api/v1/entries/${IDS.betty}`, { version: initialVersion, payload: { ownerPrincipalId: IDS.memberClinic } }],
    ]);
  });

  it("W4-FM14 a version conflict while linking reloads the entry and says so", async () => {
    setUser("seed-admin");
    renderRoute(`/entries/${IDS.betty}`);
    fireEvent.click(within(await screen.findByTestId("member-field-ownerPrincipalId")).getByTestId("member-edit"));
    const dialog = await screen.findByTestId("member-dialog");
    db.workEntries.find((e) => e.id === IDS.betty)!.version = 5;
    fireEvent.click(await within(dialog).findByLabelText(/Clinic member/));
    fireEvent.click(within(dialog).getByTestId("member-save"));
    expect(await screen.findByText("這筆資料已被其他人更新，已重新載入，請再試一次。")).toBeInTheDocument();
  });

  it("W4-FM05 an unknown entry id goes to /404", async () => {
    setUser("seed-admin");
    const { router } = renderRoute("/entries/30000000-0000-4000-8000-00000000ffff");
    await waitFor(() => expect(router.state.location.pathname).toBe("/404"));
  });
});
