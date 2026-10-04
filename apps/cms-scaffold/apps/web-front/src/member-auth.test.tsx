import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { keys } from "@cms/api/public";
import { server } from "@cms/mocks/node";
import { describe, expect, it } from "vitest";
import { recordRequests, renderRoute, signInMember } from "./test-utils";

const detail = "/clinic/appointments/43000000-0000-4000-8000-000000000001";
async function login(username = "seed-member-clinic") {
  fireEvent.change(await screen.findByLabelText("帳號"), { target: { value: username } });
  fireEvent.change(screen.getByLabelText("密碼"), { target: { value: "pw" } });
  fireEvent.click(screen.getByTestId("login-submit"));
}
describe("W3b member auth", () => {
  it("AC10_memberRoutesRequireSessionAndRenderOwnedData", async () => {
    for (const path of ["/clinic/me", "/clinic/appointments/new", detail]) {
      const { router } = renderRoute(path);
      await waitFor(() => expect(router.state.location.pathname).toBe("/login"));
      expect(new URLSearchParams(router.state.location.search).get("next")).toBe(path);
      expect(router.state.historyAction).toBe("REPLACE");
      cleanup();
    }
  });
  it("C11_clinicHeaderShowsLoginOnlyWhenAnonymous", async () => {
    renderRoute("/clinic");
    expect(await screen.findByTestId("member-login")).toHaveAttribute("href", "/login?next=/clinic/me");
    expect(screen.queryByRole("button", { name: /Clinic member/ })).not.toBeInTheDocument();
  });
  it("C11_clinicHeaderShowsMemberMenuWhenSignedIn", async () => {
    signInMember(); renderRoute("/clinic");
    const button = await screen.findByRole("button", { name: /Clinic member/ });
    fireEvent.keyDown(button, { key: "ArrowDown" });
    const menu = await screen.findByRole("menu");
    expect(menu).toHaveAttribute("data-scheme", "clinic-warm");
    expect(within(menu).getByRole("menuitem", { name: "我的資料" })).toHaveAttribute("href", "/clinic/me");
    expect(within(menu).getByRole("menuitem", { name: "預約看診" })).toHaveAttribute("href", "/clinic/appointments/new");
    expect(within(menu).getByRole("menuitem", { name: "登出" })).toHaveAttribute("href", "/logout");
  });
  it.each(["/clinic/me", "/clinic/appointments/new", detail, "https://evil.example", "//evil", "/entries", "/clinic/me?x=1", "/clinic/me#x", "/clinic/../clinic/me", "/clinic/me/", "/clinic/appointments/%2e%2e/me"])("AC13_loginNextUsesMemberAllowlist %s", async (next) => {
    const { router } = renderRoute("/login?next=" + encodeURIComponent(next));
    await login();
    const allowed = ["/clinic/me", "/clinic/appointments/new", detail].includes(next);
    await waitFor(() => expect(router.state.location.pathname).toBe(allowed ? next : "/clinic/me"));
    expect(router.state.location.search).toBe("");
  });
  it("G08_sessionExpiryReturnsToLoginWithoutQuery", async () => {
    signInMember();
    server.use(http.get("*/api/v1/me/content-types/:type/entries", () => HttpResponse.json({ error: { code: "SESSION_EXPIRED", message: "developer" } }, { status: 401 })));
    const { router, queryClient } = renderRoute("/clinic/me?secret=hidden#hidden");
    await waitFor(() => expect(router.state.location.pathname).toBe("/login"));
    expect(new URLSearchParams(router.state.location.search).get("next")).toBe("/clinic/me");
    expect(queryClient.getQueryData(keys.auth.me())).toBeNull();
    expect(queryClient.getQueryCache().findAll({ queryKey: ["member"] })).toHaveLength(0);
  });
  it("G08_nonFrontPrincipalGetsForbiddenGate", async () => {
    signInMember();
    const fixture = (await import("@cms/mocks")).fixtures.me["seed-member-clinic"];
    server.use(http.get("*/api/v1/auth/me", () => HttpResponse.json({ ...fixture, surfaces: { ...fixture.surfaces, front: false } })));
    const requests = recordRequests(); renderRoute("/clinic/me");
    expect(await screen.findByTestId("member-forbidden")).toBeInTheDocument();
    expect(requests.some((r) => r.path.startsWith("/api/v1/me/"))).toBe(false);
  });
  it("G08_logoutAndMemberSwitchNeverReusePreviousOwnersCache", async () => {
    signInMember(); const { router, queryClient } = renderRoute("/clinic/me");
    expect((await screen.findAllByText("Leo")).length).toBeGreaterThan(0);
    await router.navigate("/logout");
    await waitFor(() => expect(router.state.location.pathname).toBe("/"));
    expect(queryClient.getQueryCache().findAll({ queryKey: ["member"] })).toHaveLength(0);
    await router.navigate("/login?next=/clinic/me");
    await login("seed-member-projects");
    expect((await screen.findAllByText("Basil")).length).toBeGreaterThan(0);
    expect(screen.queryByText("Leo")).not.toBeInTheDocument();
    expect(screen.queryByText("年度健康檢查")).not.toBeInTheDocument();
  });
});
