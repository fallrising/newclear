import { useState } from "react";
import { http, HttpResponse } from "msw";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryRouter, RouterProvider, useBlocker } from "react-router";
import { createCmsClient, keys } from "@cms/api";
import { setUser } from "@cms/mocks";
import { resetMocks, server } from "@cms/mocks/node";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createAppQueryClient } from "./query-client";
import { LoginPage } from "./login-page";
import { RequireSurface } from "./require-surface";
import { SessionProvider, useSession } from "./session";

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());
beforeEach(() => resetMocks());

function Editor() {
  const [value, setValue] = useState("");
  const blocker = useBlocker(value !== "");
  const session = useSession();
  return <>
    <input aria-label="Draft" value={value} onChange={(event) => setValue(event.target.value)} />
    <p>session:{session.status}</p>
    <button onClick={() => void session.signOut().catch(() => undefined)}>Sign out</button>
    {blocker.state === "blocked" ? <>
      <button onClick={() => blocker.reset()}>Stay</button>
      <button onClick={() => blocker.proceed()}>Leave</button>
    </> : null}
  </>;
}

function setup() {
  const api = createCmsClient({ baseUrl: "http://localhost:8080" });
  const queryClient = createAppQueryClient();
  const router = createMemoryRouter([
    { path: "/sign-in", element: <LoginPage auth={api.auth} surface="back" title="登入" returnParam="returnTo" returnRoutes={["/entries/:type"]} fallback="/" /> },
    { path: "/entries/:type", element: <RequireSurface surface="back" loginPath="/sign-in" returnParam="returnTo" forbidden={<p>Forbidden</p>}><Editor /></RequireSurface> },
  ], { initialEntries: ["/entries/album?q=coast#draft"] });
  render(<QueryClientProvider client={queryClient}><SessionProvider auth={api.auth}><RouterProvider router={router} /></SessionProvider></QueryClientProvider>);
  return { api, queryClient, router };
}

async function expireQuery(api: ReturnType<typeof createCmsClient>, queryClient: ReturnType<typeof createAppQueryClient>) {
  setUser(null);
  await queryClient.fetchQuery({ queryKey: ["expiry-probe"], queryFn: () => api.work.entries("album") }).catch(() => undefined);
}

describe("W1 session expiry preserves the page", () => {
  it("keeps dirty state and cached me for the router blocker, then allows reauthentication", async () => {
    setUser("seed-operator-album");
    const { api, queryClient, router } = setup();
    fireEvent.change(await screen.findByLabelText("Draft"), { target: { value: "Unsaved input" } });
    await expireQuery(api, queryClient);
    expect(await screen.findByRole("button", { name: "Stay" })).toBeInTheDocument();
    expect(screen.getByLabelText("Draft")).toHaveValue("Unsaved input");
    expect(router.state.location.pathname).toBe("/entries/album");
    expect(queryClient.getQueryData(keys.auth.me())).toMatchObject({ principal: { username: "seed-operator-album" } });
    expect(screen.getByText("session:expired")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Stay" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Stay" })).not.toBeInTheDocument());
    expect(screen.getByLabelText("Draft")).toHaveValue("Unsaved input");
    void router.navigate("/sign-in?returnTo=%2Fentries%2Falbum%3Fq%3Dcoast%23draft");
    fireEvent.click(await screen.findByRole("button", { name: "Leave" }));
    expect(await screen.findByLabelText("帳號")).toBeInTheDocument();
    expect(router.state.location.search).toBe("?returnTo=%2Fentries%2Falbum%3Fq%3Dcoast%23draft");
    fireEvent.change(screen.getByLabelText("帳號"), { target: { value: "seed-operator-album" } });
    fireEvent.change(screen.getByLabelText("密碼"), { target: { value: "pw" } });
    fireEvent.click(screen.getByTestId("login-submit"));
    expect(await screen.findByText("session:authenticated")).toBeInTheDocument();
    expect(queryClient.getQueryData(keys.auth.expired())).toBe(false);
    expect(router.state.location.pathname).toBe("/entries/album");
    expect(router.state.location.search).toBe("?q=coast");
    expect(router.state.location.hash).toBe("#draft");
  });

  it("preserves dirty state when /auth/me itself expires during a refetch", async () => {
    setUser("seed-operator-album");
    const { queryClient } = setup();
    fireEvent.change(await screen.findByLabelText("Draft"), { target: { value: "Keep me" } });
    setUser(null);
    await queryClient.refetchQueries({ queryKey: keys.auth.me() });
    expect(await screen.findByRole("button", { name: "Stay" })).toBeInTheDocument();
    expect(screen.getByLabelText("Draft")).toHaveValue("Keep me");
    expect(queryClient.getQueryData(keys.auth.me())).toMatchObject({ principal: { username: "seed-operator-album" } });
  });

  it("keeps a cached signed-in page mounted after background session-server errors", async () => {
    setUser("seed-operator-album");
    const { queryClient } = setup();
    fireEvent.change(await screen.findByLabelText("Draft"), { target: { value: "Server-error input" } });
    server.use(http.get("*/api/v1/auth/me", () => HttpResponse.json({ error: { code: "INTERNAL_ERROR", message: "offline" }, requestId: "r" }, { status: 500 })));
    await queryClient.refetchQueries({ queryKey: keys.auth.me() });
    expect(screen.getByLabelText("Draft")).toHaveValue("Server-error input");
    expect(screen.getByText("session:authenticated")).toBeInTheDocument();
  });

  it("also preserves the page for mutation 401s and clears expiry on explicit sign-out", async () => {
    setUser("seed-operator-album");
    const { api, queryClient } = setup();
    fireEvent.change(await screen.findByLabelText("Draft"), { target: { value: "Mutation input" } });
    setUser(null);
    const mutation = queryClient.getMutationCache().build(queryClient, { mutationFn: () => api.work.publish("missing") });
    await mutation.execute(undefined).catch(() => undefined);
    expect(await screen.findByRole("button", { name: "Stay" })).toBeInTheDocument();
    expect(screen.getByLabelText("Draft")).toHaveValue("Mutation input");
    fireEvent.click(screen.getByRole("button", { name: "Stay" }));
    fireEvent.change(screen.getByLabelText("Draft"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(await screen.findByLabelText("帳號")).toBeInTheDocument();
    expect(queryClient.getQueryData(keys.auth.me())).toBeNull();
    expect(queryClient.getQueryData(keys.auth.expired())).toBe(false);
  });
});
