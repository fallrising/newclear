import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { setUser } from "@cms/mocks";
import { server } from "@cms/mocks/node";
import { describe, expect, it } from "vitest";
import App from "./App";
import { copy } from "./copy";

function requests() {
  const paths: string[] = [];
  server.events.on("request:start", ({ request }) => paths.push(new URL(request.url).pathname));
  return paths;
}
function openApp(path: string) {
  window.history.replaceState(null, "", path);
  render(<App />);
}

describe("actual Front App query lifetime", () => {
  it("the selector renders without any API requests", async () => {
    const paths = requests();
    openApp("/");
    expect(await screen.findAllByTestId("selector-card")).toHaveLength(3);
    expect(paths).toEqual([]);
  });

  it("keeps the member session cache across selector navigation", async () => {
    setUser("seed-member-clinic");
    const paths = requests();
    openApp("/clinic");
    expect(await screen.findByTestId("member-menu")).toBeInTheDocument();
    await screen.findAllByTestId("vet-card");
    expect(paths.filter((path) => path === "/api/v1/auth/me")).toHaveLength(1);
    fireEvent.click(screen.getByRole("link", { name: copy["footer.selector"] }));
    expect(await screen.findAllByTestId("selector-card")).toHaveLength(3);
    fireEvent.click(screen.getAllByTestId("selector-card").find((card) => card.getAttribute("href") === "/clinic")!);
    expect(await screen.findByTestId("member-menu")).toBeInTheDocument();
    await screen.findAllByTestId("vet-card");
    expect(paths.filter((path) => path === "/api/v1/auth/me")).toHaveLength(1);
  });

  it("a new App lifetime does not inherit a previous member session", async () => {
    setUser("seed-member-clinic");
    const paths = requests();
    openApp("/clinic");
    expect(await screen.findByTestId("member-menu")).toBeInTheDocument();
    cleanup();
    setUser(null);
    openApp("/clinic");
    expect(await screen.findByTestId("member-login")).toBeInTheDocument();
    await waitFor(() => expect(paths.filter((path) => path === "/api/v1/auth/me")).toHaveLength(2));
    expect(screen.queryByTestId("member-menu")).not.toBeInTheDocument();
  });
});
