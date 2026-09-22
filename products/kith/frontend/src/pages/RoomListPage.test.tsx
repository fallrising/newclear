import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RoomListPage } from "./RoomListPage";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("RoomListPage", () => {
  it("lists rooms and opens one", async () => {
    const onOpenRoom = vi.fn();
    vi.stubGlobal(
      "fetch",
      async (input: RequestInfo | URL) => {
        if (String(input).endsWith("/api/rooms")) {
          return new Response(JSON.stringify({ rooms: [{ id: "room-1", name: "Lobby" }] }), {
            status: 200,
          });
        }
        return new Response("no", { status: 404 });
      },
    );
    render(<RoomListPage onOpenRoom={onOpenRoom} onLoggedOut={() => undefined} />);
    expect(await screen.findByRole("button", { name: "Lobby" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Lobby" }));
    expect(onOpenRoom).toHaveBeenCalledWith({ id: "room-1", name: "Lobby", slug: undefined });
  });

  it("logs out on 401", async () => {
    const onLoggedOut = vi.fn();
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ error: { code: "unauthorized" } }), { status: 401 }));
    render(<RoomListPage onOpenRoom={() => undefined} onLoggedOut={onLoggedOut} />);
    await waitFor(() => expect(onLoggedOut).toHaveBeenCalled());
  });
});
