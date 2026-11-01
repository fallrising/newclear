import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { getState, setUser } from "@cms/mocks";
import { describe, expect, it } from "vitest";
import { canonical, FORBIDDEN_WORDS, meta, recordRequests, renderRoute } from "./test-utils";

describe("Front shell, selector and routes (W3)", () => {
  it("AC-01 AC-18 U-05 the selector has a header, three site cards and a footer, and is noindex", async () => {
    renderRoute("/");
    expect(await screen.findByRole("heading", { level: 1, name: "CMS Scaffold" })).toBeInTheDocument();
    const cards = screen.getAllByTestId("selector-card");
    expect(cards.map((card) => card.getAttribute("href"))).toEqual(["/album", "/clinic", "/projects"]);
    expect(within(cards[0]).getByRole("heading", { level: 2, name: "個人相簿" })).toBeInTheDocument();
    expect(within(cards[0]).getByText("進入網站")).toBeInTheDocument();
    expect(screen.getByRole("banner")).toHaveTextContent("CMS Scaffold");
    expect(screen.getByRole("contentinfo")).toHaveTextContent("示範用的公開網站，內容由作業台發布。");
    await waitFor(() => expect(meta("robots")).toBe("noindex,nofollow"));
    expect(canonical()).toBeNull();
    expect(document.title).toBe("CMS Scaffold");
  });

  it.each([
    ["/album", "album-card", "Coast Light 2026"],
    ["/clinic", "vet-card", "James Carter"],
    ["/projects", "project-card", "CMS Scaffold"],
  ])("AC-18 %s renders the site navigation and at least one card", async (path, cardId, title) => {
    renderRoute(path);
    expect(await screen.findByText(title, { selector: "h3" })).toBeInTheDocument();
    expect(screen.getAllByTestId(cardId).length).toBeGreaterThan(0);
    expect(screen.getByTestId("site-nav")).toHaveAttribute("aria-label", "網站導覽");
  });

  it("C-11 the clinic header has the member login entry", async () => {
    renderRoute("/clinic");
    expect(await screen.findAllByTestId("vet-card")).toHaveLength(2);
    expect(await within(screen.getByRole("banner")).findByRole("link", { name: "登入" })).toHaveAttribute("href", "/login?next=/clinic/me");
    expect(within(screen.getByTestId("site-nav")).getAllByRole("link").map((a) => a.textContent)).toEqual(["首頁", "獸醫"]);
  });

  it("C-04 an unknown top-level path renders NotFoundPublic and keeps the URL", async () => {
    const { router } = renderRoute("/no-such-page");
    expect(await screen.findByRole("heading", { level: 1, name: "找不到這個頁面" })).toBeInTheDocument();
    expect(screen.getByText("可能不存在，或尚未公開。")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "回到選擇器" })).toHaveAttribute("href", "/");
    expect(router.state.location.pathname).toBe("/no-such-page");
    await waitFor(() => expect(meta("robots")).toBe("noindex,nofollow"));
    expect(document.title).toBe("找不到這個頁面 · CMS Scaffold");
  });

  it("C-04 an unknown path inside a site renders NotFoundPublic in that site's shell", async () => {
    renderRoute("/album/no-such-page");
    expect(await screen.findByTestId("not-found-public")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "回到相簿首頁" })).toHaveAttribute("href", "/album");
    expect(screen.getByTestId("site-brand")).toHaveTextContent("相簿");
    expect(document.title).toBe("找不到這個頁面 · 相簿");
  });

  it("F-05 a site home's title is the site name; a detail page's is '<title> · <site>'", async () => {
    renderRoute("/album");
    expect(await screen.findByRole("heading", { level: 1, name: "相簿" })).toBeInTheDocument();
    expect(document.title).toBe("相簿");
    cleanup();
    renderRoute("/clinic/vets/james-carter");
    expect(await screen.findByRole("heading", { level: 1, name: "James Carter" })).toBeInTheDocument();
    expect(document.title).toBe("James Carter · 診所");
  });

  it("U-03 the menu button opens a sheet with the same navigation; choosing a link closes it", async () => {
    const { router } = renderRoute("/clinic");
    expect(await screen.findAllByTestId("vet-card")).toHaveLength(2);
    fireEvent.click(screen.getByTestId("site-nav-open"));
    const sheet = await screen.findByRole("dialog");
    expect(within(sheet).getByRole("heading", { name: "診所" })).toBeInTheDocument();
    fireEvent.click(within(sheet).getByRole("link", { name: "獸醫" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/clinic/vets"));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("surface-front §4.2 /logout ends the session and goes to /", async () => {
    setUser("seed-member-clinic");
    const requests = recordRequests();
    const { router } = renderRoute("/logout");
    await waitFor(() => expect(router.state.location.pathname).toBe("/"));
    expect(requests.some((r) => r.method === "POST" && r.path === "/api/v1/auth/logout")).toBe(true);
    expect(getState().user).toBeNull();
  });

  it("surface-front §4.2 /logout without a session still goes to /", async () => {
    const { router } = renderRoute("/logout");
    await waitFor(() => expect(router.state.location.pathname).toBe("/"));
  });

  it("S-01 AC-13 login ignores an external next and lands on /clinic/me; the login page is noindex", async () => {
    const { router } = renderRoute("/login?next=https%3A%2F%2Fevil.example%2Fsteal");
    fireEvent.change(await screen.findByLabelText("帳號"), { target: { value: "seed-member-clinic" } });
    fireEvent.change(screen.getByLabelText("密碼"), { target: { value: "pw" } });
    expect(meta("robots")).toBe("noindex,nofollow");
    fireEvent.click(screen.getByTestId("login-submit"));
    await waitFor(() => expect(router.state.location.pathname).toBe("/clinic/me"));
    expect(await screen.findByRole("heading", { level: 1, name: "我的資料" })).toBeInTheDocument();
  });

  it.each(["/", "/album", "/album/albums/coast-light-2026", "/clinic", "/projects/cms-scaffold"])(
    "U-01 V2-AC-15 %s shows no engineering words",
    async (path) => {
      renderRoute(path);
      await screen.findByRole("heading", { level: 1 });
      await waitFor(() => expect(screen.queryByTestId("query-loading")).not.toBeInTheDocument());
      const visible = document.body.textContent ?? "";
      for (const word of FORBIDDEN_WORDS) expect(visible).not.toContain(word);
    },
  );
});
