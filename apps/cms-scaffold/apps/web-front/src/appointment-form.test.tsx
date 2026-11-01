import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { keys } from "@cms/api/public";
import { fixtures, setScenario } from "@cms/mocks";
import { server } from "@cms/mocks/node";
import { afterEach, describe, expect, it, vi } from "vitest";
import { recordMemberPosts, renderRoute, signInMember } from "./test-utils";
const path = "/clinic/appointments/new";
const created = "43000000-0000-4000-8000-000000000004";
const pet = "42000000-0000-4000-8000-000000000001";
async function form() { vi.spyOn(Date, "now").mockReturnValue(new Date(fixtures.memberEntries.clock).getTime()); signInMember(); const result = renderRoute(path); await screen.findByTestId("appointment-form"); return result; }
function fill(time = "2026-10-20T09:30", reason = "皮膚搔癢") {
  fireEvent.change(screen.getByLabelText("希望時間"), { target: { value: time } });
  fireEvent.change(screen.getByLabelText("原因"), { target: { value: reason } });
}
function submit() { fireEvent.submit(screen.getByTestId("appointment-form")); }
function inject(status: number, code: string, fields: string[] = []) {
  server.use(http.post("*/api/v1/me/content-types/appointment_request/entries", () => HttpResponse.json({ error: { code, message: "developer-secret", fields: fields.map((field) => ({ field, code: "INVALID", message: "developer-secret" })) } }, { status })));
}
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
describe("W3b appointment form", () => {
  it("AC12_validRequestCreatesDraftAndNavigatesToFrontDetail", async () => {
    const posts = recordMemberPosts(); const { router, queryClient } = await form();
    const invalidation = vi.spyOn(queryClient, "invalidateQueries");
    const cacheWrite = vi.spyOn(queryClient, "setQueryData");
    vi.useFakeTimers(); vi.setSystemTime(new Date(fixtures.memberEntries.clock));
    fill("2026-10-20T09:30"); submit();
    vi.useRealTimers();
    await waitFor(() => expect(router.state.location.pathname).toBe("/clinic/appointments/" + created));
    expect(posts).toEqual([{ payload: { pet, preferredAt: "2026-10-20T01:30:00.000Z", reason: "皮膚搔癢" } }]);
    expect(queryClient.getQueryData(keys.member.detail(created))).toMatchObject({ id: created });
    expect(invalidation).toHaveBeenCalledWith({ queryKey: ["member", "entries", "appointment_request"] });
    const detailWrite = cacheWrite.mock.calls.findIndex(([key]) => JSON.stringify(key) === JSON.stringify(keys.member.detail(created)));
    expect(detailWrite).toBeGreaterThanOrEqual(0);
    expect(cacheWrite.mock.invocationCallOrder[detailWrite]).toBeLessThan(invalidation.mock.invocationCallOrder[0]);
    expect(router.state.historyAction).toBe("REPLACE");
  });
  it("AC12_clientValidationPreventsInvalidPost", async () => {
    const posts = recordMemberPosts(); await form();
    fireEvent.change(document.querySelector("select")!, { target: { value: "" } }); fill("2000-01-01T00:00", "   "); submit();
    expect(await screen.findByText("請選擇自己的寵物。")).toBeInTheDocument();
    expect(screen.getByText("請選擇未來的日期與時間。")).toBeInTheDocument();
    expect(screen.getByText("請填寫原因，最多 1000 個字。")).toBeInTheDocument();
    fireEvent.change(document.querySelector("select")!, { target: { value: pet } }); fill("", "x".repeat(1001)); submit();
    expect(screen.getByText("請填寫原因，最多 1000 個字。")).toBeInTheDocument(); expect(posts).toHaveLength(0);
  });
  it("G08_noPetsShowsContactClinicInsteadOfForm", async () => {
    signInMember(); setScenario("memberPetsEmpty"); renderRoute(path);
    expect(await screen.findByText("無法預約")).toBeInTheDocument(); expect(screen.getByText("請聯絡診所。")).toBeInTheDocument();
    expect(screen.queryByTestId("appointment-submit")).not.toBeInTheDocument();
  });
  it("G08_422MapsKnownFieldsAndHidesDeveloperMessage", async () => {
    inject(422, "FIELD_VALIDATION", ["payload.pet", "payload.preferredAt", "payload.reason", "unknown"]); await form(); fill(); submit();
    expect(await screen.findByText("請選擇自己的寵物。")).toBeInTheDocument();
    expect(screen.getByText("請選擇未來的日期與時間。")).toBeInTheDocument();
    expect(screen.getByText("請填寫原因，最多 1000 個字。")).toBeInTheDocument();
    expect(screen.getByTestId("appointment-form-alert")).toHaveTextContent("請檢查標示的欄位。");
    expect(document.body.textContent).not.toContain("developer-secret");
  });
  it("G08_429PreservesValuesAndShowsRateLimitCopy", async () => {
    setScenario("rateLimited"); const { router } = await form(); fill(); submit();
    expect(await screen.findByTestId("appointment-form-alert")).toHaveTextContent("送出次數過多，請稍後再試。");
    expect(screen.getByLabelText("寵物")).toHaveTextContent("Leo"); expect(screen.getByLabelText("希望時間")).toHaveValue("2026-10-20T09:30");
    expect(screen.getByLabelText("原因")).toHaveValue("皮膚搔癢"); expect(router.state.location.pathname).toBe(path);
  });
  it("G08_401DuringSubmitRedirectsToLogin", async () => {
    inject(401, "SESSION_EXPIRED"); const { router, queryClient } = await form(); fill(); submit();
    await waitFor(() => expect(router.state.location.pathname).toBe("/login"));
    expect(new URLSearchParams(router.state.location.search).get("next")).toBe(path);
    expect(queryClient.getQueryData(keys.member.detail(created))).toBeUndefined();
    expect(queryClient.getQueryData(keys.auth.me())).toBeNull();
  });
  it.each([[403, "FORBIDDEN", "這個帳號目前無法送出預約。"], [404, "CONTENT_TYPE_NOT_FOUND", "預約服務目前無法使用。"], [403, "CSRF_FAILED", "登入狀態已失效，請重新登入。"], [400, "VALIDATION_FAILED", "請檢查標示的欄位。"]] as const)("G08_403And404CreateUseProductCopy %s %s", async (status, code, text) => {
    inject(status, code); const { router } = await form(); fill(); submit();
    expect(await screen.findByTestId("appointment-form-alert")).toHaveTextContent(text); expect(router.state.location.pathname).toBe(path);
    expect(document.body.textContent).not.toContain(code);
  });
  it("G08_500PreservesFormAndAllowsRetry", async () => {
    inject(500, "INTERNAL_ERROR"); const { router } = await form(); fill(); submit();
    expect(await screen.findByTestId("appointment-form-alert")).toHaveTextContent("暫時無法送出，請稍後再試。");
    expect(screen.getByLabelText("原因")).toHaveValue("皮膚搔癢"); expect(router.state.location.pathname).toBe(path);
    server.resetHandlers(); submit(); await waitFor(() => expect(router.state.location.pathname).toBe("/clinic/appointments/" + created));
  });
  it("G08_doubleSubmitProducesOneRequest", async () => {
    let release: (() => void) | undefined;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    let count = 0;
    server.use(http.post("*/api/v1/me/content-types/appointment_request/entries", async () => { count++; await pending; return HttpResponse.json({ error: { code: "RATE_LIMITED", message: "" } }, { status: 429 }); }));
    await form(); fill(); submit(); submit();
    await waitFor(() => expect(count).toBe(1)); expect(screen.getByTestId("appointment-submit")).toBeDisabled();
    await act(async () => release?.()); await screen.findByTestId("appointment-form-alert"); expect(count).toBe(1);
  });
  it("G08_lateCreateAfterLogoutCannotRestorePreviousOwnersCache", async () => {
    let release: (() => void) | undefined;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    server.use(http.post("*/api/v1/me/content-types/appointment_request/entries", async () => { await pending; return HttpResponse.json(fixtures.memberEntries.createCases.valid.response, { status: 201 }); }));
    const { router, queryClient } = await form(); fill(); submit();
    await router.navigate("/logout"); await waitFor(() => expect(router.state.location.pathname).toBe("/"));
    await act(async () => release?.());
    await waitFor(() => expect(queryClient.isMutating()).toBe(0));
    expect(router.state.location.pathname).toBe("/");
    expect(queryClient.getQueryCache().findAll({ queryKey: ["member"] })).toHaveLength(0);
  });
  it("G08_datetimeMinUsesCurrentLocalMinuteWithoutHardCode", async () => {
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(fixtures.memberEntries.clock));
    await form();
    expect(screen.getByLabelText("希望時間")).toHaveAttribute("min", "2026-10-01T08:00");
    vi.setSystemTime(new Date("2027-01-02T03:04:30Z")); fireEvent.change(screen.getByLabelText("原因"), { target: { value: "b" } });
    expect(screen.getByLabelText("希望時間")).toHaveAttribute("min", "2027-01-02T11:04");
    const source = readFileSync(join(__dirname, "pages/appointment-new.tsx"), "utf8");
    expect(source).not.toContain("2026-10-01");
    expect(source).toContain('SelectContent data-scheme="clinic-warm"');
    expect(readFileSync(join(__dirname, "member.ts"), "utf8")).not.toContain("2026-10-01");
    vi.useRealTimers(); cleanup();
  });
  it("V2AC15_formNeverShowsIdsOrFieldKeys", async () => {
    inject(422, "REF_TARGET_NOT_FOUND", ["payload.pet"]); await form(); fill(); submit(); await screen.findByText("請選擇自己的寵物。");
    expect(document.body.textContent).not.toMatch(/payload\.pet|REF_TARGET_NOT_FOUND|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
  });
});
