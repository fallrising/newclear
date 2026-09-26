import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryRouter, RouterProvider } from "react-router";
import { createCmsClient } from "@cms/api";
import { MOCK_WRONG_PASSWORD, setSurface, setUser } from "@cms/mocks";
import { resetMocks, server } from "@cms/mocks/node";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createAppQueryClient } from "./query-client";
import { LoginPage } from "./login-page";
import { RequireSurface } from "./require-surface";
import { SessionProvider, useSession } from "./session";

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());
beforeEach(() => resetMocks());

const ROUTES = ["/", "/entries/:type"];

function Home() {
  const session = useSession();
  return <p>home:{session.me?.principal.username}</p>;
}

function setup(path: string) {
  const api = createCmsClient({ baseUrl: "http://localhost:8080" });
  const queryClient = createAppQueryClient();
  const guard = (element: React.ReactNode) => (
    <RequireSurface surface="back" loginPath="/sign-in" returnParam="returnTo" forbidden={<p>forbidden</p>}>
      {element}
    </RequireSurface>
  );
  const router = createMemoryRouter(
    [
      {
        path: "/sign-in",
        element: <LoginPage auth={api.auth} surface="back" title="登入" returnParam="returnTo" returnRoutes={ROUTES} fallback="/" />,
      },
      { path: "/", element: guard(<Home />) },
      { path: "/entries/:type", element: guard(<Home />) },
    ],
    { initialEntries: [path] },
  );
  render(
    <QueryClientProvider client={queryClient}>
      <SessionProvider auth={api.auth}>
        <RouterProvider router={router} />
      </SessionProvider>
    </QueryClientProvider>,
  );
  return { router, queryClient };
}

async function fillLogin(username: string, password: string) {
  fireEvent.change(await screen.findByLabelText("帳號"), { target: { value: username } });
  fireEvent.change(screen.getByLabelText("密碼"), { target: { value: password } });
  fireEvent.click(screen.getByTestId("login-submit"));
}

describe("RequireSurface + LoginPage", () => {
  it("C-17 W0-FM01 anonymous deep link goes to /sign-in?returnTo=<path>, then back after login", async () => {
    const { router } = setup("/entries/album");
    await waitFor(() => expect(router.state.location.pathname).toBe("/sign-in"));
    expect(router.state.location.search).toBe("?returnTo=%2Fentries%2Falbum");
    await fillLogin("seed-operator-album", "pw");
    expect(await screen.findByText("home:seed-operator-album")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/entries/album");
  });

  it("S-02 the login form starts empty", async () => {
    setup("/sign-in");
    expect(await screen.findByLabelText("帳號")).toHaveValue("");
    expect(screen.getByLabelText("密碼")).toHaveValue("");
  });

  it("S-01 an external returnTo is ignored after login", async () => {
    const { router } = setup("/sign-in?returnTo=https%3A%2F%2Fevil.example%2Fsteal");
    await fillLogin("seed-operator-album", "pw");
    expect(await screen.findByText("home:seed-operator-album")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/");
  });

  it("E-01 maps 401 INVALID_CREDENTIALS to a zh-Hant message and stays on the form", async () => {
    setup("/sign-in");
    await fillLogin("seed-admin", MOCK_WRONG_PASSWORD);
    expect(await screen.findByTestId("login-error")).toHaveTextContent("帳號或密碼錯誤。");
  });

  it("W0-FM06 requires both fields before calling the API", async () => {
    setup("/sign-in");
    await fillLogin("", "");
    expect(await screen.findByTestId("login-error")).toHaveTextContent("請輸入帳號與密碼。");
  });

  it("W0-FM03 a member cannot use Back: login shows noSurface; a signed-in member sees forbidden", async () => {
    setup("/sign-in");
    await fillLogin("seed-member-clinic", "pw");
    expect(await screen.findByTestId("login-error")).toHaveTextContent("這個帳號不能使用這個作業台。");
    resetMocks();
    setUser("seed-member-clinic");
    setup("/");
    expect(await screen.findByText("forbidden")).toBeInTheDocument();
  });

  it("C-17 W0-FM02 a 401 from any later query signs the session out and returns to login with the path", async () => {
    setUser("seed-operator-album");
    const { router, queryClient } = setup("/entries/album");
    expect(await screen.findByText("home:seed-operator-album")).toBeInTheDocument();
    setUser(null);
    setSurface("back");
    const api = createCmsClient({ baseUrl: "http://localhost:8080" });
    await queryClient.fetchQuery({ queryKey: ["probe"], queryFn: () => api.work.entries("album") }).catch(() => undefined);
    await waitFor(() => expect(router.state.location.pathname).toBe("/sign-in"));
    expect(router.state.location.search).toBe("?returnTo=%2Fentries%2Falbum");
  });
});
