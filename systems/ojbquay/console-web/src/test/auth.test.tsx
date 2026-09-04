import {http, HttpResponse} from "msw";
import {screen} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {describe, expect, it} from "vitest";
import {renderApp} from "./render";
import {fixtures, server} from "./server";

describe("authentication", () => {
  it("redirects to login and opens the dashboard after successful login", async () => {
    let signedIn = false;
    server.use(
      http.get("/api/v1/auth/me", () =>
        signedIn
          ? HttpResponse.json({code: "OK", msg: "", data: fixtures.actor})
          : HttpResponse.json(
              {code: "UNAUTHENTICATED", msg: "Sign in required", data: null},
              {status: 401},
            )),
      http.post("/api/v1/auth/login", () => {
        signedIn = true;
        return HttpResponse.json({code: "OK", msg: "", data: fixtures.actor});
      }),
    );
    const user = userEvent.setup();
    renderApp("/topics");
    expect(await screen.findByRole("heading", {name: "Welcome back"})).toBeVisible();
    await user.type(screen.getByLabelText("Username"), "admin");
    await user.type(screen.getByLabelText("Password"), "correct horse battery staple");
    await user.click(screen.getByRole("button", {name: "Sign in"}));
    expect(await screen.findByRole("heading", {name: "System overview"})).toBeVisible();
  });
});
