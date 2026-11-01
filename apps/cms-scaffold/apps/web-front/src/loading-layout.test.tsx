import { render, screen, within } from "@testing-library/react";
import { useQuery } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router";
import { db } from "@cms/mocks";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ClinicHome } from "./home";
import { useMemberSession } from "./member-session";
import { SiteShell } from "./shell";

vi.mock("@tanstack/react-query", async (original) => ({ ...await original<typeof import("@tanstack/react-query")>(), useQuery: vi.fn() }));
vi.mock("./member-session", () => ({ useMemberSession: vi.fn() }));

function clinic() {
  return <MemoryRouter initialEntries={["/clinic"]}><Routes><Route element={<SiteShell site="clinic" />}><Route path="/clinic" element={<ClinicHome />} /></Route></Routes></MemoryRouter>;
}

beforeEach(() => {
  vi.mocked(useQuery).mockReturnValue({ isPending: true } as never);
  vi.mocked(useMemberSession).mockReturnValue({ isPending: true } as never);
});

describe("clinic pending layout", () => {
  it("reserves the profile heading, intro and three contact-card structures", () => {
    render(clinic());
    const profile = screen.getByTestId("clinic-profile-loading");
    expect(profile).toHaveAttribute("aria-busy", "true");
    expect(profile.querySelectorAll('[data-slot="card"]')).toHaveLength(3);
    expect(profile.querySelectorAll('[data-slot="card-header"]')).toHaveLength(3);
    expect(profile.querySelectorAll('[data-slot="card-content"]')).toHaveLength(3);
    expect(profile.querySelector('[data-slot="skeleton"].h-10')).toBeInTheDocument();
    expect(profile.querySelectorAll('[data-slot="skeleton"].h-\\[26px\\]')).toHaveLength(4);
    expect(screen.queryByTestId("empty-published")).not.toBeInTheDocument();
  });

  it("loads vet text cards without reserving absent square photos, then retains the same card layout", () => {
    const view = render(clinic());
    const grid = screen.getByTestId("grid-vet");
    const loading = within(grid).getByTestId("query-loading");
    const card = loading.querySelector('[data-slot="card"]');
    expect(card).toBeInTheDocument();
    expect(loading.querySelector('[class*="aspect-"]')).toBeNull();
    expect(card?.querySelector('[data-slot="card-content"]')).toHaveClass("flex", "flex-col", "gap-2");
    const pendingClasses = card?.className;
    vi.mocked(useQuery).mockImplementation((options) => {
      const type = JSON.stringify(options.queryKey).includes("clinic_profile") ? "clinic_profile" : "vet";
      const items = db.publicEntries.filter((entry) => entry.contentType === type);
      return { isPending: false, isError: false, data: { items, total: items.length } } as never;
    });
    view.rerender(clinic());
    expect(within(grid).getAllByTestId("vet-card")).toHaveLength(2);
    expect(within(grid).getAllByTestId("vet-card")[0].querySelector('[data-slot="card"]')?.className.replace(" hover:bg-accent", "")).toBe(pendingClasses);
    expect(screen.getByTestId("clinic-profile").querySelectorAll('[data-slot="card"]')).toHaveLength(3);
  });

  it("keeps account and appointment slots through pending, anonymous, member and account error states", () => {
    const view = render(clinic());
    const account = screen.getByTestId("clinic-account-slot");
    const cta = screen.getByTestId("clinic-appointment-slot");
    const classes = [account.className, cta.className];
    expect(account).toHaveClass("h-9", "w-40", "shrink-0");
    expect(cta).toHaveClass("h-[26px]", "mb-10");
    for (const state of [{ data: null }, { data: { principal: { displayName: "Member" } } }, { isError: true }]) {
      vi.mocked(useMemberSession).mockReturnValue({ isPending: false, ...state } as never);
      view.rerender(clinic());
      expect([account.className, cta.className]).toEqual(classes);
    }
    vi.mocked(useMemberSession).mockReturnValue({ isPending: false, data: null } as never);
    view.rerender(clinic());
    expect(screen.getByTestId("clinic-appointment-cta")).toHaveAttribute("href", "/login?next=/clinic/appointments/new");
    expect(screen.getByTestId("member-login")).toHaveAttribute("href", "/login?next=/clinic/me");
  });
});
