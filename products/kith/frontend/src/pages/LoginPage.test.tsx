import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LoginPage } from "./LoginPage";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("LoginPage", () => {
  it("submits handle and password through login()", async () => {
    const onLoggedIn = vi.fn();
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        calls.push(`${init?.method ?? "GET"} ${url}`);
        if (url.endsWith("/api/csrf")) {
          return new Response(JSON.stringify({ csrf: "t" }), { status: 200 });
        }
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      },
    );
    render(<LoginPage onLoggedIn={onLoggedIn} />);
    fireEvent.change(screen.getByLabelText("Handle"), { target: { value: "owner" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "pw" } });
    fireEvent.submit(screen.getByRole("button", { name: "Sign in" }).closest("form")!);
    await waitFor(() => expect(onLoggedIn).toHaveBeenCalled());
    expect(calls).toEqual(["GET /api/csrf", "POST /api/auth/login"]);
  });

  it("shows an error when login fails", async () => {
    vi.stubGlobal(
      "fetch",
      async (input: RequestInfo | URL) => {
        if (String(input).endsWith("/api/csrf")) {
          return new Response(JSON.stringify({ csrf: "t" }), { status: 200 });
        }
        return new Response(JSON.stringify({ error: { code: "unauthorized", message: "bad" } }), {
          status: 401,
        });
      },
    );
    render(<LoginPage onLoggedIn={() => undefined} />);
    fireEvent.change(screen.getByLabelText("Handle"), { target: { value: "owner" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "nope" } });
    fireEvent.submit(screen.getByRole("button", { name: "Sign in" }).closest("form")!);
    expect((await screen.findByRole("alert")).textContent).toContain("bad");
  });
});
