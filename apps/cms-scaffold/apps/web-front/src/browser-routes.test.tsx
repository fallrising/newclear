import { act, render, screen } from "@testing-library/react";
import { Suspense } from "react";
import { MemoryRouter, Outlet, useRoutes, type RouteObject } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { createBrowserRouteModules } from "./browser-routes";

function deferredModule() {
  let resolve!: (module: { Component: () => React.ReactNode }) => void;
  const promise = new Promise<{ Component: () => React.ReactNode }>((done) => { resolve = done; });
  return { load: vi.fn(() => promise), resolve };
}

it("starts only the matched ancestor/page loaders concurrently and reuses stable promises", async () => {
  const api = deferredModule(), site = deferredModule(), page = deferredModule(), album = deferredModule(), member = deferredModule();
  const modules = createBrowserRouteModules([{ lazy: api.load, children: [
    { path: "/clinic", lazy: site.load, children: [{ index: true, lazy: page.load }, { path: "me", lazy: member.load }] },
    { path: "/album", lazy: album.load },
  ] }]);
  modules.startMatchedModules("/clinic?test=1");
  expect([api.load.mock.calls.length, site.load.mock.calls.length, page.load.mock.calls.length]).toEqual([1, 1, 1]);
  expect(album.load).not.toHaveBeenCalled();
  expect(member.load).not.toHaveBeenCalled();
  modules.startMatchedModules("/clinic");
  expect([api.load.mock.calls.length, site.load.mock.calls.length, page.load.mock.calls.length]).toEqual([1, 1, 1]);
  function View() { return useRoutes(modules.routes); }
  render(<MemoryRouter initialEntries={["/clinic"]}><Suspense fallback="pending"><View /></Suspense></MemoryRouter>);
  await act(async () => { api.resolve({ Component: () => <Outlet /> }); site.resolve({ Component: () => <Outlet /> }); page.resolve({ Component: () => <h1>Clinic</h1> }); });
  expect(await screen.findByRole("heading", { name: "Clinic" })).toBeInTheDocument();
  expect([api.load.mock.calls.length, site.load.mock.calls.length, page.load.mock.calls.length]).toEqual([1, 1, 1]);
  modules.startMatchedModules("/clinic/me");
  expect(member.load).toHaveBeenCalledTimes(1);
  expect(album.load).not.toHaveBeenCalled();
});

describe("matched route ranking", () => {
  it("uses the specific deep link rather than unrelated or wildcard modules", () => {
    const detail = deferredModule(), fallback = deferredModule(), selector = deferredModule();
    const modules = createBrowserRouteModules([{ path: "/", lazy: selector.load }, { path: "/clinic/*", lazy: fallback.load }, { path: "/clinic/vets/:slug", lazy: detail.load }] satisfies RouteObject[]);
    modules.startMatchedModules("/clinic/vets/james-carter");
    expect(detail.load).toHaveBeenCalledTimes(1);
    expect(fallback.load).not.toHaveBeenCalled();
    expect(selector.load).not.toHaveBeenCalled();
    modules.startMatchedModules("/unknown");
    expect(selector.load).not.toHaveBeenCalled();
  });
});
