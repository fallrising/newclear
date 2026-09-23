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

  it("creates a room with a generated slug", async () => {
    const onOpenRoom = vi.fn();
    const posts: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/api/csrf")) {
          return new Response(JSON.stringify({ csrf: "t" }), { status: 200 });
        }
        if (url.endsWith("/api/rooms") && init?.method === "POST") {
          posts.push(JSON.parse(String(init.body)));
          return new Response(JSON.stringify({ id: "room-2", name: "Design", slug: "design" }), { status: 200 });
        }
        if (url.endsWith("/api/rooms")) {
          return new Response(JSON.stringify({ rooms: [{ id: "room-1", name: "Lobby" }] }), { status: 200 });
        }
        return new Response("no", { status: 404 });
      },
    );
    render(
      <RoomListPage operator onOpenRoom={onOpenRoom} onLoggedOut={() => undefined} />,
    );
    fireEvent.click(await screen.findByRole("button", { name: "New room" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Design" } });
    fireEvent.submit(screen.getByRole("button", { name: "Create" }).closest("form")!);
    await waitFor(() => expect(onOpenRoom).toHaveBeenCalledWith({ id: "room-2", name: "Design", slug: "design" }));
    expect(posts).toEqual([{ name: "Design", slug: "design" }]);
    expect(screen.getByRole("button", { name: "Lobby" })).toBeTruthy();
  });

  it("shows slug taken and keeps the generated slug editable", async () => {
    vi.stubGlobal(
      "fetch",
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/api/csrf")) {
          return new Response(JSON.stringify({ csrf: "t" }), { status: 200 });
        }
        if (url.endsWith("/api/rooms") && init?.method === "POST") {
          return new Response(JSON.stringify({ error: { code: "handle_taken", message: "slug taken" } }), {
            status: 409,
          });
        }
        return new Response(JSON.stringify({ rooms: [] }), { status: 200 });
      },
    );
    render(<RoomListPage operator onOpenRoom={() => undefined} onLoggedOut={() => undefined} />);
    fireEvent.click(await screen.findByRole("button", { name: "New room" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Design" } });
    fireEvent.submit(screen.getByRole("button", { name: "Create" }).closest("form")!);
    expect((await screen.findByRole("alert")).textContent).toContain("slug taken");
    expect((screen.getByLabelText("Slug") as HTMLInputElement).value).toBe("design");
  });

  it("shows operator required when create is forbidden", async () => {
    vi.stubGlobal(
      "fetch",
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/api/csrf")) {
          return new Response(JSON.stringify({ csrf: "t" }), { status: 200 });
        }
        if (url.endsWith("/api/rooms") && init?.method === "POST") {
          return new Response(JSON.stringify({ error: { code: "forbidden", message: "operator required" } }), {
            status: 403,
          });
        }
        return new Response(JSON.stringify({ rooms: [{ id: "room-1", name: "Lobby" }] }), { status: 200 });
      },
    );
    render(<RoomListPage operator onOpenRoom={() => undefined} onLoggedOut={() => undefined} />);
    fireEvent.click(await screen.findByRole("button", { name: "New room" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Design" } });
    fireEvent.submit(screen.getByRole("button", { name: "Create" }).closest("form")!);
    expect((await screen.findByRole("alert")).textContent).toContain("operator required");
    expect(screen.getByRole("button", { name: "Lobby" }).getAttribute("aria-current")).toBeNull();
  });

  it("keeps an empty list readable for someone who is not an operator", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ rooms: [] }), { status: 200 }));
    render(<RoomListPage onOpenRoom={() => undefined} onLoggedOut={() => undefined} />);
    expect(await screen.findByText("No rooms.")).toBeTruthy();
    expect(screen.getByText("An operator has to invite you.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "New room" })).toBeNull();
  });

  it("names a room button exactly and marks only the selected room", async () => {
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(
          JSON.stringify({
            rooms: [
              { id: "room-1", name: "Lobby" },
              { id: "room-2", name: "Design", slug: "design" },
            ],
          }),
          { status: 200 },
        ),
    );
    render(
      <RoomListPage selectedId="room-2" onOpenRoom={() => undefined} onLoggedOut={() => undefined} />,
    );
    const lobby = await screen.findByRole("button", { name: "Lobby" });
    const design = screen.getByRole("button", { name: "Design" });
    expect(lobby.textContent).toBe("Lobby");
    expect(design.textContent).toBe("Design");
    expect(lobby.getAttribute("aria-current")).toBeNull();
    expect(design.getAttribute("aria-current")).toBe("true");
  });

  it("ignores a stale room list that returns after a create", async () => {
    let releaseFirst: () => void = () => undefined;
    const firstList = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let lists = 0;
    vi.stubGlobal(
      "fetch",
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/api/csrf")) {
          return new Response(JSON.stringify({ csrf: "t" }), { status: 200 });
        }
        if (url.endsWith("/api/rooms") && init?.method === "POST") {
          return new Response(JSON.stringify({ id: "room-2", name: "Design", slug: "design" }), { status: 200 });
        }
        if (url.endsWith("/api/rooms")) {
          lists += 1;
          if (lists === 1) {
            await firstList;
            return new Response(JSON.stringify({ rooms: [{ id: "room-1", name: "Lobby" }] }), { status: 200 });
          }
          return new Response(
            JSON.stringify({
              rooms: [
                { id: "room-1", name: "Lobby" },
                { id: "room-2", name: "Design", slug: "design" },
              ],
            }),
            { status: 200 },
          );
        }
        return new Response("no", { status: 404 });
      },
    );
    const onOpenRoom = vi.fn();
    render(<RoomListPage operator onOpenRoom={onOpenRoom} onLoggedOut={() => undefined} />);
    fireEvent.click(await screen.findByRole("button", { name: "New room" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Design" } });
    fireEvent.submit(screen.getByRole("button", { name: "Create" }).closest("form")!);
    expect(await screen.findByRole("button", { name: "Design" })).toBeTruthy();
    releaseFirst();
    await waitFor(() => expect(screen.getByRole("button", { name: "Lobby" })).toBeTruthy());
    expect(screen.getByRole("button", { name: "Design" })).toBeTruthy();
    expect(onOpenRoom).toHaveBeenCalledWith({ id: "room-2", name: "Design", slug: "design" });
  });
});
