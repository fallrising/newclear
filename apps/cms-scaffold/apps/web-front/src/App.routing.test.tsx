import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { getState, setUser } from "@cms/mocks";
import { describe, expect, it } from "vitest";
import App from "./App";

function openApp(path: string) {
  window.history.replaceState(null, "", path);
  render(<App />);
}

describe("actual Front App route navigation", () => {
  it("loads a public album deep link and restores its lightbox history", async () => {
    openApp("/album/albums/coast-light-2026");
    const tiles = await screen.findAllByTestId("photo-tile");
    expect(tiles).toHaveLength(6);
    fireEvent.click(tiles[1]);
    expect(await screen.findByTestId("lightbox")).toBeInTheDocument();
    expect(new URLSearchParams(window.location.search).has("photo")).toBe(true);
    fireEvent.click(screen.getByTestId("lightbox-next"));
    await waitFor(() => expect(screen.getByTestId("lightbox")).toHaveTextContent("Concrete edge"));
    fireEvent.click(screen.getByTestId("lightbox-close"));
    await waitFor(() => expect(screen.queryByTestId("lightbox")).not.toBeInTheDocument());
    expect(window.location.pathname).toBe("/album/albums/coast-light-2026");
    expect(new URLSearchParams(window.location.search).has("photo")).toBe(false);
  });

  it("browser back and forward preserve the selector and site paths", async () => {
    openApp("/");
    fireEvent.click((await screen.findAllByTestId("selector-card"))[0]);
    expect(await screen.findByTestId("site-brand")).toHaveTextContent("相簿");
    window.history.back();
    expect(await screen.findAllByTestId("selector-card")).toHaveLength(3);
    expect(window.location.pathname).toBe("/");
    window.history.forward();
    expect(await screen.findByTestId("site-brand")).toHaveTextContent("相簿");
    expect(window.location.pathname).toBe("/album");
  });

  it("an anonymous member deep link redirects to the login next path", async () => {
    openApp("/clinic/me");
    expect(await screen.findByRole("heading", { level: 1, name: "會員登入" })).toBeInTheDocument();
    expect(window.location.pathname).toBe("/login");
    expect(new URLSearchParams(window.location.search).get("next")).toBe("/clinic/me");
  });

  it("login opens the protected member page", async () => {
    openApp("/login?next=/clinic/me");
    fireEvent.change(await screen.findByLabelText("帳號"), { target: { value: "seed-member-clinic" } });
    fireEvent.change(screen.getByLabelText("密碼"), { target: { value: "pw" } });
    fireEvent.click(screen.getByTestId("login-submit"));
    expect(await screen.findByTestId("member-home")).toBeInTheDocument();
    expect(window.location.pathname).toBe("/clinic/me");
  });

  it("logout ends the member session and returns to the selector", async () => {
    setUser("seed-member-clinic");
    openApp("/logout");
    expect(await screen.findAllByTestId("selector-card")).toHaveLength(3);
    expect(window.location.pathname).toBe("/");
    expect(getState().user).toBeNull();
  });

  it.each([
    ["/album/no-such-page", "找不到這個頁面 · 相簿"],
    ["/no-such-page", "找不到這個頁面 · CMS Scaffold"],
  ])("unknown deep link %s keeps its route and document title", async (path, title) => {
    openApp(path);
    expect(await screen.findByTestId("not-found-public")).toBeInTheDocument();
    await waitFor(() => expect(document.title).toBe(title));
    expect(window.location.pathname).toBe(path);
  });
});
