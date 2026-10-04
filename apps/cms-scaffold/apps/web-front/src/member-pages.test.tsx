import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { setScenario } from "@cms/mocks";
import { resetMocks, server } from "@cms/mocks/node";
import { describe, expect, it } from "vitest";
import { currentLocalMinute, localDateTimeToIso, memberText } from "./member";
import { canonical, meta, recordRequests, renderRoute, signInMember } from "./test-utils";
const detail = "/clinic/appointments/43000000-0000-4000-8000-000000000001";
describe("W3b member pages", () => {
  it("G08_memberValueHelpersRejectInvalidValuesAndPadLocalCalendar", () => {
    const early = new Date(0);
    early.setFullYear(42, 0, 2);
    early.setHours(3, 4, 30, 500);
    expect(currentLocalMinute(early)).toBe("0042-01-02T03:04");
    expect(() => currentLocalMinute(new Date(NaN))).toThrow(new RangeError("Invalid date"));
    expect(localDateTimeToIso("")).toBeNull();
    expect(localDateTimeToIso("invalid")).toBeNull();
    expect(memberText({ value: "   " }, "value")).toBe("");
    expect(memberText({ value: 123 }, "value")).toBe("");
  });
  it("AC10_dashboardShowsOwnedPetsAndAppointments", async () => {
    signInMember(); renderRoute("/clinic/me");
    expect((await screen.findAllByText("Leo")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Mochi").length).toBeGreaterThan(0);
    expect(await screen.findByText("年度健康檢查")).toBeInTheDocument();
    expect(screen.getByText("牙齒檢查")).toBeInTheDocument();
    expect(screen.queryByText("Basil")).not.toBeInTheDocument();
    expect(screen.queryByText("最近兩天食慾下降")).not.toBeInTheDocument();
    expect(meta("robots")).toBe("noindex,nofollow"); expect(canonical()).toBeNull();
  });
  it("G08_dashboardEmptyStatesAreIndependent", async () => {
    for (const scenario of ["empty", "memberPetsEmpty", "memberAppointmentsEmpty"] as const) {
      resetMocks(); signInMember(); setScenario(scenario); renderRoute("/clinic/me");
      await waitFor(() => expect(screen.queryByTestId("query-loading")).not.toBeInTheDocument());
      expect(within(screen.getByTestId("member-pets")).queryByText("尚未登記寵物") !== null).toBe(scenario !== "memberAppointmentsEmpty");
      expect(within(screen.getByTestId("member-appointments")).queryByText("沒有預約") !== null).toBe(scenario !== "memberPetsEmpty");
      if (scenario === "memberPetsEmpty") expect(screen.getByText("年度健康檢查")).toBeInTheDocument();
      if (scenario === "memberAppointmentsEmpty") expect(screen.getAllByText("Leo").length).toBeGreaterThan(0);
      cleanup();
    }
  });
  it("G08_dashboardSectionErrorDoesNotHideOtherSection", async () => {
    signInMember(); const requests = recordRequests();
    server.use(http.get("*/api/v1/me/content-types/pet/entries", () => HttpResponse.json({ error: { code: "INTERNAL_ERROR", message: "developer" } }, { status: 500 })));
    renderRoute("/clinic/me");
    expect(await screen.findByText("年度健康檢查")).toBeInTheDocument();
    const section = within(screen.getByTestId("member-pets"));
    expect(await section.findByTestId("error-public")).toBeInTheDocument();
    const before = requests.length; fireEvent.click(section.getByRole("button", { name: "重試" }));
    await waitFor(() => expect(requests.length).toBeGreaterThan(before));
  });
  it("G08_appointmentDetailUsesPetTitleAndLocalizedValues", async () => {
    signInMember(); renderRoute(detail);
    expect(await screen.findByTestId("appointment-pet")).toHaveTextContent("Leo");
    expect(screen.getByTestId("appointment-status")).toHaveTextContent("待診所確認");
    expect(screen.getByTestId("appointment-time")).toHaveTextContent("2026年10月10日");
    expect(screen.getByTestId("appointment-reason")).toHaveTextContent("年度健康檢查");
  });
  it("G08_unmatchedPetAndMalformedValuesUseProductFallbacks", async () => {
    signInMember();
    server.use(http.get("*/api/v1/me/entries/:id", () => HttpResponse.json({ id: "x", contentType: "appointment_request", title: "", publicationState: "archived", payload: { pet: "secret-id", preferredAt: "invalid", reason: 12 } })));
    renderRoute(detail);
    expect(await screen.findByTestId("appointment-pet")).toHaveTextContent("寵物資料無法顯示");
    expect(screen.getByTestId("appointment-time")).toHaveTextContent("資料無法顯示");
    expect(screen.getByTestId("appointment-reason")).toHaveTextContent("資料無法顯示");
    expect(screen.getByTestId("appointment-status")).toHaveTextContent("已結束");
  });
  it("AC11_foreignAppointmentShowsForbiddenWithoutContent", async () => {
    signInMember("seed-member-projects"); renderRoute(detail);
    expect(await screen.findByTestId("member-forbidden")).toHaveTextContent("這不是你的資料。");
    expect(screen.queryByText("年度健康檢查")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "回到我的資料" })).toHaveAttribute("href", "/clinic/me");
  });
  it("G08_ownedPetCannotRenderAsAppointmentDetail", async () => {
    signInMember(); renderRoute("/clinic/appointments/42000000-0000-4000-8000-000000000001");
    expect(await screen.findByTestId("not-found-public")).toBeInTheDocument();
    expect(screen.queryByTestId("appointment-detail")).not.toBeInTheDocument();
  });
  it("G08_missingAppointmentShowsNotFound", async () => {
    signInMember(); renderRoute("/clinic/appointments/43000000-0000-4000-8000-000000000099");
    expect(await screen.findByTestId("not-found-public")).toBeInTheDocument();
  });
  it("G08_detailServerFailureShowsRetry", async () => {
    signInMember(); setScenario("error500"); const requests = recordRequests(); renderRoute(detail);
    expect(await screen.findByTestId("error-public")).toBeInTheDocument();
    const before = requests.length; fireEvent.click(screen.getByRole("button", { name: "重試" }));
    await waitFor(() => expect(requests.length).toBeGreaterThan(before));
  });
  it("V2AC15_memberPagesHideEngineeringTermsAndIdentifiers", async () => {
    for (const [user, path] of [["seed-member-clinic", "/clinic/me"], ["seed-member-clinic", detail], ["seed-member-projects", detail]]) {
      signInMember(user); renderRoute(path);
      await waitFor(() => expect(screen.queryByTestId("query-loading")).not.toBeInTheDocument());
      await screen.findByRole("heading", { level: 1 });
      expect(document.body.textContent).not.toMatch(/PATCH|origin|publicationState|ownerPrincipalId|draft|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
      cleanup();
    }
  });
});
